// Package store defines storage interfaces for sessions and messages
package store

// SessionStore provides storage operations for agent sessions
type SessionStore interface {
	// Create stores a new session
	Create(session *Session) error

	// Get retrieves a session by ID
	Get(sessionID string) (*Session, error)

	// Update updates an existing session
	Update(session *Session) error

	// Delete removes a session by ID
	Delete(sessionID string) error

	// List returns sessions with optional filtering
	List(opts ListOptions) ([]*Session, error)
}

// MessageStore provides storage operations for messages
type MessageStore interface {
	// Add stores a new message
	Add(msg *Message) error

	// GetSessionMessages retrieves all messages for a session
	GetSessionMessages(sessionID string) ([]*Message, error)

	// Delete removes all messages for a session
	Delete(sessionID string) error
}

// ListOptions provides filtering options for listing sessions
type ListOptions struct {
	Backend  string `json:"backend,omitempty"`
	Limit    int    `json:"limit,omitempty"`
	Offset   int    `json:"offset,omitempty"`
}

// Session represents a stored agent session
type Session struct {
	ID            string                 `json:"id"`
	Backend       string                 `json:"backend"`
	WorkDir       string                 `json:"workDir"`
	Model         string                 `json:"model"`
	Provider      string                 `json:"provider"`
	ThinkingLevel string                 `json:"thinkingLevel"`
	YoloMode      bool                   `json:"yoloMode"`
	SessionID     string                 `json:"sessionId,omitempty"`
	CreatedAt     int64                  `json:"createdAt"`
	UpdatedAt     int64                  `json:"updatedAt"`
	Metadata      string                 `json:"metadata,omitempty"` // JSON string
}

// Message represents a stored message in a session
type Message struct {
	ID         int64    `json:"id"`
	SessionID  string   `json:"sessionId"`
	Role       string   `json:"role"`
	Content    string   `json:"content"`
	EventType  string   `json:"eventType,omitempty"`
	Metadata   string   `json:"metadata,omitempty"` // JSON string
	CreatedAt  int64    `json:"createdAt"`
}
