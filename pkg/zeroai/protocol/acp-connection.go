// Package protocol implements ACP (Agent Control Protocol) connection management
//
// This file provides the core ACP connection implementation including:
// - Process communication over stdio
// - JSON-RPC request/response handling
// - Session management
// - Streaming support
// - permission routing
package protocol

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
)

// ConnectionState represents the connection state
type ConnectionState int

const (
	ConnectionStateDisconnected ConnectionState = iota
	ConnectionStateConnecting
	ConnectionStateConnected
	ConnectionStateClosing
)

// ConnectionStatus represents the connection status
type ConnectionStatus struct {
	State       ConnectionState `json:"state"`
	HasSession  bool            `json:"hasSession"`
	LastError   error           `json:"lastError,omitempty"`
	LastSeen    time.Time       `json:"lastSeen"`
	ProcessID   int             `json:"processId,omitempty"`
}

// PendingRequest represents an in-flight JSON-RPC request waiting for response
type PendingRequest struct {
	ID        int
	Method    string
	Response  chan *AcpResponse
	Timeout   time.Duration
	CreatedAt time.Time
}

// StreamCallback is called for each chunk of streaming data
type StreamCallback func(*AcpSessionUpdate) error

// AcpCallbacks contains callbacks for various ACP events
type AcpCallbacks struct {
	// OnSessionUpdate is called for session update notifications
	OnSessionUpdate func(*AcpSessionUpdate) error

	// OnPermission is called when agent requests permission
	OnPermission func(*AcpPermissionRequest) error

	// OnError is called when fatal errors occur
	OnError func(error)

	// OnDisconnect is called when connection is lost
	OnDisconnect func(*AcpDisconnectInfo)
}

// AcpConnection represents an ACP connection to an agent process
type AcpConnection struct {
	mu sync.RWMutex

	// Connection state
	state      atomic.Int32 // ConnectionState
	config     AcpSessionConfig
	process    *exec.Cmd
	processID  int

	// stdio pipes
	stdin      io.WriteCloser
	stdout     io.Reader
	stderr     io.Reader

	// Session tracking
	sessionID  string
	hasSession bool

	// Request management
	requestID  atomic.Int32
	pendingReq map[int]*PendingRequest
	reqMu      sync.RWMutex

	// Event handling
	callbacks  AcpCallbacks
	background sync.WaitGroup

	// Error tracking
	lastError  error
	lastSeen   atomic.Value // time.Time

	// Channel for signaling shutdown
	shutdownCh chan struct{}
}

// Connection interface provides the ACP connection contract
type Connection interface {
	// Initialize starts the connection and process
	Initialize(config AcpSessionConfig) error

	// Close terminates the connection and cleans up resources
	Close() error

	// IsConnected returns whether the connection is active
	IsConnected() bool

	// HasSession returns whether a session is established
	HasSession() bool

	// GetSessionID returns the current session ID
	GetSessionID() string

	// SetSessionMode sets the session mode before creating a session
	SetSessionMode(mode string)

	// NewSession creates a new session with the agent
	NewSession(ctx context.Context) (*SessionNewResult, error)

	// LoadSession loads an existing session
	LoadSession(ctx context.Context, sessionID string) (*SessionLoadResult, error)

	// SendMessage sends a JSON-RPC request and waits for response
	SendMessage(ctx context.Context, method string, params map[string]interface{}, timeout time.Duration) (*AcpResponse, error)

	// SendNotification sends a JSON-RPC notification (no response expected)
	SendNotification(method string, params map[string]interface{}) error

	// StreamPrompt sends a prompt and receives streaming responses
	StreamPrompt(ctx context.Context, sessionID, prompt string, opts AcpPromptOptions, callback StreamCallback) error

	// ConfirmPermission responds to a permission request
	ConfirmPermission(ctx context.Context, callID, optionID string) error

	// GetStatus returns current connection status
	GetStatus() ConnectionStatus

	// SetCallbacks registers event callbacks
	SetCallbacks(callbacks AcpCallbacks)
}

// NewAcpConnection creates a new ACP connection
func NewAcpConnection() *AcpConnection {
	conn := &AcpConnection{
		pendingReq: make(map[int]*PendingRequest),
		shutdownCh: make(chan struct{}),
	}
	conn.state.Store(int32(ConnectionStateDisconnected))
	return conn
}

