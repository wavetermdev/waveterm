// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"strings"
)

const (
	APIType_Anthropic = "anthropic"
	APIType_OpenAI    = "openai"
)

type StopReasonKind string

const (
	StopKindDone      StopReasonKind = "done"
	StopKindToolUse   StopReasonKind = "tool_use"
	StopKindMaxTokens StopReasonKind = "max_tokens"
	StopKindContent   StopReasonKind = "content_filter"
	StopKindCanceled  StopReasonKind = "canceled"
	StopKindError     StopReasonKind = "error"
)

type ImageSource struct {
	Type      string `json:"type"`                 // "url", "base64", or "file"
	URL       string `json:"url,omitempty"`        // for type="url"
	Data      string `json:"data,omitempty"`       // for type="base64"
	MediaType string `json:"media_type,omitempty"` // required for base64
	FileID    string `json:"file_id,omitempty"`    // for type="file"
}

// Type can be one of these consts...
// text-start, text-delta, text-end,
// reasoning-start, reasoning-delta, reasoning-end,
// source-url, source-document,
// file,
// data-*,
// tool-input-start, tool-input-delta, tool-input-available, tool-output-available,
// error, start-step, finish-step, finish
type UseChatContentBlock struct {
	Type string `json:"type"`

	// Text
	Text string `json:"text,omitempty"`

	// Reasoning
	Delta string `json:"delta,omitempty"`

	// Source parts
	SourceID  string `json:"sourceId,omitempty"`
	URL       string `json:"url,omitempty"`       // also for file urls
	MediaType string `json:"mediaType,omitempty"` // also for file types
	Title     string `json:"title,omitempty"`

	// Data (custom data-\*)
	Data any `json:"data,omitempty"`

	// Tool use / tool result
	ToolCallID     string `json:"toolCallId,omitempty"`
	ToolName       string `json:"toolName,omitempty"`
	Input          any    `json:"input,omitempty"`
	Output         any    `json:"output,omitempty"`
	InputTextDelta string `json:"inputTextDelta,omitempty"`

	// Control parts (start/finish steps, errors, etc.)
	ErrorText string `json:"errorText,omitempty"`
}

type UseChatMessagePart struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`

	// For images
	Source *ImageSource `json:"source,omitempty"`

	// For tool_result
	ToolUseID string                `json:"tool_use_id,omitempty"`
	Content   []UseChatContentBlock `json:"-"` // handled by custom marshal/unmarshal
	IsError   *bool                 `json:"is_error,omitempty"`
}

func (p *UseChatMessagePart) MarshalJSON() ([]byte, error) {
	type Alias UseChatMessagePart
	aux := struct {
		*Alias
		Content interface{} `json:"content,omitempty"`
	}{
		Alias: (*Alias)(p),
	}

	// Convert Content field for marshaling
	if len(p.Content) == 0 {
		// Omit empty content
	} else if len(p.Content) == 1 && p.Content[0].Type == "text" {
		// Single text block - marshal as simple string
		aux.Content = p.Content[0].Text
	} else {
		// Multiple blocks or non-text - marshal as array
		aux.Content = p.Content
	}

	return json.Marshal(aux)
}

func (p *UseChatMessagePart) UnmarshalJSON(data []byte) error {
	type Alias UseChatMessagePart
	aux := struct {
		*Alias
		Content json.RawMessage `json:"content"`
	}{
		Alias: (*Alias)(p),
	}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	// Handle Content field
	content, err := parseContentFromJSON(aux.Content)
	if err != nil {
		return err
	}
	p.Content = content
	return nil
}

type UseChatMessage struct {
	Role    string               `json:"role"`
	Content string               `json:"content,omitempty"`
	Parts   []UseChatMessagePart `json:"parts,omitempty"`
}

// GetContent extracts the text content from either content field or parts array
func (m *UseChatMessage) GetContent() string {
	if m.Content != "" {
		return m.Content
	}
	if len(m.Parts) > 0 {
		var content strings.Builder
		for _, part := range m.Parts {
			if part.Type == "text" {
				content.WriteString(part.Text)
			}
		}
		return content.String()
	}
	return ""
}

type ToolCall struct {
	ID    string `json:"id"`              // Anthropic tool_use.id
	Name  string `json:"name,omitempty"`  // tool name (if provided)
	Input any    `json:"input,omitempty"` // accumulated input JSON
}

type StopReason struct {
	Kind      StopReasonKind `json:"kind"`
	RawReason string         `json:"raw_reason,omitempty"`
	MessageID string         `json:"message_id,omitempty"`
	Model     string         `json:"model,omitempty"`

	ToolCalls []ToolCall `json:"tool_calls,omitempty"`

	ErrorType string `json:"error_type,omitempty"`
	ErrorText string `json:"error_text,omitempty"`

	FinishStep bool `json:"finish_step,omitempty"`
}

// ToolDefinition represents a tool that can be used by the AI model
type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

type UseChatRequest struct {
	Messages []UseChatMessage `json:"messages"`
}
