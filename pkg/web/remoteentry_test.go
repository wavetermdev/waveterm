// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const (
	testPassword = "swordfish"
	testAuthKey  = "internal-authkey-xyz"
)

// startBackend returns an httptest.Server that echoes the headers
// it received as the response body (one "Key: Value" per line).
func startBackend(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for k, vs := range r.Header {
			for _, v := range vs {
				fmt.Fprintf(w, "%s: %s\n", k, v)
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// startEntry starts a remote-entry server on a random localhost port that
// forwards HTTP to backendAddr. It returns the entry listen address.
func startEntry(t *testing.T, backendAddr, wsBackendAddr string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	entry := NewRemoteEntry(testPassword, backendAddr, wsBackendAddr, testAuthKey)
	go entry.Serve(ln)
	t.Cleanup(func() { ln.Close() })
	return ln.Addr().String()
}

func httpGet(t *testing.T, url string, headers map[string]string) (int, string) {
	t.Helper()
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

func TestRemoteEntryHTTP_NoPassword401(t *testing.T) {
	backend := startBackend(t)
	addr := startEntry(t, strings.TrimPrefix(backend.URL, "http://"), "127.0.0.1:0")
	status, _ := httpGet(t, "http://"+addr+"/wave/file", nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", status)
	}
}

func TestRemoteEntryHTTP_WrongPassword401(t *testing.T) {
	backend := startBackend(t)
	addr := startEntry(t, strings.TrimPrefix(backend.URL, "http://"), "127.0.0.1:0")
	status, _ := httpGet(t, "http://"+addr+"/wave/file",
		map[string]string{"X-Remote-Password": "wrong"})
	if status != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", status)
	}
}

func TestRemoteEntryHTTP_CorrectPasswordTranslatesHeaders(t *testing.T) {
	backend := startBackend(t)
	addr := startEntry(t, strings.TrimPrefix(backend.URL, "http://"), "127.0.0.1:0")
	status, body := httpGet(t, "http://"+addr+"/wave/file",
		map[string]string{"X-Remote-Password": testPassword})
	if status != http.StatusOK {
		t.Fatalf("want 200, got %d body=%q", status, body)
	}
	if !strings.Contains(body, "X-Authkey: "+testAuthKey) {
		t.Fatalf("expected X-AuthKey injection in backend headers, got:\n%s", body)
	}
	if strings.Contains(strings.ToLower(body), "x-remote-password") {
		t.Fatalf("X-Remote-Password should be stripped, got:\n%s", body)
	}
}

func TestRemoteEntryHTTP_ConstantTimeCompareDifferentLengths(t *testing.T) {
	backend := startBackend(t)
	addr := startEntry(t, strings.TrimPrefix(backend.URL, "http://"), "127.0.0.1:0")
	// short
	st, _ := httpGet(t, "http://"+addr+"/wave/file",
		map[string]string{"X-Remote-Password": "x"})
	if st != http.StatusUnauthorized {
		t.Fatalf("want 401 for short pw, got %d", st)
	}
	// long
	st, _ = httpGet(t, "http://"+addr+"/wave/file",
		map[string]string{"X-Remote-Password": strings.Repeat("a", 1024)})
	if st != http.StatusUnauthorized {
		t.Fatalf("want 401 for long pw, got %d", st)
	}
}

// startWSBackend starts a gorilla/websocket echo backend. Returns host:port.
func startWSBackend(t *testing.T) string {
	t.Helper()
	up := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Authkey") != testAuthKey {
			http.Error(w, "missing authkey", http.StatusBadRequest)
			return
		}
		if r.Header.Get(RemotePasswordHeader) != "" {
			http.Error(w, "remote password leaked", http.StatusBadRequest)
			return
		}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			mt, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			if err := c.WriteMessage(mt, msg); err != nil {
				return
			}
		}
	})}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	return ln.Addr().String()
}

func TestRemoteEntryWS_Echo(t *testing.T) {
	wsBackend := startWSBackend(t)
	entryAddr := startEntry(t, "127.0.0.1:0", wsBackend)

	hdr := http.Header{}
	hdr.Set(RemotePasswordHeader, testPassword)
	c, _, err := websocket.DefaultDialer.Dial("ws://"+entryAddr+"/ws", hdr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	want := []byte("hello-remote")
	if err := c.WriteMessage(websocket.BinaryMessage, want); err != nil {
		t.Fatalf("write: %v", err)
	}
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, got, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("echo mismatch: got %q want %q", got, want)
	}
}

func TestRemoteEntryWS_AuthRequired(t *testing.T) {
	wsBackend := startWSBackend(t)
	entryAddr := startEntry(t, "127.0.0.1:0", wsBackend)

	_, resp, err := websocket.DefaultDialer.Dial("ws://"+entryAddr+"/ws", nil)
	if err == nil {
		t.Fatalf("expected error without password")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %+v", resp)
	}
}