// Initialize starts the connection and the agent process
func (c *AcpConnection) Initialize(config AcpSessionConfig) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.GetState() != ConnectionStateDisconnected {
		return fmt.Errorf("connection already initialized")
	}

	c.config = config
	c.state.Store(int32(ConnectionStateConnecting))

	// Build command for the backend CLI
	cliCmd, cliArgs, err := c.buildCommand(config)
	if err != nil {
		return fmt.Errorf("failed to build command: %w", err)
	}

	// Create command with stdio pipes
	c.process = exec.Command(cliCmd, cliArgs...)

	// Set up environment variables
	c.process.Env = os.Environ()
	for k, v := range config.Env {
		c.process.Env = append(c.process.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// Set working directory
	if config.Cwd != "" {
		c.process.Dir = config.Cwd
	}

	// Create stdio pipes
	stdin, err := c.process.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	c.stdin = stdin

	stdout, err := c.process.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	c.stdout = stdout

	stderr, err := c.process.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}
	c.stderr = stderr

	// Start the process
	if err := c.process.Start(); err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}

	c.processID = c.process.Process.Pid
	c.lastSeen.Store(time.Now())

	// Start background reader
	c.background.Add(1)
	go c.readOutputLoop()

	// Start stderr reader
	c.background.Add(1)
	go c.readStderrLoop()

	c.state.Store(int32(ConnectionStateConnected))
	return nil
}

// Close terminates the connection and cleans up resources
func (c *AcpConnection) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.GetState() == ConnectionStateDisconnected {
		return nil
	}

	c.state.Store(int32(ConnectionStateClosing))

	// Signal shutdown
	close(c.shutdownCh)

	// Close stdin first to signal process
	if c.stdin != nil {
		c.stdin.Close()
	}

	// Wait for background readers to finish
	done := make(chan struct{})
	go func() {
		c.background.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		// Force kill if readers don't stop
		if c.process != nil && c.process.Process != nil {
			c.process.Process.Kill()
		}
	}

	// Clear pending requests
	c.reqMu.Lock()
	for _, req := range c.pendingReq {
		close(req.Response)
	}
	c.pendingReq = make(map[int]*PendingRequest)
	c.reqMu.Unlock()

	// Clear session
	c.sessionID = ""
	c.hasSession = false

	c.state.Store(int32(ConnectionStateDisconnected))
	return nil
}

// IsConnected returns whether the connection is active
func (c *AcpConnection) IsConnected() bool {
	return c.GetState() == ConnectionStateConnected
}

// HasSession returns whether a session is established
func (c *AcpConnection) HasSession() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.hasSession
}

// GetSessionID returns the current session ID
func (c *AcpConnection) GetSessionID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.sessionID
}

// SetSessionMode sets the session mode (yolo/bypass permissions)
func (c *AcpConnection) SetSessionMode(mode string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.config.YoloMode = true
}

// GetStatus returns current connection status
func (c *AcpConnection) GetStatus() ConnectionStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()

	state := ConnectionState(c.state.Load())
	lastSeen, _ := c.lastSeen.Load().(time.Time)

	return ConnectionStatus{
		State:       state,
		HasSession:  c.hasSession,
		LastError:   c.lastError,
		LastSeen:    lastSeen,
		ProcessID:   c.processID,
	}
}

// SetCallbacks registers event callbacks
func (c *AcpConnection) SetCallbacks(callbacks AcpCallbacks) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.callbacks = callbacks
}

// GetState returns the current connection state
func (c *AcpConnection) GetState() ConnectionState {
	return ConnectionState(c.state.Load())
}

// NewSession creates a new session with the agent
func (c *AcpConnection) NewSession(ctx context.Context) (*SessionNewResult, error) {
	resp, err := c.SendMessage(ctx, "session/new", map[string]interface{}{
		"cwd": c.config.Cwd,
	}, 30*time.Second)
	if err != nil {
		return nil, err
	}

	if resp.Error != nil {
		return nil, resp.Error
	}

	var result SessionNewResult
	data, err := json.Marshal(resp.Result)
	if err != nil {
		return nil, fmt.Errorf("failed to encode session result: %w", err)
	}

	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("failed to parse session result: %w", err)
	}

	c.mu.Lock()
	c.sessionID = result.SessionID
	c.hasSession = true
	c.mu.Unlock()

	return &result, nil
}

// LoadSession loads an existing session
func (c *AcpConnection) LoadSession(ctx context.Context, sessionID string) (*SessionLoadResult, error) {
	params := map[string]interface{}{
		"sessionId": sessionID,
	}
	if c.config.Cwd != "" {
		params["cwd"] = c.config.Cwd
	}

	resp, err := c.SendMessage(ctx, "session/load", params, 30*time.Second)
	if err != nil {
		return nil, err
	}

	if resp.Error != nil {
		return nil, resp.Error
	}

	var result SessionLoadResult
	data, err := json.Marshal(resp.Result)
	if err != nil {
		return nil, fmt.Errorf("failed to encode load result: %w", err)
	}

	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("failed to parse load result: %w", err)
	}

	if result.SessionID != "" {
		c.mu.Lock()
		c.sessionID = result.SessionID
		c.hasSession = true
		c.mu.Unlock()
	}

	return &result, nil
}

