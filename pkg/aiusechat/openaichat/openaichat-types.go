// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// OpenAI Chat Completions API types (simplified)

type ChatRequest struct {
	Model               string               `json:"model"`
	Messages            []ChatRequestMessage `json:"messages"`
	Stream              bool                 `json:"stream"`
	MaxTokens           int                  `json:"max_tokens,omitempty"`            // legacy
	MaxCompletionTokens int                  `json:"max_completion_tokens,omitempty"` // newer
	Temperature         float64              `json:"temperature,omitempty"`
	Tools               []ToolDefinition     `json:"tools,omitempty"`       // if you use tools
	ToolChoice          any                  `json:"tool_choice,omitempty"` // "auto", "none", or struct
}

type ChatRequestMessage struct {
	Role       string     `json:"role"`                   // "system","user","assistant","tool"
	Content    string     `json:"content,omitempty"`      // normal text messages
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`   // assistant tool-call message
	ToolCallID string     `json:"tool_call_id,omitempty"` // for role:"tool"
	Name       string     `json:"name,omitempty"`         // tool name on role:"tool"
}

func (cm *ChatRequestMessage) clean() *ChatRequestMessage {
	if len(cm.ToolCalls) == 0 {
		return cm
	}
	rtn := *cm
	rtn.ToolCalls = make([]ToolCall, len(cm.ToolCalls))
	for i, tc := range cm.ToolCalls {
		rtn.ToolCalls[i] = *tc.clean()
	}
	return &rtn
}

func (cm *ChatRequestMessage) FindToolCallIndex(toolCallId string) int {
	for i, tc := range cm.ToolCalls {
		if tc.ID == toolCallId {
			return i
		}
	}
	return -1
}

type ToolDefinition struct {
	Type     string          `json:"type"` // "function"
	Function ToolFunctionDef `json:"function"`
}

type ToolFunctionDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"` // or jsonschema struct
}

type ToolCall struct {
	ID          string                        `json:"id"`
	Type        string                        `json:"type"` // "function"
	Function    ToolFunctionCall              `json:"function"`
	ToolUseData *uctypes.UIMessageDataToolUse `json:"toolusedata,omitempty"` // Internal field (must be cleaned before sending to API)
}

func (tc *ToolCall) clean() *ToolCall {
	if tc.ToolUseData == nil {
		return tc
	}
	rtn := *tc
	rtn.ToolUseData = nil
	return &rtn
}

type ToolFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // raw JSON string
}

type StreamChunk struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Created int64          `json:"created"`
	Model   string         `json:"model"`
	Choices []StreamChoice `json:"choices"`
}

type StreamChoice struct {
	Index        int          `json:"index"`
	Delta        ContentDelta `json:"delta"`
	FinishReason *string      `json:"finish_reason"` // "stop", "length" | "tool_calls" | "content_filter"
}

// This is the important part:
type ContentDelta struct {
	Role      string          `json:"role,omitempty"`
	Content   string          `json:"content,omitempty"`
	ToolCalls []ToolCallDelta `json:"tool_calls,omitempty"`
}

type ToolCallDelta struct {
	Index    int                `json:"index"`
	ID       string             `json:"id,omitempty"`   // only on first chunk
	Type     string             `json:"type,omitempty"` // "function"
	Function *ToolFunctionDelta `json:"function,omitempty"`
}

type ToolFunctionDelta struct {
	Name      string `json:"name,omitempty"`      // only on first chunk
	Arguments string `json:"arguments,omitempty"` // streamed, append across chunks
}

// StoredChatMessage is the stored message type
type StoredChatMessage struct {
	MessageId string             `json:"messageid"`
	Message   ChatRequestMessage `json:"message"`
	Usage     *ChatUsage         `json:"usage,omitempty"`
}

type ChatUsage struct {
	Model        string `json:"model,omitempty"`
	InputTokens  int    `json:"prompt_tokens,omitempty"`
	OutputTokens int    `json:"completion_tokens,omitempty"`
	TotalTokens  int    `json:"total_tokens,omitempty"`
}

func (m *StoredChatMessage) GetMessageId() string {
	return m.MessageId
}

func (m *StoredChatMessage) GetRole() string {
	return m.Message.Role
}

func (m *StoredChatMessage) GetUsage() *uctypes.AIUsage {
	if m.Usage == nil {
		return nil
	}
	return &uctypes.AIUsage{
		APIType:      uctypes.APIType_OpenAIChat,
		Model:        m.Usage.Model,
		InputTokens:  m.Usage.InputTokens,
		OutputTokens: m.Usage.OutputTokens,
	}
}

func (m *StoredChatMessage) Copy() *StoredChatMessage {
	if m == nil {
		return nil
	}
	copy := *m
	if len(m.Message.ToolCalls) > 0 {
		copy.Message.ToolCalls = make([]ToolCall, len(m.Message.ToolCalls))
		for i, tc := range m.Message.ToolCalls {
			copy.Message.ToolCalls[i] = tc
			if tc.ToolUseData != nil {
				toolUseDataCopy := *tc.ToolUseData
				copy.Message.ToolCalls[i].ToolUseData = &toolUseDataCopy
			}
		}
	}
	if m.Usage != nil {
		usageCopy := *m.Usage
		copy.Usage = &usageCopy
	}
	return &copy
}
