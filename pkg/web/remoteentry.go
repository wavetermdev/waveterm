// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"bufio"
	"crypto/subtle"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

const RemotePasswordHeader = "X-Remote-Password"
const AuthKeyHeader = "X-AuthKey"

// RemoteEntry is a password-guarded reverse-proxy that forwards HTTP and
// WebSocket traffic to wavesrv's internal listeners after stripping the
// remote password and injecting the internal authkey.
type RemoteEntry struct {
	password  string
	webAddr   string // host:port of the internal web listener
	wsAddr    string // host:port of the internal ws listener
	authKey   string
	httpProxy *httputil.ReverseProxy
}

func NewRemoteEntry(password, webAddr, wsAddr, authKey string) *RemoteEntry {
	target, _ := url.Parse("http://" + webAddr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	origDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		origDirector(r)
		r.Header.Del(RemotePasswordHeader)
		r.Header.Set(AuthKeyHeader, authKey)
	}
	return &RemoteEntry{
		password:  password,
		webAddr:   webAddr,
		wsAddr:    wsAddr,
		authKey:   authKey,
		httpProxy: proxy,
	}
}

// Serve runs the entry on the given listener. Blocks until listener closes.
func (e *RemoteEntry) Serve(ln net.Listener) error {
	srv := &http.Server{Handler: http.HandlerFunc(e.handle)}
	return srv.Serve(ln)
}

func (e *RemoteEntry) handle(w http.ResponseWriter, r *http.Request) {
	if !e.authOK(r) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("unauthorized"))
		return
	}
	if isWebSocketUpgrade(r) {
		e.proxyWebSocket(w, r)
		return
	}
	e.httpProxy.ServeHTTP(w, r)
}

func (e *RemoteEntry) authOK(r *http.Request) bool {
	got := r.Header.Get(RemotePasswordHeader)
	if got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(e.password)) == 1
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func (e *RemoteEntry) proxyWebSocket(w http.ResponseWriter, r *http.Request) {
	backend, err := net.Dial("tcp", e.wsAddr)
	if err != nil {
		http.Error(w, "backend dial failed", http.StatusBadGateway)
		return
	}

	upstreamReq := r.Clone(r.Context())
	upstreamReq.Header.Del(RemotePasswordHeader)
	upstreamReq.Header.Set(AuthKeyHeader, e.authKey)
	upstreamReq.URL.Scheme = "http"
	upstreamReq.URL.Host = e.wsAddr
	upstreamReq.RequestURI = ""

	if err := upstreamReq.Write(backend); err != nil {
		backend.Close()
		http.Error(w, "handshake write failed", http.StatusBadGateway)
		return
	}

	br := bufio.NewReader(backend)
	resp, err := http.ReadResponse(br, upstreamReq)
	if err != nil {
		backend.Close()
		http.Error(w, "handshake read failed", http.StatusBadGateway)
		return
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		backend.Close()
		http.Error(w, "hijack unsupported", http.StatusInternalServerError)
		return
	}
	client, clientBuf, err := hj.Hijack()
	if err != nil {
		backend.Close()
		http.Error(w, "hijack failed", http.StatusInternalServerError)
		return
	}
	defer client.Close()
	defer backend.Close()

	if err := resp.Write(client); err != nil {
		return
	}

	clientToBackend := io.MultiReader(clientBuf, client)
	backendToClient := io.MultiReader(br, backend)

	errc := make(chan error, 2)
	go func() {
		_, err := io.Copy(backend, clientToBackend)
		errc <- err
	}()
	go func() {
		_, err := io.Copy(client, backendToClient)
		errc <- err
	}()
	<-errc
}
