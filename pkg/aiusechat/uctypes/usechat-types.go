// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package uctypes

import (
	"encoding/json"
	"strings"
)

const (
	ThinkingLevelLow    = "low"
	ThinkingLevelMedium = "medium"
	ThinkingLevelHigh   = "high"
)

type UseChatRequest struct {
	Messages []UseChatMessage `json:"messages"`
}

type UseChatMessage struct {
	Role    string               `json:"role"`
	Content string               `json:"content,omitempty"`
	Parts   []UseChatMessagePart `json:"parts,omitempty"`
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

type ImageSource struct {
	Type      string `json:"type"`                 // "url", "base64", or "file"
	URL       string `json:"url,omitempty"`        // for type="url"
	Data      string `json:"data,omitempty"`       // for type="base64"
	MediaType string `json:"media_type,omitempty"` // required for base64
	FileID    string `json:"file_id,omitempty"`    // for type="file"
}

// ToolDefinition represents a tool that can be used by the AI model
type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

type AIOptsType struct {
	APIType       string `json:"apitype,omitempty"`
	Model         string `json:"model"`
	APIToken      string `json:"apitoken"`
	OrgID         string `json:"orgid,omitempty"`
	APIVersion    string `json:"apiversion,omitempty"`
	BaseURL       string `json:"baseurl,omitempty"`
	ProxyURL      string `json:"proxyurl,omitempty"`
	MaxTokens     int    `json:"maxtokens,omitempty"`
	TimeoutMs     int    `json:"timeoutms,omitempty"`
	ThinkingLevel string `json:"thinkinglevel,omitempty"` // ThinkingLevelLow, ThinkingLevelMedium, or ThinkingLevelHigh
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

func parseContentFromJSON(rawContent json.RawMessage) ([]UseChatContentBlock, error) {
	if len(rawContent) == 0 {
		return nil, nil
	}

	// Try to unmarshal as string first
	var contentStr string
	if err := json.Unmarshal(rawContent, &contentStr); err == nil {
		// It's a string - convert to single text block
		return []UseChatContentBlock{
			{
				Type: "text",
				Text: contentStr,
			},
		}, nil
	}

	// Not a string - unmarshal as array of blocks
	var contentBlocks []UseChatContentBlock
	if err := json.Unmarshal(rawContent, &contentBlocks); err != nil {
		return nil, err
	}
	return contentBlocks, nil
}
