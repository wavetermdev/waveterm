// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pi

import (
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// APIType is the waveterm API type identifier for the pi backend.
// This is registered in uctypes so GetBackendByAPIType can dispatch to it.
const APIType = "pi-rpc"

// StopReasonKind constants for pi stop reasons.
const (
	piStopReasonDone      uctypes.StopReasonKind = "done"
	piStopReasonToolUse   uctypes.StopReasonKind = "tool_use"
	piStopReasonMaxTokens uctypes.StopReasonKind = "max_tokens"
	piStopReasonError     uctypes.StopReasonKind = "error"
	piStopReasonAborted   uctypes.StopReasonKind = "aborted"
	piStopReasonCanceled  uctypes.StopReasonKind = "canceled"
)

// piToolCall maps a pi tool_execution_start event to a WaveToolCall.
type piToolCall struct {
	ID     string
	Name   string
	Input  any
	Result *piToolResult // filled in on tool_execution_end
}

type piToolResult struct {
	Content []piToolContent `json:"content,omitempty"`
	IsError bool            `json:"isError,omitempty"`
}

type piToolContent struct {
	Type string `json:"type"` // "text"
	Text string `json:"text,omitempty"`
}

// piAssistantMessage mirrors the pi AgentMessage structure for assistant roles.
type piAssistantMessage struct {
	ID        string                  `json:"id,omitempty"`
	Role      string                  `json:"role"`
	Content   []piContentBlock        `json:"content"`
	StopReason string                 `json:"stopReason,omitempty"`
	Usage     *piUsage               `json:"usage,omitempty"`
}

type piContentBlock struct {
	Type       string         `json:"type"` // "text" | "thinking" | "toolCall"
	Text       string         `json:"text,omitempty"`
	Thinking   string         `json:"thinking,omitempty"`
	ToolCall   *piTCBlock     `json:"toolCall,omitempty"`
	ToolResult *piToolResultBlock `json:"toolResult,omitempty"`
}

type piTCBlock struct {
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Input any            `json:"input,omitempty"`
}

type piToolResultBlock struct {
	ToolCallID string         `json:"toolCallId"`
	Content    []piToolContent `json:"content,omitempty"`
	IsError    bool           `json:"isError,omitempty"`
}

type piUsage struct {
	InputTokens  int `json:"inputTokens,omitempty"`
	OutputTokens int `json:"outputTokens,omitempty"`
	CacheRead   int `json:"cacheRead,omitempty"`
	CacheWrite  int `json:"cacheWrite,omitempty"`
}

// piEventMessageUpdate is the nested assistantMessageEvent inside a message_update event.
type piEventMessageUpdate struct {
	Type        string        `json:"type"` // text_delta, toolcall_delta, etc.
	ContentIndex int          `json:"contentIndex,omitempty"`
	Delta       string        `json:"delta,omitempty"`
	Partial     *piAssistantMessage `json:"partial,omitempty"`
	TextDelta   string        `json:"textDelta,omitempty"`
	ThinkingDelta string      `json:"thinkingDelta,omitempty"`
}

// piStateData is returned from a get_state response.
type piStateData struct {
	Model             *piModel  `json:"model,omitempty"`
	ThinkingLevel     string    `json:"thinkingLevel,omitempty"`
	IsStreaming       bool      `json:"isStreaming,omitempty"`
	IsCompacting      bool      `json:"isCompacting,omitempty"`
	SteeringMode      string    `json:"steeringMode,omitempty"`
	FollowUpMode      string    `json:"followUpMode,omitempty"`
	SessionFile       string    `json:"sessionFile,omitempty"`
	SessionID         string    `json:"sessionId,omitempty"`
	SessionName       string    `json:"sessionName,omitempty"`
	MessageCount      int       `json:"messageCount,omitempty"`
	PendingMsgCount   int       `json:"pendingMessageCount,omitempty"`
}

type piModel struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	API             string  `json:"api"`
	Provider        string  `json:"provider"`
	BaseURL         string  `json:"baseUrl,omitempty"`
	Reasoning       bool    `json:"reasoning,omitempty"`
	Input           []string `json:"input,omitempty"`
	ContextWindow   int     `json:"contextWindow,omitempty"`
	MaxTokens       int     `json:"maxTokens,omitempty"`
}

// piSessionStats is returned from a get_session_stats response.
type piSessionStats struct {
	SessionFile  string      `json:"sessionFile,omitempty"`
	SessionID    string      `json:"sessionId,omitempty"`
	UserMsgs     int         `json:"userMessages,omitempty"`
	AsstMsgs     int         `json:"assistantMessages,omitempty"`
	ToolCalls    int         `json:"toolCalls,omitempty"`
	ToolResults  int         `json:"toolResults,omitempty"`
	TotalMsgs   int         `json:"totalMessages,omitempty"`
	Tokens       piTokenStats `json:"tokens,omitempty"`
	Cost         float64     `json:"cost,omitempty"`
	ContextUsage *piCtxUsage `json:"contextUsage,omitempty"`
}

type piTokenStats struct {
	Input  int `json:"input,omitempty"`
	Output int `json:"output,omitempty"`
	CacheRead int `json:"cacheRead,omitempty"`
	CacheWrite int `json:"cacheWrite,omitempty"`
	Total int `json:"total,omitempty"`
}

type piCtxUsage struct {
	Tokens        int     `json:"tokens,omitempty"`
	ContextWindow int     `json:"contextWindow,omitempty"`
	Percent       float64 `json:"percent,omitempty"`
}

// piTurnEnd is the data payload of a turn_end event.
type piTurnEnd struct {
	Message    *piAssistantMessage   `json:"message,omitempty"`
	ToolResults []piToolResultPayload `json:"toolResults,omitempty"`
}

type piToolResultPayload struct {
	ToolCallID string         `json:"toolCallId,omitempty"`
	ToolName   string         `json:"toolName,omitempty"`
	Content    []piToolContent `json:"content,omitempty"`
	IsError    bool           `json:"isError,omitempty"`
}
