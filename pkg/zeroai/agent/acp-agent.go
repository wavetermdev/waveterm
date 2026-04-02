// Package agent implements ACP-based AI agents
//
// This file provides the AcpAgent implementation which wraps the ACP connection
// and provides a clean interface for interacting with AI agents.
package agent

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/zeroai/protocol"
	"github.com/wavetermdev/waveterm/pkg/zeroai/types"
)

// AcpAgent implements the Agent interface using ACP protocol
type AcpAgent struct {
	mu sync.RWMutex

	// Agent configuration
	config    AgentConfig
	backend   protocol.AcpBackend
	conn      protocol.Connection
	adapter   *protocol.AcpAdapter

	// Session management
	sessions  map[string]*AgentSession
	activeSession string

	// Event channels
	eventChs    map[string]chan AgentEvent // sessionID -> event channel
	eventChsMu  sync.RWMutex

	// Status
	status     AgentStatus
	running    bool

	// Context for cancellation
	ctx        context.Context
	cancel     context.CancelFunc
}

// NewAcpAgent creates a new ACP agent
func NewAcpAgent(config AgentConfig) (Agent, error) {
	// Parse backend string
	backend, err := protocol.GetBackendFromString(config.Backend)
	if err != nil {
		return nil, fmt.Errorf("invalid backend: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	agent := &AcpAgent{
		config:   config,
		backend:  backend,
		adapter:  protocol.NewAcpAdapter(),
		sessions: make(map[string]*AgentSession),
		eventChs: make(map[string]chan AgentEvent),
		status: AgentStatus{
			IsConnected: false,
			HasSession:  false,
			IsStreaming: false,
			LastSeen:    time.Now(),
		},
		running: false,
		ctx:     ctx,
		cancel:  cancel,
	}

	return agent, nil
}

// Start initializes the connection to the agent process
func (a *AcpAgent) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.running {
		return fmt.Errorf("agent already running")
	}

	// Create ACP connection
	a.conn = protocol.NewAcpConnection()

	// Set up callbacks for session updates and permissions
	a.conn.SetCallbacks(protocol.AcpCallbacks{
		OnSessionUpdate: a.handleSessionUpdate,
		OnPermission:    a.handlePermissionRequest,
		OnError:         a.handleError,
		OnDisconnect:    a.handleDisconnect,
	})

	// Build session config
	sessionConfig := protocol.AcpSessionConfig{
		Backend: a.backend,
		CliPath: a.config.CliPath,
		Cwd:     "", // Will be set per session
		Env:     a.config.Env,
	}

	// Initialize connection
	if err := a.conn.Initialize(sessionConfig); err != nil {
		return fmt.Errorf("failed to initialize connection: %w", err)
	}

	a.running = true
	a.status.IsConnected = true
	a.status.LastSeen = time.Now()

	return nil
}

// Stop shuts down the agent connection
func (a *AcpAgent) Stop() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.running {
		return nil
	}

	a.cancel()

	// Close connection
	if a.conn != nil {
		if err := a.conn.Close(); err != nil {
			return fmt.Errorf("failed to close connection: %w", err)
		}
	}

	// Close all event channels
	a.eventChsMu.Lock()
	for sessionID, ch := range a.eventChs {
		close(ch)
		delete(a.eventChs, sessionID)
	}
	a.eventChsMu.Unlock()

	a.running = false
	a.status.IsConnected = false
	a.status.HasSession = false
	a.status.IsStreaming = false

	return nil
}

// IsRunning returns whether the agent is running
func (a *AcpAgent) IsRunning() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.running
}

