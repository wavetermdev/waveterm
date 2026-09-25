// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package termlistensrv

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"testing"
	"time"
)

func makeTestSrv(t *testing.T) (*TermListenSrv, chan outMsg) {
	t.Helper()
	ch := make(chan outMsg, 32)
	srv := MakeTermListenSrv(func(b []byte) {
		if len(b) <= len(StdinPrefix)+1 {
			return
		}
		payload := b[len(StdinPrefix) : len(b)-1]
		var msg outMsg
		if err := json.Unmarshal(payload, &msg); err != nil {
			t.Errorf("writer got invalid JSON: %v (payload=%q)", err, payload)
			return
		}
		ch <- msg
	})
	t.Cleanup(srv.Close)
	return srv, ch
}

func osc(srv *TermListenSrv, msg oscMsg) {
	data, _ := json.Marshal(msg)
	srv.HandleOSC(data)
}

func recv(t *testing.T, ch <-chan outMsg) outMsg {
	t.Helper()
	select {
	case msg := <-ch:
		return msg
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for response")
		return outMsg{}
	}
}

func TestListenEnter(t *testing.T) {
	srv, ch := makeTestSrv(t)
	osc(srv, oscMsg{Id: "l1", Call: "listen-enter"})
	msg := recv(t, ch)
	if msg.Error != "" {
		t.Fatalf("unexpected error: %s", msg.Error)
	}
	if msg.Port == 0 {
		t.Fatal("expected non-zero port")
	}
	// verify the port is actually bound
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", msg.Port), time.Second)
	if err != nil {
		t.Fatalf("could not dial bound port %d: %v", msg.Port, err)
	}
	conn.Close()
}

func TestListenReenter(t *testing.T) {
	srv, ch := makeTestSrv(t)

	osc(srv, oscMsg{Id: "l1", Call: "listen-enter"})
	msg1 := recv(t, ch)
	if msg1.Error != "" || msg1.Port == 0 {
		t.Fatalf("first listen-enter: %+v", msg1)
	}

	osc(srv, oscMsg{Id: "l2", Call: "listen-enter"})
	msg2 := recv(t, ch)
	if msg2.Error != "" || msg2.Port == 0 {
		t.Fatalf("second listen-enter: %+v", msg2)
	}

	if msg1.Port == msg2.Port {
		t.Logf("ports happen to match (%d) — acceptable but unusual", msg1.Port)
	}

	// old port should be closed after reenter
	_, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", msg1.Port), 200*time.Millisecond)
	if err == nil {
		t.Errorf("expected old port %d to be closed after reenter", msg1.Port)
	}
}

func TestListenExit(t *testing.T) {
	srv, ch := makeTestSrv(t)

	osc(srv, oscMsg{Id: "l1", Call: "listen-enter"})
	msg := recv(t, ch)
	if msg.Port == 0 {
		t.Fatalf("listen-enter failed: %+v", msg)
	}

	osc(srv, oscMsg{Call: "listen-exit"})

	// any subsequent call with no session should error
	osc(srv, oscMsg{Id: "a1", Call: "accept"})
	errMsg := recv(t, ch)
	if errMsg.Error == "" {
		t.Fatal("expected error after listen-exit, got none")
	}
}

func TestAcceptNoSession(t *testing.T) {
	srv, ch := makeTestSrv(t)
	osc(srv, oscMsg{Id: "a1", Call: "accept"})
	msg := recv(t, ch)
	if msg.Error == "" {
		t.Fatal("expected error for accept with no session")
	}
}

func TestAcceptDoubleInFlight(t *testing.T) {
	srv, ch := makeTestSrv(t)

	osc(srv, oscMsg{Id: "l1", Call: "listen-enter"})
	enterMsg := recv(t, ch)
	if enterMsg.Port == 0 {
		t.Fatalf("listen-enter failed: %+v", enterMsg)
	}

	// first accept — blocks waiting for a connection
	osc(srv, oscMsg{Id: "a1", Call: "accept"})
	// second accept should error immediately
	osc(srv, oscMsg{Id: "a2", Call: "accept"})

	msg := recv(t, ch)
	if msg.Error == "" {
		t.Fatalf("expected error for second in-flight accept, got: %+v", msg)
	}
	if msg.Id != "a2" {
		t.Errorf("expected error on a2, got id=%q", msg.Id)
	}
}

