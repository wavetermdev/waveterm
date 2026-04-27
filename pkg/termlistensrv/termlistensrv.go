// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package termlistensrv implements the Wave-side (server) of the OSC 9010 terminal listen protocol.
// Plug HandleOSC into a PtyBuffer as the OSCNum handler. The writer callback injects
// ##listen{...}\n responses into the remote's stdin.
package termlistensrv

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
)

const (
	OSCNum         = "9010"
	StdinPrefix    = "##listen"
	MaxPayloadSize = 65536
)

// oscMsg is received Remote→Wave via OSC 9010.
type oscMsg struct {
	Id   string `json:"id,omitempty"`
	Call string `json:"call,omitempty"`
	Conn string `json:"conn,omitempty"`
	N    int    `json:"n,omitempty"`
	Data string `json:"data,omitempty"`
}

// outMsg is sent Wave→Remote injected as ##listen{...}\n into the pty's stdin.
type outMsg struct {
	Id    string `json:"id,omitempty"`
	Port  int    `json:"port,omitempty"`
	Conn  string `json:"conn,omitempty"`
	Addr  string `json:"addr,omitempty"`
	Data  string `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// TermListenSrv is the Wave-side server for the OSC 9010 terminal listen protocol.
// One instance is created per pty. HandleOSC receives OSC 9010 payloads; writer sends
// responses back to the remote process via stdin injection.
type TermListenSrv struct {
	writerMu sync.Mutex
	writer   func([]byte)

	mu      sync.Mutex
	session *srvSession
}

type srvSession struct {
	mu            sync.Mutex
	closed        bool
	listener      net.Listener
	conns         map[string]*srvConn
	connCounter   int32
	acceptPending bool
}

type srvConn struct {
	mu           sync.Mutex
	writePending bool
	conn         net.Conn
}

func MakeTermListenSrv(writer func([]byte)) *TermListenSrv {
	return &TermListenSrv{writer: writer}
}

// Close tears down any active session, closing the ephemeral port and all connections.
func (srv *TermListenSrv) Close() {
	srv.mu.Lock()
	sess := srv.session
	srv.session = nil
	srv.mu.Unlock()
	if sess != nil {
		sess.teardown()
	}
}

// HandleOSC is the OSC 9010 handler. Register it with PtyBuffer using OSCNum as the key.
func (srv *TermListenSrv) HandleOSC(payload []byte) {
	var msg oscMsg
	if err := json.Unmarshal(payload, &msg); err != nil {
		return
	}
	switch msg.Call {
	case "listen-enter":
		srv.handleListenEnter(&msg)
	case "listen-exit":
		srv.handleListenExit()
	default:
		srv.mu.Lock()
		sess := srv.session
		srv.mu.Unlock()
		if sess == nil {
			if msg.Id != "" {
				srv.sendMsg(outMsg{Id: msg.Id, Error: "no active listen session"})
			}
			return
		}
		switch msg.Call {
		case "accept":
			srv.handleAccept(sess, &msg)
		case "read":
			srv.handleRead(sess, &msg)
		case "write":
			srv.handleWrite(sess, &msg)
		case "shutdown":
			srv.handleShutdown(sess, &msg)
		case "close":
			srv.handleClose(sess, &msg)
		}
	}
}

func (srv *TermListenSrv) sendMsg(msg outMsg) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	line := make([]byte, 0, len(StdinPrefix)+len(data)+1)
	line = append(line, StdinPrefix...)
	line = append(line, data...)
	line = append(line, '\n')
	srv.writerMu.Lock()
	srv.writer(line)
	srv.writerMu.Unlock()
}

func (srv *TermListenSrv) handleListenEnter(msg *oscMsg) {
	srv.mu.Lock()
	old := srv.session
	srv.session = nil
	srv.mu.Unlock()
	if old != nil {
		old.teardown()
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		if msg.Id != "" {
			srv.sendMsg(outMsg{Id: msg.Id, Error: fmt.Sprintf("listen: %v", err)})
		}
		return
	}

	port := listener.Addr().(*net.TCPAddr).Port
	sess := &srvSession{
		listener: listener,
		conns:    make(map[string]*srvConn),
	}

	srv.mu.Lock()
	srv.session = sess
	srv.mu.Unlock()

	if msg.Id != "" {
		srv.sendMsg(outMsg{Id: msg.Id, Port: port})
	}
}

func (srv *TermListenSrv) handleListenExit() {
	srv.mu.Lock()
	sess := srv.session
	srv.session = nil
	srv.mu.Unlock()
	if sess != nil {
		sess.teardown()
	}
}

func (srv *TermListenSrv) handleAccept(sess *srvSession, msg *oscMsg) {
	sess.mu.Lock()
	if sess.closed {
		sess.mu.Unlock()
		srv.sendMsg(outMsg{Id: msg.Id, Error: "session closed"})
		return
	}
	if sess.acceptPending {
		sess.mu.Unlock()
		srv.sendMsg(outMsg{Id: msg.Id, Error: "accept already in progress"})
		return
	}
	sess.acceptPending = true
	listener := sess.listener
	sess.mu.Unlock()

	go func() {
		defer func() {
			sess.mu.Lock()
			sess.acceptPending = false
			sess.mu.Unlock()
		}()

		conn, err := listener.Accept()
		if err != nil {
			srv.sendMsg(outMsg{Id: msg.Id, Error: err.Error()})
			return
		}

		connId := sess.nextConnId()
		sconn := &srvConn{conn: conn}

		sess.mu.Lock()
		if sess.closed {
			sess.mu.Unlock()
			conn.Close()
			srv.sendMsg(outMsg{Id: msg.Id, Error: "session closed"})
			return
		}
		sess.conns[connId] = sconn
		sess.mu.Unlock()

		srv.sendMsg(outMsg{
			Id:   msg.Id,
			Conn: connId,
			Addr: conn.RemoteAddr().String(),
		})
	}()
}

func (srv *TermListenSrv) handleRead(sess *srvSession, msg *oscMsg) {
	sconn := sess.getConn(msg.Conn)
	if sconn == nil {
		srv.sendMsg(outMsg{Id: msg.Id, Error: "unknown connection"})
		return
	}

	n := msg.N
	if n <= 0 || n > MaxPayloadSize {
		n = MaxPayloadSize
	}

	go func() {
		buf := make([]byte, n)
		nr, err := sconn.conn.Read(buf)
		if nr > 0 {
			srv.sendMsg(outMsg{
				Id:   msg.Id,
				Data: base64.StdEncoding.EncodeToString(buf[:nr]),
			})
			return
		}
		if err == io.EOF {
			srv.sendMsg(outMsg{Id: msg.Id, Data: ""})
		} else {
			srv.sendMsg(outMsg{Id: msg.Id, Error: err.Error()})
		}
	}()
}

func (srv *TermListenSrv) handleWrite(sess *srvSession, msg *oscMsg) {
	sconn := sess.getConn(msg.Conn)
	if sconn == nil {
		srv.sendMsg(outMsg{Id: msg.Id, Error: "unknown connection"})
		return
	}

	sconn.mu.Lock()
	if sconn.writePending {
		sconn.mu.Unlock()
		srv.sendMsg(outMsg{Id: msg.Id, Error: "write already in progress"})
		return
	}
	sconn.writePending = true
	sconn.mu.Unlock()

	decoded, err := base64.StdEncoding.DecodeString(msg.Data)
	if err != nil {
		sconn.mu.Lock()
		sconn.writePending = false
		sconn.mu.Unlock()
		srv.sendMsg(outMsg{Id: msg.Id, Error: "invalid base64 data"})
		return
	}
	if len(decoded) > MaxPayloadSize {
		sconn.mu.Lock()
		sconn.writePending = false
		sconn.mu.Unlock()
		srv.sendMsg(outMsg{Id: msg.Id, Error: "payload exceeds MaxPayloadSize"})
		return
	}

	go func() {
		defer func() {
			sconn.mu.Lock()
			sconn.writePending = false
			sconn.mu.Unlock()
		}()
		if _, err := sconn.conn.Write(decoded); err != nil {
			srv.sendMsg(outMsg{Id: msg.Id, Error: err.Error()})
			return
		}
		srv.sendMsg(outMsg{Id: msg.Id})
	}()
}

func (srv *TermListenSrv) handleShutdown(sess *srvSession, msg *oscMsg) {
	sconn := sess.getConn(msg.Conn)
	if sconn == nil {
		return
	}
	if tc, ok := sconn.conn.(*net.TCPConn); ok {
		tc.CloseWrite()
	}
}

func (srv *TermListenSrv) handleClose(sess *srvSession, msg *oscMsg) {
	sconn := sess.removeConn(msg.Conn)
	if sconn != nil {
		sconn.conn.Close()
	}
}

func (s *srvSession) teardown() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	listener := s.listener
	conns := s.conns
	s.conns = make(map[string]*srvConn)
	s.mu.Unlock()

	if listener != nil {
		listener.Close()
	}
	for _, sconn := range conns {
		sconn.conn.Close()
	}
}

func (s *srvSession) getConn(connId string) *srvConn {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conns[connId]
}

func (s *srvSession) removeConn(connId string) *srvConn {
	s.mu.Lock()
	defer s.mu.Unlock()
	sconn := s.conns[connId]
	if sconn != nil {
		delete(s.conns, connId)
	}
	return sconn
}

func (s *srvSession) nextConnId() string {
	n := atomic.AddInt32(&s.connCounter, 1)
	return fmt.Sprintf("c%d", n)
}
