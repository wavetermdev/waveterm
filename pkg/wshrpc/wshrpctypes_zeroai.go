// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// ZeroAI WSH RPC type definitions
package wshrpc

// ZeroAI backend constants
const (
	ZeroAiBackendClaude   = "claude"
	ZeroAiBackendQwen     = "qwen"
	ZeroAiBackendCodex    = "codex"
	ZeroAiBackendOpenCode = "opencode"
)

// ZeroAI role constants
const (
	ZeroAiRoleUser      = "user"
	ZeroAiRoleAssistant = "assistant"
	ZeroAiRoleSystem    = "system"
)

// ZeroAI event types
const (
	ZeroAiEventTypeMessage    = "message"
	ZeroAiEventTypePlan       = "plan"
	ZeroAiEventTypePermission = "permission"
)

// ZeroAiSessionWrapper wraps ZeroAiSession for RPC transport
//gotypes: gen
type ZeroAiSessionWrapper struct {
	ID            string                 `json:"id"`
	Backend       string                 `json:"backend"`
	WorkDir       string                 `json:"workDir"`
	Model         string                 `json:"model"`
	Provider      string                 `json:"provider"`
	ThinkingLevel string                 `json:"thinkingLevel"`
	YoloMode      bool                   `json:"yoloMode"`
	SessionID     string                 `json:"sessionId"`
	CreatedAt     int64                  `json:"createdAt"`
	UpdatedAt     int64                  `json:"updatedAt"`
	Metadata      map[string]interface{} `json:"metadata,omitempty" tstype:"null | Record<string, any>"`
}

// ZeroAiMessageWrapper wraps ZeroAiMessage for RPC transport
//gotypes: gen
type ZeroAiMessageWrapper struct {
	ID         int64                  `json:"id"`
	SessionID  string                 `json:"sessionId"`
	Role       string                 `json:"role" tstype:"\"user\" | \"assistant\" | \"system\""`
	Content    string                 `json:"content"`
	EventType  string                 `json:"eventType,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty" tstype:"null | Record<string, any>"`
	CreatedAt  int64                  `json:"createdAt"`
}

// ZeroAiCreateSessionData is the request data for creating a new session
//gotypes: request
type ZeroAiCreateSessionData struct {
	Backend       string `json:"backend"`
	Model         string `json:"model"`
	Provider      string `json:"provider,omitempty"`
	ThinkingLevel string `json:"thinkingLevel,omitempty"`
	YoloMode      bool   `json:"yoloMode,omitempty"`
	WorkDir       string `json:"workDir,omitempty"`
}

