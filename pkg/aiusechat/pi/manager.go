// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// DefaultBinPath is the default pi binary path. Override via WithBinPath.
const DefaultBinPath = "pi"

// DefaultStartupTimeout is how long we wait for pi to initialize and emit the first prompt.
const DefaultStartupTimeout = 30 * time.Second

// Manager manages a pi subprocess for a single chat session.
// It handles spawning the process, serializing stdin/stdout JSONL framing,
// and dispatching events to registered listeners.
type Manager struct {
	binPath string
	args   []string
	env    []string

	cmd   *exec.Cmd
	stdin io.Writer
	scanner *JSONLScanner

	mu         sync.RWMutex
	state      managerState
	reqIDGen   int64
	cmdCond    sync.Cond
	pendingReqs map[string]chan *RPCResponse
	pendingErr  error

	eventListeners []chan<- RPCEvent

	// tool approval: toolCallID -> approval result channel
	toolApprovals map[string]chan string

	ctx    context.Context
	cancel context.CancelFunc
}

type managerState int

const (
	stateNew managerState = iota
	stateStarting
	stateRunning
	stateDone
)

func (s managerState) String() string {
	switch s {
	case stateNew: return "new"
	case stateStarting: return "starting"
	case stateRunning: return "running"
	case stateDone: return "done"
	default: return fmt.Sprintf("unknown(%d)", int(s))
	}
}

// ManagerConfig configures a new Manager.
type ManagerConfig struct {
	BinPath  string
	Args     []string
	Env      []string
	Provider string
	ModelID  string
	// SessionDir sets --session-dir. If empty, pi uses its default.
	SessionDir string
	// NoSession disables session persistence (--no-session).
	NoSession bool
}

// NewManager creates a new pi subprocess manager.
func NewManager(ctx context.Context, cfg ManagerConfig) (*Manager, error) {
	if cfg.BinPath == "" {
		cfg.BinPath = DefaultBinPath
	}

	args := []string{"--mode", "rpc"}
	if cfg.Provider != "" {
		args = append(args, "--provider", cfg.Provider)
	}
	if cfg.ModelID != "" {
		args = append(args, "--model", cfg.ModelID)
	}
	if cfg.SessionDir != "" {
		args = append(args, "--session-dir", cfg.SessionDir)
	}
	if cfg.NoSession {
		args = append(args, "--no-session")
	}
	args = append(args, cfg.Args...)

	cmd := exec.Command(cfg.BinPath, args...)
	if cfg.Env != nil {
		cmd.Env = cfg.Env
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stderr pipe: %w", err)
	}

	// Read stderr in a goroutine so it doesn't fill the buffer
	stderrDone := make(chan struct{})
	go func() {
		defer close(stderrDone)
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				// Could log this to a buffer or discard; for now just eat it
				_ = n
			}
			if err != nil {
				break
			}
		}
	}()

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start pi: %w", err)
	}

	mgrCtx, cancel := context.WithCancel(ctx)
	m := &Manager{
		binPath:       cfg.BinPath,
		args:          args,
		env:           cfg.Env,
		cmd:           cmd,
		stdin:         stdin,
		scanner:       NewJSONLScanner(stdout),
		pendingReqs:   make(map[string]chan *RPCResponse),
		toolApprovals: make(map[string]chan string),
		ctx:           mgrCtx,
		cancel:        cancel,
	}
	m.cmdCond.L = &m.mu

	// Start event reader loop
	go m.readLoop(stderrDone)

	// Wait for pi to initialize (it emits events once ready)
	if err := m.waitForReady(DefaultStartupTimeout); err != nil {
		m.Kill()
		return nil, fmt.Errorf("pi startup failed: %w", err)
	}

	return m, nil
}

// waitForReady waits until pi has started and is ready to receive commands.
// pi signals readiness by emitting the first event on stdout after startup.
func (m *Manager) waitForReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		state := m.state
		readyErr := m.pendingErr
		m.mu.Unlock()
		if state == stateRunning {
			return nil
		}
		if readyErr != nil {
			return readyErr
		}
		if state == stateDone {
			return fmt.Errorf("pi process exited during startup")
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("pi startup timed out after %v", timeout)
}

