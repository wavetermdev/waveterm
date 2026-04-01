// Package types defines internal types used across ZeroAI packages
package types

// ZeroAiSession represents a ZeroAI session
type ZeroAiSession struct {
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
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

// ZeroAiMessage represents a message in a ZeroAI session
type ZeroAiMessage struct {
	ID         int64                  `json:"id"`
	SessionID  string                 `json:"sessionId"`
	Role       string                 `json:"role"`
	Content    string                 `json:"content"`
	EventType  string                 `json:"eventType,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt  int64                  `json:"createdAt"`
}

// ZeroAiEvent represents an event from ZeroAI
type ZeroAiEvent struct {
	Type    string                 `json:"type"`
	Session string                 `json:"session"`
	Data    interface{}            `json:"data,omitempty"`
	Error   error                  `json:"error,omitempty"`
	Created int64                  `json:"created"`
}

// PermissionOption represents a permission option
type PermissionOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// ZeroAiToolCallData represents tool call data
type ZeroAiToolCallData struct {
	ToolName    string `json:"toolName"`
	CallID      string `json:"callId"`
	Description string `json:"description"`
}

// ZeroAiPermissionData represents permission data
type ZeroAiPermissionData struct {
	CallID      string            `json:"callId"`
	ToolName    string            `json:"toolName"`
	Description string            `json:"description"`
	Options     []PermissionOption `json:"options"`
}

// ZeroAiSessionChunk represents a text content chunk from session update
type ZeroAiSessionChunk struct {
	Content  string                 `json:"content"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ZeroAiPlanUpdate represents a plan update event
type ZeroAiPlanUpdate struct {
	Content  string                 `json:"content,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}
