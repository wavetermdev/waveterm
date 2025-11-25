// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaicomp

import (
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// OpenAI Completions API types (simplified)

type CompletionsRequest struct {
	Model               string               `json:"model"`
	Messages            []CompletionsMessage `json:"messages"`
	Stream              bool                 `json:"stream"`
	MaxTokens           int                  `json:"max_tokens,omitempty"`            // legacy
	MaxCompletionTokens int                  `json:"max_completion_tokens,omitempty"` // newer
	Temperature         float64              `json:"temperature,omitempty"`
	Tools               []ToolDefinition     `json:"tools,omitempty"`       // if you use tools
	ToolChoice          any                  `json:"tool_choice,omitempty"` // "auto", "none", or struct
}

type CompletionsMessage struct {
	Role       string     `json:"role"`                   // "system","user","assistant","tool"
	Content    string     `json:"content,omitempty"`      // normal text messages
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`   // assistant tool-call message
	ToolCallID string     `json:"tool_call_id,omitempty"` // for role:"tool"
	Name       string     `json:"name,omitempty"`         // tool name on role:"tool"
}

func (cm *CompletionsMessage) clean() *CompletionsMessage {
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

func (cm *CompletionsMessage) FindToolCallIndex(toolCallId string) int {
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

// CompletionsChatMessage is the stored message type
type CompletionsChatMessage struct {
	MessageId string             `json:"messageid"`
	Message   CompletionsMessage `json:"message"`
	Usage     *CompletionsUsage  `json:"usage,omitempty"`
}

type CompletionsUsage struct {
	Model            string `json:"model,omitempty"`
	PromptTokens     int    `json:"prompt_tokens,omitempty"`
	CompletionTokens int    `json:"completion_tokens,omitempty"`
	TotalTokens      int    `json:"total_tokens,omitempty"`
}

func (m *CompletionsChatMessage) GetMessageId() string {
	return m.MessageId
}

func (m *CompletionsChatMessage) GetRole() string {
	return m.Message.Role
}

func (m *CompletionsChatMessage) GetUsage() *uctypes.AIUsage {
	if m.Usage == nil {
		return nil
	}
	return &uctypes.AIUsage{
		APIType:      "openai-comp",
		Model:        m.Usage.Model,
		InputTokens:  m.Usage.PromptTokens,
		OutputTokens: m.Usage.CompletionTokens,
	}
}

func (m *CompletionsChatMessage) Copy() *CompletionsChatMessage {
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