// SendMessage sends a JSON-RPC request and waits for response
func (c *AcpConnection) SendMessage(ctx context.Context, method string, params map[string]interface{}, timeout time.Duration) (*AcpResponse, error) {
	if !c.IsConnected() {
		return nil, &AcpError{
			Type:    ErrorConnection,
			Message: "not connected",
		}
	}

	// Generate request ID
	id := int(c.requestID.Add(1))

	// Create pending request
	respCh := make(chan *AcpResponse, 1)
	req := &PendingRequest{
		ID:        id,
		Method:    method,
		Response:  respCh,
		Timeout:   timeout,
		CreatedAt: time.Now(),
	}

	// Register pending request
	c.reqMu.Lock()
	c.pendingReq[id] = req
	c.reqMu.Unlock()

	// Clean up pending request on exit
	defer func() {
		c.reqMu.Lock()
		delete(c.pendingReq, id)
		c.reqMu.Unlock()
		close(respCh)
	}()

	// Encode and send request
	data, err := EncodeRequest(id, method, params)
	if err != nil {
		return nil, err
	}

	if err := c.sendData(data); err != nil {
		return nil, err
	}

	// Wait for response
	select {
	case resp := <-respCh:
		return resp, nil
	case <-ctx.Done():
		return nil, &AcpError{
			Type:    ErrorTimeout,
			Message: "context canceled while waiting for response",
		}
	case <-time.After(timeout):
		return nil, &AcpError{
			Type:    ErrorTimeout,
			Message: fmt.Sprintf("request timed out after %v", timeout),
		}
	case <-c.shutdownCh:
		return nil, &AcpError{
			Type:    ErrorConnection,
			Message: "connection shutdown",
		}
	}
}

// SendNotification sends a JSON-RPC notification (no response expected)
func (c *AcpConnection) SendNotification(method string, params map[string]interface{}) error {
	if !c.IsConnected() {
		return &AcpError{
			Type:    ErrorConnection,
			Message: "not connected",
		}
	}

	data, err := EncodeNotification(method, params)
	if err != nil {
		return err
	}

	return c.sendData(data)
}

// StreamPrompt sends a prompt and receives streaming responses
func (c *AcpConnection) StreamPrompt(ctx context.Context, sessionID, prompt string, opts AcpPromptOptions, callback StreamCallback) error {
	params := map[string]interface{}{
		"sessionId": sessionID,
		"prompt":    prompt,
	}
	if len(opts.Files) > 0 {
		params["files"] = opts.Files
	}
	if opts.ModelOverride != "" {
		params["model"] = opts.ModelOverride
	}

	if err := c.SendNotification("prompt/stream", params); err != nil {
		return err
	}

	// Streaming responses come via notifications, handled by readOutputLoop
	// The callback will be invoked for each session update
	return nil
}

// ConfirmPermission responds to a permission request
func (c *AcpConnection) ConfirmPermission(ctx context.Context, callID, optionID string) error {
	_, err := c.SendMessage(ctx, "permission/confirm", map[string]interface{}{
		"callId":   callID,
		"optionId": optionID,
	}, 10*time.Second)
	return err
}

// sendData writes data to stdin with newline
func (c *AcpConnection) sendData(data []byte) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.stdin == nil {
		return &AcpError{
			Type:    ErrorConnection,
			Message: "stdin not available",
		}
	}

	// Ensure message ends with newline
	buf := data
	if !bytes.HasSuffix(buf, []byte("\n")) {
		buf = append(buf, '\n')
	}

	if _, err := c.stdin.Write(buf); err != nil {
		return fmt.Errorf("failed to write to stdin: %w", err)
	}

	c.lastSeen.Store(time.Now())
	return nil
}

// readOutputLoop reads and processes JSON-RPC messages from stdout
func (c *AcpConnection) readOutputLoop() {
	defer c.background.Done()

	scanner := bufio.NewScanner(c.stdout)

	for {
		select {
		case <-c.shutdownCh:
			return
		default:
		}

		if !scanner.Scan() {
			// Process ended or error
			if err := scanner.Err(); err != nil {
				c.handleDisconnect(&AcpDisconnectInfo{
					Reason: "stdout read error",
				})
			} else {
				c.handleDisconnect(&AcpDisconnectInfo{
					Reason: "process ended",
				})
			}
			return
		}

		line := scanner.Bytes()
		c.lastSeen.Store(time.Now())

		// Decode message
		msg, err := DecodeMessage(line)
		if err != nil {
			c.logError(fmt.Sprintf("decode error: %v", err))
			continue
		}

		// Process message
		switch m := msg.(type) {
		case *AcpResponse:
			c.handleResponse(m)
		case *AcpNotification:
			c.handleNotification(m)
		}
	}
}