func (m *Manager) readLoop(stderrDone <-chan struct{}) {
	defer func() {
		m.mu.Lock()
		m.state = stateDone
		m.mu.Unlock()

		// Wait for stderr to drain (avoid broken pipe on cmd.Wait)
		<-stderrDone
		m.cmd.Wait()

		// Resolve all pending requests with an error
		m.mu.Lock()
		for id, ch := range m.pendingReqs {
			ch <- &RPCResponse{
				Type:    "response",
				Command: "internal",
				Success: false,
				Error:   "pi process exited",
			}
			delete(m.pendingReqs, id)
		}
		m.mu.Unlock()
	}()

	for {
		rec, err := m.scanner.Next()
		if err != nil {
			m.mu.Lock()
			if m.state != stateDone {
				m.pendingErr = fmt.Errorf("JSONL read error: %w", err)
			}
			m.mu.Unlock()
			return
		}
		if rec == nil {
			// EOF
			return
		}

		var base struct {
			ID     string `json:"id,omitempty"`
			Type   string `json:"type"`
		}
		if err := json.Unmarshal(rec, &base); err != nil {
			// Non-JSON output (shouldn't happen in normal mode)
			continue
		}

		if base.Type == "response" {
			// Synchronous command response
			var resp RPCResponse
			if err := json.Unmarshal(rec, &resp); err != nil {
				continue
			}
			if base.ID != "" {
				m.mu.Lock()
				ch, ok := m.pendingReqs[base.ID]
				if ok {
					ch <- &resp
					delete(m.pendingReqs, base.ID)
				}
				m.mu.Unlock()
			}
		} else {
			// Event — dispatch to all listeners
			ev, err := RPCEventDecoder{}.Decode(rec)
			if err != nil {
				continue
			}
			m.dispatchEvent(ev)
		}
	}
}

// dispatchEvent sends an event to all registered listeners.
func (m *Manager) dispatchEvent(ev RPCEvent) {
	m.mu.RLock()
	listeners := m.eventListeners
	m.mu.RUnlock()

	for _, ch := range listeners {
		select {
		case ch <- ev:
		default:
			// Non-blocking: don't block event dispatch
		}
	}
}

// SendCommand sends a command to pi and waits for the response.
// It handles JSONL framing: writes a single LF-terminated JSON record.
func (m *Manager) SendCommand(ctx context.Context, cmd RPCCommand) (*RPCResponse, error) {
	// Generate request ID
	reqID := fmt.Sprintf("%s-%d", uuid.New().String()[:8], atomic.AddInt64(&m.reqIDGen, 1))
	cmd.ID = reqID

	// Serialize command as a single JSON line
	frame, err := json.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal command: %w", err)
	}
	frame = append(frame, '\n')

	// Enqueue response channel BEFORE writing to avoid race
	respCh := make(chan *RPCResponse, 1)
	m.mu.Lock()
	m.pendingReqs[reqID] = respCh
	m.mu.Unlock()

	// Write to stdin
	if _, err := m.stdin.Write(frame); err != nil {
		m.mu.Lock()
		delete(m.pendingReqs, reqID)
		m.mu.Unlock()
		return nil, fmt.Errorf("failed to write to pi stdin: %w", err)
	}

	// Wait for response or context cancellation
	select {
	case <-ctx.Done():
		// Remove from pending and send abort
		m.mu.Lock()
		delete(m.pendingReqs, reqID)
		m.mu.Unlock()
		return nil, ctx.Err()
	case resp := <-respCh:
		return resp, nil
	}
}

// SendCommandAsync sends a command without waiting for the response.
// Use this for streaming commands like "prompt" which return immediately.
// The command ID is returned so the caller can correlate responses.
func (m *Manager) SendCommandAsync(cmd RPCCommand) (string, error) {
	reqID := fmt.Sprintf("%s-%d", uuid.New().String()[:8], atomic.AddInt64(&m.reqIDGen, 1))
	cmd.ID = reqID

	frame, err := json.Marshal(cmd)
	if err != nil {
		return "", fmt.Errorf("failed to marshal command: %w", err)
	}
	frame = append(frame, '\n')

	if _, err := m.stdin.Write(frame); err != nil {
		return "", fmt.Errorf("failed to write to pi stdin: %w", err)
	}
	return reqID, nil
}

