// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// cmd/test-termlisten is an integration test that exercises the full OSC 9010 terminal
// listen protocol end-to-end. It wires the Wave-side server (termlistensrv) to the
// client-side SDK (tsunami/termlisten) via in-process pipes, then runs a real net/http
// server on the client listener and makes HTTP requests through the proxy.
//
// No pty required — pipes skip the raw-mode logic but exercise the full protocol.
//
// Run with:
//
//	go run ./cmd/test-termlisten
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/termlistensrv"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/tsunami/termlisten"
)

func main() {
	log.SetFlags(0)
	log.SetPrefix("[test-termlisten] ")

	var failed bool
	run("GET /hello", testGET, &failed)
	run("POST with body", testPOST, &failed)
	run("concurrent requests", testConcurrent, &failed)

	if failed {
		log.Printf("FAIL")
		os.Exit(1)
	}
	log.Printf("PASS — all tests passed")
}

func run(name string, fn func(port int) error, failed *bool) {
	log.Printf("--- %s", name)
	port, cleanup, err := setup()
	if err != nil {
		log.Printf("FAIL setup: %v", err)
		*failed = true
		return
	}
	defer cleanup()
	if err := fn(port); err != nil {
		log.Printf("FAIL: %v", err)
		*failed = true
	} else {
		log.Printf("ok")
	}
}

// setup wires up a full Wave↔Client pipe stack and returns the Wave-side ephemeral port.
// cleanup closes both pipe ends and the listener.
func setup() (int, func(), error) {
	// Wave → Client: TermListenSrv writes ##listen lines here
	clientStdinR, clientStdinW := io.Pipe()
	// Client → Wave: termlisten writes OSC 9010 frames here
	clientStdoutR, clientStdoutW := io.Pipe()

	// Wave side: server + OSC parser
	srv := termlistensrv.MakeTermListenSrv(func(b []byte) {
		clientStdinW.Write(b)
	})
	wshutil.MakePtyBuffer(clientStdoutR, map[string]func([]byte){
		termlistensrv.OSCNum: srv.HandleOSC,
	})

	// Client side
	termlisten.ResetForTesting()
	termlisten.SetOutput(clientStdoutW)
	l, _, err := termlisten.MakeListener(clientStdinR)
	if err != nil {
		clientStdinW.Close()
		clientStdoutW.Close()
		return 0, nil, fmt.Errorf("MakeListener: %w", err)
	}
	port := l.Port()
	log.Printf("  bound port %d", port)

	// HTTP server on the client (remote) side
	mux := http.NewServeMux()
	mux.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "hello from termlisten")
	})
	mux.HandleFunc("/echo", func(w http.ResponseWriter, r *http.Request) {
		io.Copy(w, r.Body)
	})
	go http.Serve(l, mux)

	cleanup := func() {
		l.Close()
		srv.Close()
		clientStdinW.Close()
		clientStdoutW.Close()
	}
	return port, cleanup, nil
}

func testGET(port int) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/hello", port)
	log.Printf("  GET %s", url)
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("http.Get: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	log.Printf("  → %d %q", resp.StatusCode, strings.TrimSpace(string(body)))
	if resp.StatusCode != 200 {
		return fmt.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if !strings.Contains(string(body), "hello") {
		return fmt.Errorf("body missing 'hello': %q", body)
	}
	return nil
}

func testPOST(port int) error {
	msg := "hello from the other side"
	url := fmt.Sprintf("http://127.0.0.1:%d/echo", port)
	log.Printf("  POST %s body=%q", url, msg)
	resp, err := http.Post(url, "text/plain", strings.NewReader(msg))
	if err != nil {
		return fmt.Errorf("http.Post: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	log.Printf("  → %d %q", resp.StatusCode, strings.TrimSpace(string(body)))
	if resp.StatusCode != 200 {
		return fmt.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if string(body) != msg {
		return fmt.Errorf("echo mismatch: got %q want %q", body, msg)
	}
	return nil
}

func testConcurrent(port int) error {
	const n = 5
	type result struct {
		i   int
		err error
	}
	ch := make(chan result, n)
	for i := range n {
		go func(i int) {
			url := fmt.Sprintf("http://127.0.0.1:%d/hello", port)
			resp, err := http.Get(url)
			if err != nil {
				ch <- result{i, err}
				return
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				ch <- result{i, fmt.Errorf("read: %w", err)}
				return
			}
			if resp.StatusCode != 200 || !strings.Contains(string(body), "hello") {
				ch <- result{i, fmt.Errorf("bad response %d %q", resp.StatusCode, body)}
				return
			}
			ch <- result{i, nil}
		}(i)
	}
	var errs []string
	for range n {
		r := <-ch
		if r.err != nil {
			errs = append(errs, fmt.Sprintf("[%d] %v", r.i, r.err))
		}
	}
	log.Printf("  %d/%d requests succeeded", n-len(errs), n)
	if len(errs) > 0 {
		return fmt.Errorf("some requests failed: %s", strings.Join(errs, "; "))
	}
	return nil
}