// readStderrLoop reads stderr for potential error messages
func (c *AcpConnection) readStderrLoop() {
	defer c.background.Done()

	scanner := bufio.NewScanner(c.stderr)
	for scanner.Scan() {
		line := scanner.Text()
		// Log stderr messages - could be sent to a callback
		c.logError(fmt.Sprintf("stderr: %s", line))
	}
}

// handleResponse routes a response to the pending request or callbacks
func (c *AcpConnection) handleResponse(resp *AcpResponse) {
	c.reqMu.RLock()
	req, exists := c.pendingReq[resp.ID]
	c.reqMu.RUnlock()

	if exists {
		select {
		case req.Response <- resp:
		default:
			// Channel full or closed
		}
	} else {
		// Unknown response - might be an async callback
		// Could forward to OnError callback
	}
}

// handleNotification processes incoming notifications
func (c *AcpConnection) handleNotification(notif *AcpNotification) {
	switch notif.Method {
	case "session/update":
		c.handleSessionUpdate(notif.Params)
	case "permission/request":
		c.handlePermissionRequest(notif.Params)
	case "error":
		c.handleErrorNotification(notif.Params)
	}
}

// handleSessionUpdate processes session update notifications
func (c *AcpConnection) handleSessionUpdate(params map[string]interface{}) {
	var update AcpSessionUpdate
	data, err := json.Marshal(params)
	if err != nil {
		c.logError(fmt.Sprintf("failed to encode session update: %v", err))
		return
	}

	if err := json.Unmarshal(data, &update); err != nil {
		c.logError(fmt.Sprintf("failed to parse session update: %v", err))
		return
	}

	c.mu.RLock()
	callbacks := c.callbacks
	c.mu.RUnlock()

	if callbacks.OnSessionUpdate != nil {
		if err := callbacks.OnSessionUpdate(&update); err != nil {
			c.logError(fmt.Sprintf("session update callback error: %v", err))
		}
	}
}

// handlePermissionRequest processes permission request notifications
func (c *AcpConnection) handlePermissionRequest(params map[string]interface{}) {
	var permReq AcpPermissionRequest
	data, err := json.Marshal(params)
	if err != nil {
		c.logError(fmt.Sprintf("failed to encode permission request: %v", err))
		return
	}

	if err := json.Unmarshal(data, &permReq); err != nil {
		c.logError(fmt.Sprintf("failed to parse permission request: %v", err))
		return
	}

	c.mu.RLock()
	callbacks := c.callbacks
	c.mu.RUnlock()

	if callbacks.OnPermission != nil {
		if err := callbacks.OnPermission(&permReq); err != nil {
			c.logError(fmt.Sprintf("permission callback error: %v", err))
		}
	}
}

// handleErrorNotification processes error notifications
func (c *AcpConnection) handleErrorNotification(params map[string]interface{}) {
	var errMsg struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	}
	data, err := json.Marshal(params)
	if err != nil {
		return
	}
	json.Unmarshal(data, &errMsg)

	c.logError(fmt.Sprintf("notification error: %s - %s", errMsg.Type, errMsg.Message))
}

// handleDisconnect handles disconnection events
func (c *AcpConnection) handleDisconnect(info *AcpDisconnectInfo) {
	c.state.Store(int32(ConnectionStateDisconnected))

	c.mu.RLock()
	callbacks := c.callbacks
	c.mu.RUnlock()

	if callbacks.OnDisconnect != nil {
		callbacks.OnDisconnect(info)
	}
}

// logError logs errors - could be enhanced with proper logging
func (c *AcpConnection) logError(msg string) {
	c.mu.Lock()
	c.lastError = fmt.Errorf("%s", msg)
	c.mu.Unlock()

	c.mu.RLock()
	callbacks := c.callbacks
	c.mu.RUnlock()

	if callbacks.OnError != nil {
		callbacks.OnError(fmt.Errorf("%s", msg))
	}
}

// buildCommand builds the CLI command and arguments based on backend
func (c *AcpConnection) buildCommand(config AcpSessionConfig) (string, []string, error) {
	cliPath := config.CliPath
	if cliPath == "" {
		backendCfg, err := GetBackendConfig(config.Backend)
		if err != nil {
			return "", nil, fmt.Errorf("failed to get backend config: %w", err)
		}
		cliPath = backendCfg.DefaultCliPath
	}

	if cliPath == "" {
		return "", nil, fmt.Errorf("no CLI path specified and no default found")
	}

	// Build ACP arguments
	backendCfg, err := GetBackendConfig(config.Backend)
	if err != nil {
		return "", nil, fmt.Errorf("failed to get backend config: %w", err)
	}
	args := []string{}
	args = append(args, backendCfg.AcpArgs...)

	return cliPath, args, nil
}
