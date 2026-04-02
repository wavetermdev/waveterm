// Package agent defines the agent interface and related types
//
// This package provides the abstraction layer for different AI agent implementations.
package agent

import (
	"context"
	"time"
)

// Agent represents an AI agent that can manage sessions and send messages
type Agent interface {
	// Lifecycle management
	Start(ctx context.Context) error
	Stop() error
	IsRunning() bool

	// Session management
	CreateSession(ctx context.Context, opts AgentSessionOptions) (*AgentSession, error)
	LoadSession(ctx context.Context, sessionID string) (*AgentSession, error)
	DeleteSession(sessionID string) error
	ListSessions() ([]*AgentSession, error)

	// Message handling
	SendMessage(ctx context.Context, sessionID string, message SendMessageInput) (<-chan AgentEvent, error)
	ConfirmPermission(ctx context.Context, sessionID string, callID string, optionID string) error

	// Status queries
	GetStatus() AgentStatus
	GetSession(sessionID string) (*AgentSession, error)
}

// AgentSession represents a conversation session with an agent
type AgentSession struct {
	ID            string                 `json:"id"`
	Backend       string                 `json:"backend"`
	WorkDir       string                 `json:"workDir"`
	Model         string                 `json:"model"`
	Provider      string                 `json:"provider"`
	ThinkingLevel string                 `json:"thinkingLevel"`
	CreatedAt     int64                  `json:"createdAt"`
	UpdatedAt     int64                  `json:"updatedAt"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

// AgentSessionOptions represents options when creating a session
type AgentSessionOptions struct {
	Backend       string `json:"backend,omitempty"`
	WorkDir       string `json:"workDir"`
	Model         string `json:"model,omitempty"`
	ResumeSession bool   `json:"resumeSession,omitempty"`
}

// SendMessageInput represents input for sending a message
type SendMessageInput struct {
	Content  string                 `json:"content"`
	Files    []string               `json:"files,omitempty"`
	Model    string                 `json:"model,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// EventType represents the type of agent event
type EventType string

const (
	EventTypeContent    EventType = "content"
	EventTypeToolCall   EventType = "tool_call"
	EventTypePermission EventType = "permission"
	EventTypeError      EventType = "error"
	EventTypeEndTurn    EventType = "end_turn"
)

// AgentEvent represents an event from the agent
type AgentEvent struct {
	Type    EventType   `json:"type"`
	Session string      `json:"session"`
	Data    interface{} `json:"data,omitempty"`
	Error   error       `json:"error,omitempty"`
	Created int64       `json:"created"`
}

// AgentStatus represents the current status of an agent
type AgentStatus struct {
	IsConnected bool      `json:"isConnected"`
	HasSession  bool      `json:"hasSession"`
	IsStreaming bool      `json:"isStreaming"`
	LastError   error     `json:"lastError,omitempty"`
	LastSeen    time.Time `json:"lastSeen"`
}

// AgentConfig represents configuration for creating an agent
type AgentConfig struct {
	Backend       string                 `json:"backend"`
	CliPath       string                 `json:"cliPath,omitempty"`
	SessionConfig map[string]interface{} `json:"sessionConfig,omitempty"`
	Env           map[string]string      `json:"env,omitempty"`
}

// AgentFactory is a factory for creating agents
type AgentFactory interface {
	CreateAgent(config AgentConfig) (Agent, error)
	GetSupportedBackends() []string
}