// CreateSession creates a new session with the agent
func (a *AcpAgent) CreateSession(ctx context.Context, opts AgentSessionOptions) (*AgentSession, error) {
	if !a.IsRunning() {
		return nil, fmt.Errorf("agent not running")
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	// Create event channel for this session
	eventCh := make(chan AgentEvent, 100)
	a.eventChsMu.Lock()
	a.eventChs[""] = eventCh // Temporary empty key, will be set after NewSession
	a.eventChsMu.Unlock()

	// Set working directory if specified
	if opts.WorkDir != "" {
		sessionConfig := protocol.AcpSessionConfig{
			Backend: a.backend,
			CliPath: a.config.CliPath,
			Cwd:     opts.WorkDir,
			Env:     a.config.Env,
		}
		if err := a.conn.Initialize(sessionConfig); err != nil {
			a.eventChsMu.Lock()
			delete(a.eventChs, "")
			a.eventChsMu.Unlock()
			return nil, fmt.Errorf("failed to initialize session with workDir: %w", err)
		}
	}

	// Create session via ACP
	result, err := a.conn.NewSession(ctx)
	if err != nil {
		a.eventChsMu.Lock()
		delete(a.eventChs, "")
		a.eventChsMu.Unlock()
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	// Create agent session
	now := time.Now().Unix()
	session := &AgentSession{
		ID:            result.SessionID,
		Backend:       string(a.backend),
		WorkDir:       opts.WorkDir,
		Model:         "", // Will be updated from ACP session info
		Provider:      string(a.backend),
		ThinkingLevel: "",
		CreatedAt:     now,
		UpdatedAt:     now,
		Metadata:      make(map[string]interface{}),
	}

	// Extract model info from result
	if result.Models != nil {
		session.Model = result.Models.DefaultModel
		session.Provider = string(a.backend)
		session.Metadata["models"] = result.Models.Models
		session.Metadata["options"] = result.Options
	}

	// Update event channel mapping
	a.eventChsMu.Lock()
	delete(a.eventChs, "")
	a.eventChs[session.ID] = eventCh
	a.eventChsMu.Unlock()

	// Store session
	a.sessions[session.ID] = session
	a.activeSession = session.ID
	a.status.HasSession = true

	return session, nil
}

// LoadSession loads an existing session
func (a *AcpAgent) LoadSession(ctx context.Context, sessionID string) (*AgentSession, error) {
	if !a.IsRunning() {
		return nil, fmt.Errorf("agent not running")
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	// Load session via ACP
	result, err := a.conn.LoadSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to load session: %w", err)
	}

	// Create agent session
	now := time.Now().Unix()
	session := &AgentSession{
		ID:            sessionID,
		Backend:       string(a.backend),
		WorkDir:       "", // Will be persisted in store
		Model:         "", // Will be loaded from store
		Provider:      string(a.backend),
		ThinkingLevel: "",
		CreatedAt:     now, // Will be updated from store
		UpdatedAt:     now,
		Metadata:      make(map[string]interface{}),
	}

	// Note: Session details (model, provider, workDir, thinkingLevel)
	// should be loaded from the store layer, not from ACP load result.
	// The ACP load result only contains sessionID and updated flag.
	session.Metadata["updated"] = result.Updated

	// Create event channel if not exists
	a.eventChsMu.Lock()
	if _, exists := a.eventChs[session.ID]; !exists {
		a.eventChs[session.ID] = make(chan AgentEvent, 100)
	}
	a.eventChsMu.Unlock()

	// Store session
	a.sessions[session.ID] = session
	a.activeSession = session.ID
	a.status.HasSession = true

	return session, nil
}

// DeleteSession deletes a session
func (a *AcpAgent) DeleteSession(sessionID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Close event channel
	a.eventChsMu.Lock()
	if ch, exists := a.eventChs[sessionID]; exists {
		close(ch)
		delete(a.eventChs, sessionID)
	}
	a.eventChsMu.Unlock()

	// Remove from sessions map
	delete(a.sessions, sessionID)

	// Update active session if needed
	if a.activeSession == sessionID {
		a.activeSession = ""
		if len(a.sessions) > 0 {
			// Pick any session
			for id := range a.sessions {
				a.activeSession = id
				break
			}
		} else {
			a.status.HasSession = false
		}
	}

	return nil
}

// ListSessions returns all sessions
func (a *AcpAgent) ListSessions() ([]*AgentSession, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	sessions := make([]*AgentSession, 0, len(a.sessions))
	for _, session := range a.sessions {
		sessions = append(sessions, session)
	}

	return sessions, nil
}

// SendMessage sends a message to the agent and returns an event channel
func (a *AcpAgent) SendMessage(ctx context.Context, sessionID string, message SendMessageInput) (<-chan AgentEvent, error) {
	if !a.IsRunning() {
		return nil, fmt.Errorf("agent not running")
	}

	a.mu.RLock()
	_, exists := a.sessions[sessionID]
	a.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	// Check if session matches current connection session
	if a.conn.GetSessionID() != sessionID {
		return nil, fmt.Errorf("session %s not active in connection", sessionID)
	}

	// Get event channel
	a.eventChsMu.RLock()
	eventCh, exists := a.eventChs[sessionID]
	a.eventChsMu.RUnlock()

	if !exists {
		eventCh = make(chan AgentEvent, 100)
		a.eventChsMu.Lock()
		a.eventChs[sessionID] = eventCh
		a.eventChsMu.Unlock()
	}

	// Update status
	a.mu.Lock()
	a.status.IsStreaming = true
	a.status.LastSeen = time.Now()
	a.mu.Unlock()

	// Build prompt options
	opts := protocol.AcpPromptOptions{
		Files:         message.Files,
		ModelOverride: message.Model,
	}

	// Start streaming via ACP
	if err := a.conn.StreamPrompt(ctx, sessionID, message.Content, opts, a.handleStreamCallback(sessionID)); err != nil {
		a.mu.Lock()
		a.status.IsStreaming = false
		a.status.LastError = err
		a.mu.Unlock()

		// Send error event
		a.sendEvent(sessionID, AgentEvent{
			Type:    EventTypeError,
			Session: sessionID,
			Error:   err,
			Created: time.Now().Unix(),
		})

		return nil, fmt.Errorf("failed to send message: %w", err)
	}

	return eventCh, nil
}

// ConfirmPermission confirms a permission request with an option
func (a *AcpAgent) ConfirmPermission(ctx context.Context, sessionID string, callID string, optionID string) error {
	if !a.IsRunning() {
		return fmt.Errorf("agent not running")
	}

	if err := a.conn.ConfirmPermission(ctx, callID, optionID); err != nil {
		return fmt.Errorf("failed to confirm permission: %w", err)
	}

	return nil
}

// GetStatus returns the current agent status
func (a *AcpAgent) GetStatus() AgentStatus {
	a.mu.RLock()
	defer a.mu.RUnlock()

	// Update connection status
	if a.running && a.conn != nil {
		connStatus := a.conn.GetStatus()
		a.status.IsConnected = a.conn.IsConnected()
		a.status.HasSession = a.conn.HasSession()
		a.status.LastSeen = connStatus.LastSeen
	}

	return a.status
}

// GetSession returns a session by ID
func (a *AcpAgent) GetSession(sessionID string) (*AgentSession, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	session, exists := a.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	return session, nil
}

// handleStreamCallback creates a callback for stream events
func (a *AcpAgent) handleStreamCallback(sessionID string) protocol.StreamCallback {
	return func(update *protocol.AcpSessionUpdate) error {
		// Convert update to internal event
		result := a.adapter.ConvertSessionUpdateFromAcp(update, sessionID)
		if result.Error != nil {
			// Send error event
			a.sendEvent(sessionID, AgentEvent{
				Type:    EventTypeError,
				Session: sessionID,
				Error:   result.Error,
				Created: time.Now().Unix(),
			})
			return result.Error
		}

		// Map ZeroAiEvent types to AgentEvent types
		agentEvent := a.convertToAgentEvent(sessionID, result.Event)
		a.sendEvent(sessionID, agentEvent)

		return nil
	}
}

// handleSessionUpdate handles session update notifications from ACP
func (a *AcpAgent) handleSessionUpdate(update *protocol.AcpSessionUpdate) error {
	sessionID := a.conn.GetSessionID()
	if sessionID == "" {
		return fmt.Errorf("no active session")
	}

	// Convert and send event
	result := a.adapter.ConvertSessionUpdateFromAcp(update, sessionID)
	if result.Error != nil {
		// Send error event
		a.sendEvent(sessionID, AgentEvent{
			Type:    EventTypeError,
			Session: sessionID,
			Error:   result.Error,
			Created: time.Now().Unix(),
		})
		return result.Error
	}

	agentEvent := a.convertToAgentEvent(sessionID, result.Event)
	a.sendEvent(sessionID, agentEvent)

	return nil
}

// handlePermissionRequest handles permission request notifications
func (a *AcpAgent) handlePermissionRequest(req *protocol.AcpPermissionRequest) error {
	sessionID := a.conn.GetSessionID()
	if sessionID == "" {
		return fmt.Errorf("no active session")
	}

	// Convert to internal format
	permData := a.adapter.ConvertPermission(req)

	// Send permission event
	a.sendEvent(sessionID, AgentEvent{
		Type:    EventTypePermission,
		Session: sessionID,
		Data:    permData,
		Created: time.Now().Unix(),
	})

	return nil
}

// handleError handles errors from ACP connection
func (a *AcpAgent) handleError(err error) {
	a.mu.Lock()
	a.status.LastError = err
	a.mu.Unlock()

	// Send error event to all active sessions
	a.eventChsMu.RLock()
	defer a.eventChsMu.RUnlock()

	for sessionID := range a.eventChs {
		a.sendEvent(sessionID, AgentEvent{
			Type:    EventTypeError,
			Session: sessionID,
			Error:   err,
			Created: time.Now().Unix(),
		})
	}
}

// handleDisconnect handles disconnection events
func (a *AcpAgent) handleDisconnect(info *protocol.AcpDisconnectInfo) {
	a.mu.Lock()
	a.running = false
	a.status.IsConnected = false
	a.status.HasSession = false
	a.status.IsStreaming = false
	a.status.LastSeen = time.Now()
	a.mu.Unlock()

	// Send error event to all active sessions
	disconnectErr := fmt.Errorf("disconnected: %s", info.Reason)

	a.eventChsMu.RLock()
	defer a.eventChsMu.RUnlock()

	for sessionID := range a.eventChs {
		a.sendEvent(sessionID, AgentEvent{
			Type:    EventTypeError,
			Session: sessionID,
			Error:   disconnectErr,
			Created: time.Now().Unix(),
		})
	}
}

// sendEvent sends an event to the session's event channel
func (a *AcpAgent) sendEvent(sessionID string, event AgentEvent) {
	a.eventChsMu.RLock()
	ch, exists := a.eventChs[sessionID]
	a.eventChsMu.RUnlock()

	if !exists {
		return
	}

	select {
	case ch <- event:
		// Event sent successfully
	case <-time.After(100 * time.Millisecond):
		// Channel full or closed, skip event
	case <-a.ctx.Done():
		// Agent shutting down
		return
	}
}

// convertToAgentEvent converts a ZeroAiEvent to an AgentEvent
func (a *AcpAgent) convertToAgentEvent(sessionID string, zeroEvent *types.ZeroAiEvent) AgentEvent {
	// Map ZeroAiEvent types to AgentEvent types
	var eventType EventType

	switch zeroEvent.Type {
	case "text", "text_chunk":
		eventType = EventTypeContent
	case "tool_call", "tool_started", "tool_completed", "tool_failed":
		eventType = EventTypeToolCall
	case "permission", "permission_request":
		eventType = EventTypePermission
	case "plan", "plan_update":
		eventType = EventTypeContent // Plan updates treated as content
	case "end_turn":
		eventType = EventTypeEndTurn
	default:
		eventType = EventTypeContent
	}

	return AgentEvent{
		Type:    eventType,
		Session: sessionID,
		Data:    zeroEvent.Data,
		Error:   zeroEvent.Error,
		Created: time.Now().Unix(),
	}
}
