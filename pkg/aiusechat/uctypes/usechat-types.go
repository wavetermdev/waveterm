// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package uctypes

import (
	"fmt"
	"net/url"
	"strings"
)

type UseChatRequest struct {
	Messages []UIMessage `json:"messages"`
}

type UIMessage struct {
	ID       string          `json:"id"`
	Role     string          `json:"role"` // "system", "user", "assistant"
	Metadata any             `json:"metadata,omitempty"`
	Parts    []UIMessagePart `json:"parts,omitempty"`
}

type UIMessagePart struct {
	// text, reasoning, tool-[toolname], source-url, source-document, file, data-[dataname], step-start
	Type string `json:"type"`

	// TextUIPart & ReasoningUIPart
	Text string `json:"text,omitempty"`
	// State field:
	// - For "text"/"reasoning" types: optional, values are "streaming" or "done"
	// - For "tool-*" types: required, values are "input-streaming", "input-available", "output-available", or "output-error"
	State string `json:"state,omitempty"`

	// ToolUIPart
	ToolCallID       string `json:"toolCallId,omitempty"`
	Input            any    `json:"input,omitempty"`
	Output           any    `json:"output,omitempty"`
	ErrorText        string `json:"errorText,omitempty"`
	ProviderExecuted *bool  `json:"providerExecuted,omitempty"`

	// SourceUrlUIPart & SourceDocumentUIPart
	SourceID  string `json:"sourceId,omitempty"`
	URL       string `json:"url,omitempty"`
	Title     string `json:"title,omitempty"`
	Filename  string `json:"filename,omitempty"`
	MediaType string `json:"mediaType,omitempty"`

	// FileUIPart (uses URL and MediaType above)

	// DataUIPart
	ID   string `json:"id,omitempty"`
	Data any    `json:"data,omitempty"`

	// Provider metadata (ReasoningUIPart, SourceUrlUIPart, SourceDocumentUIPart)
	ProviderMetadata map[string]any `json:"providerMetadata,omitempty"`
}

type UIMessageDataUserFile struct {
	FileName string `json:"filename,omitempty"`
	Size     int    `json:"size,omitempty"`
	MimeType string `json:"mimetype,omitempty"`
}

// ToolDefinition represents a tool that can be used by the AI model
type ToolDefinition struct {
	Name             string                    `json:"name"`
	DisplayName      string                    `json:"displayname,omitempty"` // internal field (cannot marshal to API, must be stripped)
	Description      string                    `json:"description"`
	ShortDescription string                    `json:"shortdescription,omitempty"` // internal field (cannot marshal to API, must be stripped)
	InputSchema      map[string]any            `json:"input_schema"`
	ToolTextCallback func(any) (string, error) `json:"-"`
	ToolAnyCallback  func(any) (any, error)    `json:"-"`
}

func (td *ToolDefinition) Clean() *ToolDefinition {
	if td == nil {
		return nil
	}
	rtn := *td
	rtn.DisplayName = ""
	rtn.ShortDescription = ""
	return &rtn
}

//------------------
// Wave specific types, stop reasons, tool calls, config
// these are used internally to coordinate the calls/steps

const (
	ThinkingLevelLow    = "low"
	ThinkingLevelMedium = "medium"
	ThinkingLevelHigh   = "high"
)

type StopReasonKind string

const (
	StopKindDone      StopReasonKind = "done"
	StopKindToolUse   StopReasonKind = "tool_use"
	StopKindMaxTokens StopReasonKind = "max_tokens"
	StopKindContent   StopReasonKind = "content_filter"
	StopKindCanceled  StopReasonKind = "canceled"
	StopKindError     StopReasonKind = "error"
	StopKindPauseTurn StopReasonKind = "pause_turn"
)

type WaveToolCall struct {
	ID    string `json:"id"`              // Anthropic tool_use.id
	Name  string `json:"name,omitempty"`  // tool name (if provided)
	Input any    `json:"input,omitempty"` // accumulated input JSON
}

type WaveStopReason struct {
	Kind      StopReasonKind `json:"kind"`
	RawReason string         `json:"raw_reason,omitempty"`
	MessageID string         `json:"message_id,omitempty"`
	Model     string         `json:"model,omitempty"`

	ToolCalls []WaveToolCall `json:"tool_calls,omitempty"`

	ErrorType string `json:"error_type,omitempty"`
	ErrorText string `json:"error_text,omitempty"`

	FinishStep bool `json:"finish_step,omitempty"`
}

