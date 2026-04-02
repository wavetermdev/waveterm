// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// ZeroAI-specific WSH RPC command data (business logic layer)
package rpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/zeroai/types"
)

// WshRpcZeroAIInterface defines ZeroAI-related RPC commands
// This is the business logic interface that the WSH RPC layer calls
type WshRpcZeroAIInterface interface {
	// ZeroAiCreateSession creates a new ZeroAI session
	ZeroAiCreateSessionCommand(ctx context.Context, data ZeroAiCreateSessionData) (*types.ZeroAiSession, error)

	// ZeroAiGetSession retrieves a session by ID
	ZeroAiGetSessionCommand(ctx context.Context, data ZeroAiGetSessionData) (*types.ZeroAiSession, error)

	// ZeroAiListSessions lists all sessions, optionally filtered by backend
	ZeroAiListSessionsCommand(ctx context.Context, data ZeroAiListSessionsData) ([]types.ZeroAiSession, error)

	// ZeroAiDeleteSession deletes a session by ID
	ZeroAiDeleteSessionCommand(ctx context.Context, data ZeroAiDeleteSessionData) error

	// ZeroAiSetWorkDir sets the working directory for a session
	ZeroAiSetWorkDirCommand(ctx context.Context, data ZeroAiSetWorkDirData) error

	// ZeroAiSendMessage sends a message to a session
	ZeroAiSendMessageCommand(ctx context.Context, data ZeroAiSendMessageData) (*types.ZeroAiMessage, error)

	// ZeroAiGetMessages retrieves messages for a session
	ZeroAiGetMessagesCommand(ctx context.Context, data ZeroAiGetMessagesData) ([]types.ZeroAiMessage, error)

	// ZeroAiGetAgents lists available AI agent providers and models
	ZeroAiGetAgentsCommand(ctx context.Context, data ZeroAiGetAgentsData) (*ZeroAiGetAgentsRtnData, error)

	// ZeroAiConfirmPermission confirms a tool permission request
	ZeroAiConfirmPermissionCommand(ctx context.Context, data ZeroAiConfirmPermissionData) error
}

// ZeroAiCreateSessionData is the request data for creating a new session
type ZeroAiCreateSessionData struct {
	Backend       string `json:"backend"`
	Model         string `json:"model"`
	Provider      string `json:"provider,omitempty"`
	ThinkingLevel string `json:"thinkingLevel,omitempty"`
	YoloMode      bool   `json:"yoloMode,omitempty"`
	WorkDir       string `json:"workDir,omitempty"`
}

// ZeroAiGetSessionData is the request data for retrieving a session
type ZeroAiGetSessionData struct {
	SessionID string `json:"sessionId"`
}

// ZeroAiListSessionsData is the request data for listing sessions
type ZeroAiListSessionsData struct {
	Backend string `json:"backend,omitempty"`
}

// ZeroAiDeleteSessionData is the request data for deleting a session
type ZeroAiDeleteSessionData struct {
	SessionID string `json:"sessionId"`
}

// ZeroAiSetWorkDirData is the request data for setting work directory
type ZeroAiSetWorkDirData struct {
	SessionID string `json:"sessionId"`
	WorkDir   string `json:"workDir"`
}

// ZeroAiSendMessageData is the request data for sending a message
type ZeroAiSendMessageData struct {
	SessionID string                 `json:"sessionId"`
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	EventType string                 `json:"eventType,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// ZeroAiGetMessagesData is the request data for retrieving session messages
type ZeroAiGetMessagesData struct {
	SessionID string `json:"sessionId"`
	Limit     int    `json:"limit"`
	Offset    int    `json:"offset"`
}

// ZeroAiGetAgentsData is the request data for getting available agents
type ZeroAiGetAgentsData struct {
	Backend string `json:"backend,omitempty"`
}

// ZeroAiGetAgentsRtnData is the response data for getting available agents
type ZeroAiGetAgentsRtnData struct {
	Agents []ZeroAiAgentInfo `json:"agents"`
}

// ZeroAiAgentInfo represents information about an available AI agent
type ZeroAiAgentInfo struct {
	Backend      string   `json:"backend"`
	Model        string   `json:"model"`
	Provider     string   `json:"provider"`
	DisplayName  string   `json:"displayName"`
	Description  string   `json:"description"`
	Enabled      bool     `json:"enabled"`
	SupportedOps []string `json:"supportedOps"`
}

// ZeroAiConfirmPermissionData is the request data for confirming a permission
type ZeroAiConfirmPermissionData struct {
	SessionID  string `json:"sessionId"`
	CallID     string `json:"callId"`
	OptionID   string `json:"optionId"`
	ConfirmAll bool   `json:"confirmAll"`
}

// ZeroAiSessionChunk represents a streaming content chunk
type ZeroAiSessionChunk struct {
	Content  string                 `json:"content"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ZeroAiPlanUpdate represents a plan update event
type ZeroAiPlanUpdate struct {
	Content  string                 `json:"content"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ZeroAiPermissionRequest represents a permission request event
type ZeroAiPermissionRequest struct {
	CallID       string                 `json:"callId"`
	ToolName     string                 `json:"toolName"`
	Description  string                 `json:"description"`
	Options      []ZeroAiPermissionOption `json:"options"`
	SessionID    string                 `json:"sessionId"`
}

// ZeroAiPermissionOption represents a permission option
type ZeroAiPermissionOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// ZeroAiStreamStart represents the start of a stream
type ZeroAiStreamStart struct {
	StreamID  string `json:"streamId"`
	EventType string `json:"eventType"`
}

// ZeroAiStreamEnd represents the end of a stream
type ZeroAiStreamEnd struct {
	StreamID     string `json:"streamId"`
	FinishReason string `json:"finishReason,omitempty"`
	Error        string `json:"error,omitempty"`
}