// RegisterEventListener registers a channel to receive all pi RPC events.
// The caller must drain the channel to avoid blocking event dispatch.
// The returned unsubscribe function removes the listener.
func (m *Manager) RegisterEventListener() chan RPCEvent {
	ch := make(chan RPCEvent, 50)
	m.mu.Lock()
	m.eventListeners = append(m.eventListeners, ch)
	m.mu.Unlock()
	return ch
}

func (m *Manager) UnregisterEventListener(ch chan RPCEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, l := range m.eventListeners {
		if l == ch {
			m.eventListeners = append(m.eventListeners[:i], m.eventListeners[i+1:]...)
			close(ch)
			return
		}
	}
}

// ApproveTool registers approval for a tool call. result is one of:
// uctypes.ApprovalApproved, uctypes.ApprovalUserDenied, uctypes.ApprovalTimeout.
// This unblocks the corresponding WaitForToolApproval call.
func (m *Manager) ApproveTool(toolCallID string, result string) {
	m.mu.Lock()
	ch, ok := m.toolApprovals[toolCallID]
	if ok {
		ch <- result
		delete(m.toolApprovals, toolCallID)
	}
	m.mu.Unlock()
}

// WaitForToolApproval blocks until a tool requires approval.
// It returns the approval result once the frontend resolves it.
func (m *Manager) WaitForToolApproval(toolCallID string) string {
	ch := make(chan string, 1)
	m.mu.Lock()
	m.toolApprovals[toolCallID] = ch
	m.mu.Unlock()

	select {
	case result := <-ch:
		return result
	case <-m.ctx.Done():
		return "timeout"
	}
}

// State returns the current manager state.
func (m *Manager) State() managerState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

// PID returns the process ID of the pi subprocess.
func (m *Manager) PID() int {
	return m.cmd.Process.Pid
}

// Kill terminates the pi subprocess immediately.
func (m *Manager) Kill() {
	m.cancel()
	m.mu.Lock()
	if m.state != stateDone {
		m.state = stateDone
		m.cmd.Process.Kill()
	}
	m.mu.Unlock()
}

// BuildCommand builds a pi invocation command slice.
// Use this to present the user with a displayable command (e.g., for settings UI).
func BuildCommand(provider, modelID, sessionDir string, noSession bool) []string {
	var cmd []string
	if provider != "" {
		cmd = append(cmd, "--provider", provider)
	}
	if modelID != "" {
		cmd = append(cmd, "--model", modelID)
	}
	if sessionDir != "" {
		cmd = append(cmd, "--session-dir", sessionDir)
	}
	if noSession {
		cmd = append(cmd, "--no-session")
	}
	return cmd
}

// WaveTabContext holds the context from a waveterm tab that we inject into pi.
type WaveTabContext struct {
	TabID         string
	WorkingDir    string
	ShellType     string
	ShellVersion  string
	Connection    string
	BlockIDs      []string // visible block IDs in current view
	UserEnv       map[string]string
}

// AsSystemPrompt returns a pi-compatible system prompt string describing the tab context.
func (c *WaveTabContext) AsSystemPrompt() string {
	var parts []string
	parts = append(parts, "## Wave Terminal Context")
	if c.Connection != "" {
		parts = append(parts, fmt.Sprintf("Connected to: %s", c.Connection))
	}
	if c.ShellType != "" {
		shell := c.ShellType
		if c.ShellVersion != "" {
			shell += " " + c.ShellVersion
		}
		parts = append(parts, fmt.Sprintf("Shell: %s", shell))
	}
	if c.WorkingDir != "" {
		parts = append(parts, fmt.Sprintf("Working directory: %s", c.WorkingDir))
	}
	parts = append(parts, "This is a pi coding agent session running inside waveterm.")
	return strings.Join(parts, "\n")
}