// ZeroAiCreateSessionResponse is the RPC response for creating a session
//gotypes: response
type ZeroAiCreateSessionResponse struct {
	Session *ZeroAiSessionWrapper `json:"session" tstype:"ZeroAiSessionWrapper"`
	Error   string               `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiGetSessionData is the request data for retrieving a session
//gotypes: request
type ZeroAiGetSessionData struct {
	SessionID string `json:"sessionId"`
}

// ZeroAiGetSessionResponse is the RPC response for getting a session
//gotypes: response
type ZeroAiGetSessionResponse struct {
	Session *ZeroAiSessionWrapper `json:"session" tstype:"null | ZeroAiSessionWrapper"`
	Error   string               `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiListSessionsData is the request data for listing sessions
//gotypes: request
type ZeroAiListSessionsData struct {
	Backend string `json:"backend,omitempty"`
}

// ZeroAiListSessionsResponse is the RPC response for listing sessions
//gotypes: response
type ZeroAiListSessionsResponse struct {
	Sessions []*ZeroAiSessionWrapper `json:"sessions" tstype:"ZeroAiSessionWrapper[]"`
	Error    string                 `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiDeleteSessionData is the request data for deleting a session
//gotypes: request
type ZeroAiDeleteSessionData struct {
	SessionID string `json:"sessionId"`
}

// ZeroAiDeleteSessionResponse is the RPC response for deleting a session
//gotypes: response
type ZeroAiDeleteSessionResponse struct {
	Success bool   `json:"success" tstype:"boolean"`
	Error   string `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiSetWorkDirData is the request data for setting work directory
//gotypes: request
type ZeroAiSetWorkDirData struct {
	SessionID string `json:"sessionId"`
	WorkDir   string `json:"workDir"`
}

// ZeroAiSetWorkDirResponse is the RPC response for setting work directory
//gotypes: response
type ZeroAiSetWorkDirResponse struct {
	Success bool   `json:"success" tstype:"boolean"`
	Error   string `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiSendMessageData is the request data for sending a message
//gotypes: request
type ZeroAiSendMessageData struct {
	SessionID string                 `json:"sessionId"`
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	EventType string                 `json:"eventType,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty" tstype:"null | Record<string, any>"`
}

// ZeroAiSendMessageResponse is the RPC response for sending a message
//gotypes: response
type ZeroAiSendMessageResponse struct {
	Message *ZeroAiMessageWrapper `json:"message" tstype:"ZeroAiMessageWrapper"`
	Error   string                `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiGetMessagesData is the request data for retrieving session messages
//gotypes: request
type ZeroAiGetMessagesData struct {
	SessionID string `json:"sessionId"`
	Limit     int    `json:"limit"`
	Offset    int    `json:"offset"`
}

// ZeroAiGetMessagesResponse is the RPC response for retrieving session messages
//gotypes: response
type ZeroAiGetMessagesResponse struct {
	Messages []*ZeroAiMessageWrapper `json:"messages" tstype:"ZeroAiMessageWrapper[]"`
	Error    string                 `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiGetAgentsData is the request data for getting available agents
//gotypes: request
type ZeroAiGetAgentsData struct {
	Backend string `json:"backend,omitempty"`
}

// ZeroAiGetAgentsRtnData is the response data for getting available agents
//gotypes: gen
type ZeroAiGetAgentsRtnData struct {
	Agents []ZeroAiAgentInfo `json:"agents" tstype:"ZeroAiAgentInfo[]"`
}

// ZeroAiGetAgentsResponse is the RPC response for getting available agents
//gotypes: response
type ZeroAiGetAgentsResponse struct {
	Agents []ZeroAiAgentInfo `json:"agents" tstype:"ZeroAiAgentInfo[]"`
	Error  string           `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiAgentInfo represents information about an available AI agent
//gotypes: gen
type ZeroAiAgentInfo struct {
	Backend      string   `json:"backend" tstype:"\"claude\" | \"qwen\" | \"codex\" | \"opencode\""`
	Model        string   `json:"model"`
	Provider     string   `json:"provider"`
	DisplayName  string   `json:"displayName"`
	Description  string   `json:"description"`
	Enabled      bool     `json:"enabled" tstype:"boolean"`
	SupportedOps []string `json:"supportedOps" tstype:"string[]"`
}

// ZeroAiConfirmPermissionData is the request data for confirming a permission
//gotypes: request
type ZeroAiConfirmPermissionData struct {
	SessionID  string `json:"sessionId"`
	CallID     string `json:"callId"`
	OptionID   string `json:"optionId"`
	ConfirmAll bool   `json:"confirmAll" tstype:"boolean"`
}

// ZeroAiConfirmPermissionResponse is the RPC response for confirming a permission
//gotypes: response
type ZeroAiConfirmPermissionResponse struct {
	Success bool   `json:"success" tstype:"boolean"`
	Error   string `json:"error,omitempty" tstype:"null | string"`
}

// ZeroAiSessionChunk represents a streaming content chunk (SSE event data)
//gotypes: gen
type ZeroAiSessionChunk struct {
	Content  string                 `json:"content"`
	Metadata map[string]interface{} `json:"metadata,omitempty" tstype:"null | Record<string, any>"`
}

// ZeroAiPlanUpdate represents a plan update event
//gotypes: gen
type ZeroAiPlanUpdate struct {
	Content  string                 `json:"content"`
	Metadata map[string]interface{} `json:"metadata,omitempty" tstype:"null | Record<string, any>"`
}

// ZeroAiPermissionRequest represents a permission request event
//gotypes: gen
type ZeroAiPermissionRequest struct {
	CallID      string                 `json:"callId"`
	ToolName    string                 `json:"toolName"`
	Description string                 `json:"description"`
	Options     []ZeroAiPermissionOption `json:"options" tstype:"ZeroAiPermissionOption[]"`
	SessionID   string                 `json:"sessionId"`
}

// ZeroAiPermissionOption represents a permission option
//gotypes: gen
type ZeroAiPermissionOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// ZeroAiStreamStart represents the start of a stream
//gotypes: gen
type ZeroAiStreamStart struct {
	StreamID  string `json:"streamId"`
	EventType string `json:"eventType" tstype:"\"message\" | \"plan\" | \"permission\""`
}

// ZeroAiStreamEnd represents the end of a stream
//gotypes: gen
type ZeroAiStreamEnd struct {
	StreamID     string `json:"streamId"`
	FinishReason string `json:"finishReason,omitempty" tstype:"null | \"stop\" | \"length\" | \"error\""`
	Error        string `json:"error,omitempty" tstype:"null | string"`
}

// ===== Team Collaboration Types =====

// ZeroAiTeamInfo represents information about a team
//gotypes: gen
