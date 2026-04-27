// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package termlisten

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"github.com/google/uuid"
)

var _ net.Conn = (*Conn)(nil)

// Conn implements net.Conn over the OSC listen protocol.
// Read and Write are blocking calls that resolve when Wave responds.
// Only one Write may be in flight per connection at a time (protocol flow control).
type Conn struct {
	session    *session
	connId     string
	localAddr  net.Addr
	remoteAddr net.Addr

	mu            sync.Mutex
	closed        bool
	writeShutdown bool
	readDeadline  time.Time
	writeDeadline time.Time
}

func (c *Conn) markClosed() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
}

// Read reads up to len(b) bytes from the connection.
// Returns io.EOF when the local client closes the connection.
// At most MaxPayloadSize bytes are requested per call.
func (c *Conn) Read(b []byte) (int, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return 0, io.ErrClosedPipe
	}
	deadline := c.readDeadline
	c.mu.Unlock()

	n := len(b)
	if n > MaxPayloadSize {
		n = MaxPayloadSize
	}
	if n == 0 {
		return 0, nil
	}

	id := uuid.New().String()
	ch := c.session.registerPending(id)
	if err := sendOSC(oscMsg{Id: id, Call: "read", Conn: c.connId, N: n}); err != nil {
		c.session.unregisterPending(id)
		return 0, err
	}

	msg, err := waitMsg(ch, deadline)
	if err != nil {
		c.session.unregisterPending(id)
		sendFireAndForget(oscMsg{Call: "close", Conn: c.connId})
		c.markClosed()
		return 0, err
	}

	if msg.Error != "" {
		return 0, fmt.Errorf("termlisten: read: %s", msg.Error)
	}
	if msg.Data == "" {
		return 0, io.EOF
	}

	decoded, err := base64.StdEncoding.DecodeString(msg.Data)
	if err != nil {
		return 0, fmt.Errorf("termlisten: read base64 decode: %w", err)
	}
	return copy(b, decoded), nil
}

// Write sends data to the connection, chunking at MaxPayloadSize boundaries.
// Only one Write may be in flight at a time per connection.
func (c *Conn) Write(b []byte) (int, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return 0, io.ErrClosedPipe
	}
	if c.writeShutdown {
		c.mu.Unlock()
		return 0, fmt.Errorf("termlisten: write after shutdown")
	}
	deadline := c.writeDeadline
	c.mu.Unlock()

	total := 0
	for len(b) > 0 {
		chunk := b
		if len(chunk) > MaxPayloadSize {
			chunk = b[:MaxPayloadSize]
		}

		id := uuid.New().String()
		ch := c.session.registerPending(id)
		encoded := base64.StdEncoding.EncodeToString(chunk)

		if err := sendOSC(oscMsg{Id: id, Call: "write", Conn: c.connId, Data: encoded}); err != nil {
			c.session.unregisterPending(id)
			return total, err
		}

		msg, err := waitMsg(ch, deadline)
		if err != nil {
			c.session.unregisterPending(id)
			sendFireAndForget(oscMsg{Call: "close", Conn: c.connId})
			c.markClosed()
			return total, err
		}
		if msg.Error != "" {
			return total, fmt.Errorf("termlisten: write: %s", msg.Error)
		}

		total += len(chunk)
		b = b[len(chunk):]
	}
	return total, nil
}

// Close closes the connection. Safe to call multiple times.
// The local client receives EOF on its next read.
func (c *Conn) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	connId := c.connId
	sess := c.session
	c.mu.Unlock()

	sess.mu.Lock()
	delete(sess.conns, connId)
	sess.mu.Unlock()

	sendFireAndForget(oscMsg{Call: "close", Conn: connId})
	return nil
}

// CloseWrite half-closes the connection's write side.
// The local client sees EOF on its next read; the connection remains open for reading.
func (c *Conn) CloseWrite() error {
	c.mu.Lock()
	if c.closed || c.writeShutdown {
		c.mu.Unlock()
		return nil
	}
	c.writeShutdown = true
	connId := c.connId
	c.mu.Unlock()

	sendFireAndForget(oscMsg{Call: "shutdown", Conn: connId})
	return nil
}

func (c *Conn) LocalAddr() net.Addr  { return c.localAddr }
func (c *Conn) RemoteAddr() net.Addr { return c.remoteAddr }

func (c *Conn) SetDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readDeadline = t
	c.writeDeadline = t
	return nil
}

func (c *Conn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readDeadline = t
	return nil
}

func (c *Conn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writeDeadline = t
	return nil
}

// waitMsg waits for a response on ch, respecting an optional deadline.
// On deadline expiry it returns an error; the caller is responsible for closing the conn.
func waitMsg(ch chan *inMsg, deadline time.Time) (*inMsg, error) {
	if deadline.IsZero() {
		return <-ch, nil
	}
	d := time.Until(deadline)
	if d <= 0 {
		return nil, fmt.Errorf("termlisten: deadline exceeded")
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case msg := <-ch:
		return msg, nil
	case <-timer.C:
		return nil, fmt.Errorf("termlisten: deadline exceeded")
	}
}
