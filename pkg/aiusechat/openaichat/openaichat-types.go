// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"encoding/json"

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

type ChatContentPart struct {
	Type     string        `json:"type"`                // "text" or "image_url"
	Text     string        `json:"text,omitempty"`      // for type "text"
	ImageUrl *ChatImageUrl `json:"image_url,omitempty"` // for type "image_url"

	FileName   string `json:"filename,omitempty"`   // internal: original filename
	PreviewUrl string `json:"previewurl,omitempty"` // internal: 128x128 webp preview
	MimeType   string `json:"mimetype,omitempty"`   // internal: original mimetype
}

func (cp *ChatContentPart) clean() *ChatContentPart {
	if cp.FileName == "" && cp.PreviewUrl == "" && cp.MimeType == "" {
		return cp
	}
	rtn := *cp
	rtn.FileName = ""
	rtn.PreviewUrl = ""
	rtn.MimeType = ""
	return &rtn
}

type ChatImageUrl struct {
	Url    string `json:"url"`
	Detail string `json:"detail,omitempty"` // "auto", "low", "high"
}

type ChatRequestMessage struct {
	Role         string            `json:"role"`                   // "system","user","assistant","tool"
	Content      string            `json:"-"`                      // plain text (used when ContentParts is nil)
	ContentParts []ChatContentPart `json:"-"`                      // multimodal parts (used when images present)
	ToolCalls    []ToolCall        `json:"tool_calls,omitempty"`   // assistant tool-call message
	ToolCallID   string            `json:"tool_call_id,omitempty"` // for role:"tool"
	Name         string            `json:"name,omitempty"`         // tool name on role:"tool"
}

// chatRequestMessageJSON is the wire format for ChatRequestMessage
type chatRequestMessageJSON struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content,omitempty"`
	ToolCalls  []ToolCall      `json:"tool_calls,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
	Name       string          `json:"name,omitempty"`
}

func (cm ChatRequestMessage) MarshalJSON() ([]byte, error) {
	raw := chatRequestMessageJSON{
		Role:       cm.Role,
		ToolCalls:  cm.ToolCalls,
		ToolCallID: cm.ToolCallID,
		Name:       cm.Name,
	}
	if len(cm.ContentParts) > 0 {
		b, err := json.Marshal(cm.ContentParts)
		if err != nil {
			return nil, err
		}
		raw.Content = b
	} else if cm.Content != "" {
		b, err := json.Marshal(cm.Content)
		if err != nil {
			return nil, err
		}
		raw.Content = b
	}
	return json.Marshal(raw)
}

func (cm *ChatRequestMessage) UnmarshalJSON(data []byte) error {
	var raw chatRequestMessageJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	cm.Role = raw.Role
	cm.ToolCalls = raw.ToolCalls
	cm.ToolCallID = raw.ToolCallID
	cm.Name = raw.Name
	cm.Content = ""
	cm.ContentParts = nil
	if len(raw.Content) == 0 {
		return nil
	}
	// try array first
	var parts []ChatContentPart
	if err := json.Unmarshal(raw.Content, &parts); err == nil {
		cm.ContentParts = parts
		return nil
	}
	// fall back to string
	var s string
	if err := json.Unmarshal(raw.Content, &s); err != nil {
		return err
	}
	cm.Content = s
	return nil
}

func (cm *ChatRequestMessage) clean() *ChatRequestMessage {
	rtn := *cm
	if len(cm.ToolCalls) > 0 {
		rtn.ToolCalls = make([]ToolCall, len(cm.ToolCalls))
		for i, tc := range cm.ToolCalls {
			rtn.ToolCalls[i] = *tc.clean()
		}
	}
	if len(cm.ContentParts) > 0 {
		rtn.ContentParts = make([]ChatContentPart, len(cm.ContentParts))
		for i, cp := range cm.ContentParts {
			rtn.ContentParts[i] = *cp.clean()
		}
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
	copied := *m
	if len(m.Message.ToolCalls) > 0 {
		copied.Message.ToolCalls = make([]ToolCall, len(m.Message.ToolCalls))
		for i, tc := range m.Message.ToolCalls {
			copied.Message.ToolCalls[i] = tc
			if tc.ToolUseData != nil {
				toolUseDataCopy := *tc.ToolUseData
				copied.Message.ToolCalls[i].ToolUseData = &toolUseDataCopy
			}
		}
	}
	if len(m.Message.ContentParts) > 0 {
		copied.Message.ContentParts = make([]ChatContentPart, len(m.Message.ContentParts))
		copy(copied.Message.ContentParts, m.Message.ContentParts)
	}
	if m.Usage != nil {
		usageCopy := *m.Usage
		copied.Usage = &usageCopy
	}
	return &copied
}
