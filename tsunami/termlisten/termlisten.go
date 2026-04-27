// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package termlisten implements the client side of the OSC 9010 terminal listen protocol.
// A remote process calls MakeListener() to ask the local terminal (Wave) to open an ephemeral
// TCP port on the user's machine. Connections to that port are forwarded to the remote
// process as byte streams over OSC sequences and stdin injection.
//
// Framing:
//
//	Remote → Wave:  \x1b]9010;{json}\x07          (OSC 9010)
//	Wave → Remote:  ##listen{json}\n               (injected into stdin)
package termlisten

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/term"
)

var _ net.Listener = (*Listener)(nil)

const (
	MaxPayloadSize         = 65536
	ListenHandshakeTimeout = 2000 * time.Millisecond
	ListenBacklog          = 128

	oscPrefix          = "\x1b]9010;"
	oscSuffix          = "\x07"
	stdinPrefix        = "##listen"
	stdinReaderBufSize = 256 * 1024
)

// oscMsg is sent Remote→Wave via OSC 9010.
type oscMsg struct {
	Id   string `json:"id,omitempty"`
	Call string `json:"call,omitempty"`
	Conn string `json:"conn,omitempty"`
	N    int    `json:"n,omitempty"`
	Data string `json:"data,omitempty"`
}

// inMsg is received Wave→Remote via the ##listen prefix injected into stdin.
type inMsg struct {
	Id    string `json:"id,omitempty"`
	Port  int    `json:"port,omitempty"`
	Conn  string `json:"conn,omitempty"`
	Addr  string `json:"addr,omitempty"`
	Data  string `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// global state — all fields protected by globalSessLock.
var (
	stdinOnce       sync.Once
	globalSessLock  sync.Mutex
	globalSess      *session
	listenerCreated bool // set on first MakeListener call; never cleared
	stdoutMu        sync.Mutex
	outputWriter    io.Writer = os.Stdout
)

// SetOutput overrides the writer used for outgoing OSC frames. Defaults to os.Stdout.
// Must be called before MakeListener.
func SetOutput(w io.Writer) {
	stdoutMu.Lock()
	defer stdoutMu.Unlock()
	outputWriter = w
}

// resetForTesting resets all package-level state so MakeListener can be called again.
// Only for use in tests.
func resetForTesting() {
	globalSessLock.Lock()
	listenerCreated = false
	globalSess = nil
	stdinOnce = sync.Once{}
	globalSessLock.Unlock()
	stdoutMu.Lock()
	outputWriter = os.Stdout
	stdoutMu.Unlock()
}

// claimListener marks the listener as created. Returns an error if already claimed.
func claimListener() error {
	globalSessLock.Lock()
	defer globalSessLock.Unlock()
	if listenerCreated {
		return fmt.Errorf("termlisten: MakeListener may only be called once per process")
	}
	listenerCreated = true
	return nil
}

func setGlobalSession(s *session) {
	globalSessLock.Lock()
	defer globalSessLock.Unlock()
	globalSess = s
}

func getGlobalSession() *session {
	globalSessLock.Lock()
	defer globalSessLock.Unlock()
	return globalSess
}

func clearSessionIfEqual(s *session) {
	globalSessLock.Lock()
	defer globalSessLock.Unlock()
	if globalSess == s {
		globalSess = nil
	}
}

// startStdinReader starts the stdin reader goroutine on the first call; subsequent calls
// are no-ops. pw receives all non-protocol bytes and is closed when r is exhausted.
func startStdinReader(r io.Reader, pw *io.PipeWriter) {
	stdinOnce.Do(func() {
		go stdinReaderLoop(r, pw)
	})
}

func stdinReaderLoop(r io.Reader, pw *io.PipeWriter) {
	reader := bufio.NewReaderSize(r, stdinReaderBufSize)
	for {
		line, err := reader.ReadString('\n')
		if line != "" {
			trimmed := strings.TrimRight(line, "\r\n")
			if strings.HasPrefix(trimmed, stdinPrefix) {
				jsonStr := trimmed[len(stdinPrefix):]
				var msg inMsg
				if jsonErr := json.Unmarshal([]byte(jsonStr), &msg); jsonErr == nil && msg.Id != "" {
					if s := getGlobalSession(); s != nil {
						s.dispatch(&msg)
					}
				}
			} else if pw != nil {
				pw.Write([]byte(line))
			}
		}
		if err != nil {
			if s := getGlobalSession(); s != nil {
				s.teardown()
			}
			if pw != nil {
				pw.CloseWithError(err)
			}
			return
		}
	}
}

type session struct {
	mu            sync.Mutex
	port          int
	closed        bool
	oldState      *term.State // nil if reader is not a terminal
	termFd        int         // -1 if reader is not a terminal
	pending       map[string]chan *inMsg
	conns         map[string]*Conn
	acceptPending bool
}

func newSession(oldState *term.State, termFd int) *session {
	return &session{
		oldState: oldState,
		termFd:   termFd,
		pending:  make(map[string]chan *inMsg),
		conns:    make(map[string]*Conn),
	}
}

func (s *session) registerPending(id string) chan *inMsg {
	ch := make(chan *inMsg, 1)
	s.mu.Lock()
	s.pending[id] = ch
	s.mu.Unlock()
	return ch
}

func (s *session) unregisterPending(id string) {
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
}

func (s *session) dispatch(msg *inMsg) {
	s.mu.Lock()
	ch, ok := s.pending[msg.Id]
	if ok {
		delete(s.pending, msg.Id)
	}
	s.mu.Unlock()
	if ok {
		ch <- msg
	}
}

func (s *session) teardown() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	pending := s.pending
	s.pending = make(map[string]chan *inMsg)
	conns := s.conns
	s.conns = make(map[string]*Conn)
	oldState := s.oldState
	termFd := s.termFd
	s.mu.Unlock()

	for _, ch := range pending {
		select {
		case ch <- &inMsg{Error: "session closed"}:
		default:
		}
	}
	for _, conn := range conns {
		conn.markClosed()
	}

	clearSessionIfEqual(s)

	if oldState != nil && termFd >= 0 {
		term.Restore(termFd, oldState)
	}
}

// Listener implements net.Listener over the OSC listen protocol.
type Listener struct {
	mu     sync.Mutex
	sess   *session
	port   int
	addr   net.Addr
	closed bool
	reader io.Reader // retained for Reenter()
}

// MakeListener enters listen mode using r as the source of Wave→Remote frames.
// If r is an *os.File backed by a terminal, raw mode is enabled automatically.
// Returns a Listener, a passthrough reader carrying all non-protocol bytes from r,
// and an error if the handshake fails or the terminal does not support the protocol.
func MakeListener(r io.Reader) (*Listener, io.Reader, error) {
	if err := claimListener(); err != nil {
		return nil, nil, err
	}

	var oldState *term.State
	termFd := -1

	if f, ok := r.(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		termFd = int(f.Fd())
		var err error
		oldState, err = term.MakeRaw(termFd)
		if err != nil {
			return nil, nil, fmt.Errorf("termlisten: set raw mode: %w", err)
		}
	}

	pr, pw := io.Pipe()

	sess := newSession(oldState, termFd)
	setGlobalSession(sess)
	startStdinReader(r, pw)

	id := uuid.New().String()
	ch := sess.registerPending(id)
	if err := sendOSC(oscMsg{Id: id, Call: "listen-enter"}); err != nil {
		setGlobalSession(nil)
		if oldState != nil {
			term.Restore(termFd, oldState)
		}
		return nil, nil, fmt.Errorf("termlisten: send listen-enter: %w", err)
	}

	select {
	case msg := <-ch:
		if msg.Error != "" {
			setGlobalSession(nil)
			if oldState != nil {
				term.Restore(termFd, oldState)
			}
			return nil, nil, fmt.Errorf("termlisten: listen-enter: %s", msg.Error)
		}
		sess.port = msg.Port
	case <-time.After(ListenHandshakeTimeout):
		setGlobalSession(nil)
		if oldState != nil {
			term.Restore(termFd, oldState)
		}
		return nil, nil, fmt.Errorf("termlisten: handshake timeout — terminal does not support the protocol")
	}

	addr := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: sess.port}
	l := &Listener{sess: sess, port: sess.port, addr: addr, reader: r}
	return l, pr, nil
}

// Listen is a convenience wrapper that calls MakeListener(os.Stdin).
func Listen() (*Listener, io.Reader, error) {
	return MakeListener(os.Stdin)
}

// Accept waits for the next incoming connection. Only one Accept may be in flight at a time.
func (l *Listener) Accept() (net.Conn, error) {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil, net.ErrClosed
	}
	sess := l.sess
	l.mu.Unlock()

	sess.mu.Lock()
	if sess.closed {
		sess.mu.Unlock()
		return nil, net.ErrClosed
	}
	if sess.acceptPending {
		sess.mu.Unlock()
		return nil, fmt.Errorf("termlisten: accept already in progress")
	}
	sess.acceptPending = true
	sess.mu.Unlock()

	id := uuid.New().String()
	ch := sess.registerPending(id)
	if err := sendOSC(oscMsg{Id: id, Call: "accept"}); err != nil {
		sess.mu.Lock()
		sess.acceptPending = false
		sess.mu.Unlock()
		sess.unregisterPending(id)
		return nil, err
	}

	msg := <-ch

	sess.mu.Lock()
	sess.acceptPending = false
	sess.mu.Unlock()

	if msg.Error != "" {
		return nil, fmt.Errorf("termlisten: accept: %s", msg.Error)
	}

	var remoteAddr net.Addr
	if msg.Addr != "" {
		if addr, parseErr := net.ResolveTCPAddr("tcp", msg.Addr); parseErr == nil {
			remoteAddr = addr
		}
	}
	if remoteAddr == nil {
		remoteAddr = &net.TCPAddr{IP: net.ParseIP("127.0.0.1")}
	}

	conn := &Conn{
		session:    sess,
		connId:     msg.Conn,
		localAddr:  l.Addr(),
		remoteAddr: remoteAddr,
	}
	sess.mu.Lock()
	sessWasClosed := sess.closed
	if !sessWasClosed {
		sess.conns[msg.Conn] = conn
	}
	sess.mu.Unlock()

	if sessWasClosed {
		return nil, net.ErrClosed
	}
	return conn, nil
}

// Close exits listen mode, restores the terminal, and closes all open connections.
func (l *Listener) Close() error {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil
	}
	l.closed = true
	sess := l.sess
	l.mu.Unlock()

	sendFireAndForget(oscMsg{Call: "listen-exit"})
	sess.teardown()
	return nil
}

// Addr returns the listener's network address (127.0.0.1:port).
func (l *Listener) Addr() net.Addr {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.addr
}

// Port returns the current ephemeral port number.
func (l *Listener) Port() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.port
}

// Reenter performs a fresh listen-enter handshake, intended to be called after SIGCONT.
// It re-enables raw mode (if the reader is a terminal) and re-establishes the listen session
// with a new ephemeral port. The listener's port and address are updated in place.
func (l *Listener) Reenter() (int, error) {
	l.mu.Lock()
	r := l.reader
	l.mu.Unlock()

	var oldState *term.State
	termFd := -1

	if f, ok := r.(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		termFd = int(f.Fd())
		var err error
		oldState, err = term.MakeRaw(termFd)
		if err != nil {
			return 0, fmt.Errorf("termlisten: set raw mode: %w", err)
		}
	}

	sess := newSession(oldState, termFd)
	setGlobalSession(sess)
	startStdinReader(r, nil) // no-op: loop already running

	id := uuid.New().String()
	ch := sess.registerPending(id)
	if err := sendOSC(oscMsg{Id: id, Call: "listen-enter"}); err != nil {
		setGlobalSession(nil)
		if oldState != nil {
			term.Restore(termFd, oldState)
		}
		return 0, fmt.Errorf("termlisten: send listen-enter: %w", err)
	}

	select {
	case msg := <-ch:
		if msg.Error != "" {
			setGlobalSession(nil)
			if oldState != nil {
				term.Restore(termFd, oldState)
			}
			return 0, fmt.Errorf("termlisten: listen-enter: %s", msg.Error)
		}
		sess.port = msg.Port
		addr := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: msg.Port}
		l.mu.Lock()
		l.sess = sess
		l.port = msg.Port
		l.addr = addr
		l.closed = false
		l.mu.Unlock()
		return msg.Port, nil
	case <-time.After(ListenHandshakeTimeout):
		setGlobalSession(nil)
		if oldState != nil {
			term.Restore(termFd, oldState)
		}
		return 0, fmt.Errorf("termlisten: handshake timeout")
	}
}

// sendOSC writes an OSC 9010 frame atomically to outputWriter.
func sendOSC(msg oscMsg) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	frame := oscPrefix + string(data) + oscSuffix
	stdoutMu.Lock()
	_, err = io.WriteString(outputWriter, frame)
	stdoutMu.Unlock()
	return err
}

func sendFireAndForget(msg oscMsg) {
	_ = sendOSC(msg)
}