// Wave Specific parameter used to signal to our step function that this is a continuation step, not an initial step
type WaveContinueResponse struct {
	MessageID             string         `json:"message_id,omitempty"`
	Model                 string         `json:"model,omitempty"`
	ContinueFromKind      StopReasonKind `json:"continue_from_kind"`
	ContinueFromRawReason string         `json:"continue_from_raw_reason,omitempty"`
}

// Wave Specific AI opts for configuration
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

type AIChat struct {
	ChatId         string         `json:"chatid"`
	APIType        string         `json:"apitype"`
	Model          string         `json:"model"`
	APIVersion     string         `json:"apiversion"`
	NativeMessages []GenAIMessage `json:"nativemessages"`
}

// GenAIMessage interface for messages stored in conversations
// All messages must have a unique identifier for idempotency checks
type GenAIMessage interface {
	GetMessageId() string
}

const (
	AIMessagePartTypeText = "text"
	AIMessagePartTypeFile = "file"
)

// wave specific for POSTing a new message to a convo
type AIMessage struct {
	MessageId string          `json:"messageid"` // only for idempotency
	Parts     []AIMessagePart `json:"parts"`
}

type AIMessagePart struct {
	Type string `json:"type"` // "text", "file"

	// for "text"
	Text string `json:"text,omitempty"`

	// for "file"
	// mimetype is required, filename is not
	// either data or url (not both) must be set
	// url must be either an "https" or "data" url
	FileName string `json:"filename,omitempty"`
	MimeType string `json:"mimetype,omitempty"` // required
	Data     []byte `json:"data,omitempty"`     // raw data (base64 on wire)
	URL      string `json:"url,omitempty"`
	Size     int    `json:"size,omitempty"`
}

type AIToolResult struct {
	ToolName  string `json:"toolname"`
	ToolUseID string `json:"tooluseid"`
	ErrorText string `json:"errortext,omitempty"`
	Text      string `json:"text,omitempty"`
}

func (m *AIMessage) GetMessageId() string {
	return m.MessageId
}

func (m *AIMessage) Validate() error {
	if m.MessageId == "" {
		return fmt.Errorf("messageid must be set")
	}

	if len(m.Parts) == 0 {
		return fmt.Errorf("parts must not be empty")
	}

	for i, part := range m.Parts {
		if err := part.Validate(); err != nil {
			return fmt.Errorf("part %d: %w", i, err)
		}
	}

	return nil
}

func (p *AIMessagePart) Validate() error {
	if p.Type == AIMessagePartTypeText {
		if p.Text == "" {
			return fmt.Errorf("text type requires non-empty text field")
		}
		// Check that no file fields are set
		if p.FileName != "" || p.MimeType != "" || len(p.Data) > 0 || p.URL != "" {
			return fmt.Errorf("text type cannot have file fields set")
		}
		return nil
	}

	if p.Type == AIMessagePartTypeFile {
		if p.Text != "" {
			return fmt.Errorf("file type cannot have text field set")
		}

		if p.MimeType == "" {
			return fmt.Errorf("file type requires mimetype")
		}

		// Either data or url (not both) must be set
		hasData := len(p.Data) > 0
		hasURL := p.URL != ""

		if !hasData && !hasURL {
			return fmt.Errorf("file type requires either data or url")
		}

		if hasData && hasURL {
			return fmt.Errorf("file type cannot have both data and url set")
		}

		// If URL is set, validate it's https or data URL
		if hasURL {
			parsedURL, err := url.Parse(p.URL)
			if err != nil {
				return fmt.Errorf("invalid url: %w", err)
			}

			if parsedURL.Scheme != "https" && parsedURL.Scheme != "data" {
				return fmt.Errorf("url must be https or data URL, got %q", parsedURL.Scheme)
			}
		}
		return nil
	}

	return fmt.Errorf("type must be %q or %q, got %q", AIMessagePartTypeText, AIMessagePartTypeFile, p.Type)
}

// ---------------------
// AI SDK Streaming Protocol

// Type can be one of these consts...
// text-start, text-delta, text-end,
// reasoning-start, reasoning-delta, reasoning-end,
// source-url, source-document,
// file,
// data-*,
// tool-input-start, tool-input-delta, tool-input-available, tool-output-available,
// error, start-step, finish-step, finish
type UseChatStreamPart struct {
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

// GetContent extracts the text content from the parts array
func (m *UIMessage) GetContent() string {
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