func TestFullCycle(t *testing.T) {
	srv, ch := makeTestSrv(t)

	osc(srv, oscMsg{Id: "l1", Call: "listen-enter"})
	enterMsg := recv(t, ch)
	if enterMsg.Error != "" || enterMsg.Port == 0 {
		t.Fatalf("listen-enter: %+v", enterMsg)
	}

	// start accept — spawns goroutine waiting for TCP connection
	osc(srv, oscMsg{Id: "a1", Call: "accept"})

	// dial the Wave-side port to unblock accept
	tcpConn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", enterMsg.Port))
	if err != nil {
		t.Fatalf("dial port %d: %v", enterMsg.Port, err)
	}
	defer tcpConn.Close()

	acceptMsg := recv(t, ch)
	if acceptMsg.Error != "" || acceptMsg.Conn == "" {
		t.Fatalf("accept: %+v", acceptMsg)
	}
	connId := acceptMsg.Conn

	// issue read — blocks until TCP client writes data
	osc(srv, oscMsg{Id: "r1", Call: "read", Conn: connId, N: 1024})

	// TCP client sends data
	if _, err := tcpConn.Write([]byte("ping")); err != nil {
		t.Fatalf("tcp write: %v", err)
	}

	readMsg := recv(t, ch)
	if readMsg.Error != "" {
		t.Fatalf("read error: %s", readMsg.Error)
	}
	decoded, err := base64.StdEncoding.DecodeString(readMsg.Data)
	if err != nil || string(decoded) != "ping" {
		t.Fatalf("read data: err=%v got=%q", err, decoded)
	}

	// write to TCP client from protocol side
	encoded := base64.StdEncoding.EncodeToString([]byte("pong"))
	osc(srv, oscMsg{Id: "w1", Call: "write", Conn: connId, Data: encoded})

	writeMsg := recv(t, ch)
	if writeMsg.Error != "" {
		t.Fatalf("write error: %s", writeMsg.Error)
	}

	// TCP client reads the written data
	buf := make([]byte, 16)
	tcpConn.SetDeadline(time.Now().Add(time.Second))
	n, err := tcpConn.Read(buf)
	if err != nil || string(buf[:n]) != "pong" {
		t.Fatalf("tcp read: n=%d err=%v data=%q", n, err, buf[:n])
	}

	// close the connection from the protocol side
	osc(srv, oscMsg{Call: "close", Conn: connId})

	// TCP side should see connection closed
	tcpConn.SetDeadline(time.Now().Add(time.Second))
	_, err = tcpConn.Read(buf)
	if err == nil {
		t.Fatal("expected error after close, got nil")
	}
}

func TestWriteDoubleInFlight(t *testing.T) {
	srv, ch := makeTestSrv(t)

	osc(srv, oscMsg{Id: "l1", Call: "listen-enter"})
	enterMsg := recv(t, ch)
	if enterMsg.Port == 0 {
		t.Fatalf("listen-enter: %+v", enterMsg)
	}

	osc(srv, oscMsg{Id: "a1", Call: "accept"})

	tcpConn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", enterMsg.Port))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer tcpConn.Close()

	acceptMsg := recv(t, ch)
	if acceptMsg.Conn == "" {
		t.Fatalf("accept: %+v", acceptMsg)
	}
	connId := acceptMsg.Conn

	// large payload so the write goroutine blocks in kernel (slows things down)
	large := make([]byte, 32*1024)
	encoded1 := base64.StdEncoding.EncodeToString(large)
	encoded2 := base64.StdEncoding.EncodeToString([]byte("second"))

	// first write — may block in kernel
	osc(srv, oscMsg{Id: "w1", Call: "write", Conn: connId, Data: encoded1})
	// second write — should error immediately since first is in flight
	osc(srv, oscMsg{Id: "w2", Call: "write", Conn: connId, Data: encoded2})

	// drain w1 result (may succeed or fail depending on kernel buffer)
	// drain w2 result (should be the immediate error)
	var w1, w2 outMsg
	for i := 0; i < 2; i++ {
		msg := recv(t, ch)
		if msg.Id == "w1" {
			w1 = msg
		} else if msg.Id == "w2" {
			w2 = msg
		}
	}
	_ = w1
	if w2.Error == "" {
		t.Error("expected error for second in-flight write on same conn")
	}
}

func TestShutdown(t *testing.T) {
	srv, ch := makeTestSrv(t)

	osc(srv, oscMsg{Id: "l1", Call: "listen-enter"})
	enterMsg := recv(t, ch)
	if enterMsg.Port == 0 {
		t.Fatalf("listen-enter: %+v", enterMsg)
	}

	osc(srv, oscMsg{Id: "a1", Call: "accept"})

	tcpConn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", enterMsg.Port))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer tcpConn.Close()

	acceptMsg := recv(t, ch)
	if acceptMsg.Conn == "" {
		t.Fatalf("accept: %+v", acceptMsg)
	}
	connId := acceptMsg.Conn

	// half-close the write side — TCP client should see EOF on next read
	osc(srv, oscMsg{Call: "shutdown", Conn: connId})

	// TCP client reads and expects EOF
	buf := make([]byte, 16)
	tcpConn.SetDeadline(time.Now().Add(time.Second))
	n, err := tcpConn.Read(buf)
	if n != 0 || err != io.EOF {
		t.Fatalf("expected EOF after shutdown, got n=%d err=%v", n, err)
	}
}
