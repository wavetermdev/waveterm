// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package uctypes

import (
	"fmt"
	"net/url"
	"strings"
)

const DefaultAIEndpoint = "https://cfapi.waveterm.dev/api/waveai"
const DefaultAnthropicModel = "claude-sonnet-4-5"
const DefaultOpenAIModel = "gpt-5-mini"
const PremiumOpenAIModel = "gpt-5.1"

type UseChatRequest struct {
	Messages []UIMessage `json:"messages"`
}

type UIChat struct {
	ChatId     string      `json:"chatid"`
	APIType    string      `json:"apitype"`
	Model      string      `json:"model"`
	APIVersion string      `json:"apiversion"`
	Messages   []UIMessage `json:"messages"`
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

// when updating this struct, also modify frontend/app/aipanel/aitypes.ts WaveUIDataTypes.userfile
type UIMessageDataUserFile struct {
	FileName   string `json:"filename,omitempty"`
	Size       int    `json:"size,omitempty"`
	MimeType   string `json:"mimetype,omitempty"`
	PreviewUrl string `json:"previewurl,omitempty"`
}

// ToolDefinition represents a tool that can be used by the AI model
type ToolDefinition struct {
	Name             string         `json:"name"`
	DisplayName      string         `json:"displayname,omitempty"` // internal field (cannot marshal to API, must be stripped)
	Description      string         `json:"description"`
	ShortDescription string         `json:"shortdescription,omitempty"` // internal field (cannot marshal to API, must be stripped)
	ToolLogName      string         `json:"-"`                          // short name for telemetry (e.g., "term:getscrollback")
	InputSchema      map[string]any `json:"input_schema"`
	Strict           bool           `json:"strict,omitempty"`

	ToolTextCallback func(any) (string, error)                     `json:"-"`
	ToolAnyCallback  func(any, *UIMessageDataToolUse) (any, error) `json:"-"` // *UIMessageDataToolUse will NOT be nil
	ToolCallDesc     func(any, any, *UIMessageDataToolUse) string  `json:"-"` // passed input, output (may be nil), *UIMessageDataToolUse (may be nil)
	ToolApproval     func(any) string                              `json:"-"`
	ToolVerifyInput  func(any, *UIMessageDataToolUse) error        `json:"-"` // *UIMessageDataToolUse will NOT be nil
	ToolProgressDesc func(any) ([]string, error)                   `json:"-"`
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

func (td *ToolDefinition) Desc() string {
	if td == nil {
		return ""
	}
	if td.ShortDescription != "" {
		return td.ShortDescription
	}
	return td.Description
}

//------------------
// Wave specific types, stop reasons, tool calls, config
// these are used internally to coordinate the calls/steps

const (
	ThinkingLevelLow    = "low"
	ThinkingLevelMedium = "medium"
	ThinkingLevelHigh   = "high"
)

const (
	ThinkingModeQuick    = "quick"
	ThinkingModeBalanced = "balanced"
	ThinkingModeDeep     = "deep"
)

const (
	ToolUseStatusPending   = "pending"
	ToolUseStatusError     = "error"
	ToolUseStatusCompleted = "completed"
)

const (
	AICapabilityTools  = "tools"
	AICapabilityImages = "images"
	AICapabilityPdfs   = "pdfs"
)

const (
	ApprovalNeedsApproval = "needs-approval"
	ApprovalUserApproved  = "user-approved"
	ApprovalUserDenied    = "user-denied"
	ApprovalTimeout       = "timeout"
	ApprovalAutoApproved  = "auto-approved"
)

type AIThinkingModeConfig struct {
	Mode               string   `json:"mode"`
	DisplayName        string   `json:"displayname"`
	APIType            string   `json:"apitype"`
	Model              string   `json:"model"`
	ThinkingLevel      string   `json:"thinkinglevel"`
	BaseURL            string   `json:"baseurl,omitempty"`
	WaveAICloud        bool     `json:"waveaicloud,omitempty"`
	APIVersion         string   `json:"apiversion,omitempty"`
	APIToken           string   `json:"apitoken,omitempty"`
	APITokenSecretName string   `json:"apitokensecretname,omitempty"`
	Premium            bool     `json:"premium"`
	Icon               string   `json:"icon"`
	Description        string   `json:"description"`
	Capabilities       []string `json:"capabilities,omitempty"`
}

// when updating this struct, also modify frontend/app/aipanel/aitypes.ts WaveUIDataTypes.tooluse
type UIMessageDataToolUse struct {
	ToolCallId          string `json:"toolcallid"`
	ToolName            string `json:"toolname"`
	ToolDesc            string `json:"tooldesc"`
	Status              string `json:"status"`
	RunTs               int64  `json:"runts,omitempty"`
	ErrorMessage        string `json:"errormessage,omitempty"`
	Approval            string `json:"approval,omitempty"`
	BlockId             string `json:"blockid,omitempty"`
	WriteBackupFileName string `json:"writebackupfilename,omitempty"`
	InputFileName       string `json:"inputfilename,omitempty"`
}

func (d *UIMessageDataToolUse) IsApproved() bool {
	return d.Approval == "" || d.Approval == ApprovalUserApproved || d.Approval == ApprovalAutoApproved
}

// when updating this struct, also modify frontend/app/aipanel/aitypes.ts WaveUIDataTypes.toolprogress
type UIMessageDataToolProgress struct {
	ToolCallId  string   `json:"toolcallid"`
	ToolName    string   `json:"toolname"`
	StatusLines []string `json:"statuslines"`
}

type StopReasonKind string

const (
	StopKindDone             StopReasonKind = "done"
	StopKindToolUse          StopReasonKind = "tool_use"
	StopKindMaxTokens        StopReasonKind = "max_tokens"
	StopKindContent          StopReasonKind = "content_filter"
	StopKindCanceled         StopReasonKind = "canceled"
	StopKindError            StopReasonKind = "error"
	StopKindPauseTurn        StopReasonKind = "pause_turn"
	StopKindPremiumRateLimit StopReasonKind = "premium_rate_limit"
	StopKindRateLimit        StopReasonKind = "rate_limit"
)

type WaveToolCall struct {
	ID          string                `json:"id"`                    // Anthropic tool_use.id
	Name        string                `json:"name,omitempty"`        // tool name (if provided)
	Input       any                   `json:"input,omitempty"`       // accumulated input JSON
	ToolUseData *UIMessageDataToolUse `json:"toolusedata,omitempty"` // UI tool use data
}

type WaveStopReason struct {
	Kind      StopReasonKind `json:"kind"`
	RawReason string         `json:"raw_reason,omitempty"`
	ToolCalls []WaveToolCall `json:"tool_calls,omitempty"`
	ErrorType string         `json:"error_type,omitempty"`
	ErrorText string         `json:"error_text,omitempty"`
}

// Wave Specific parameter used to signal to our step function that this is a continuation step, not an initial step
type WaveContinueResponse struct {
	Model            string         `json:"model,omitempty"`
	ContinueFromKind StopReasonKind `json:"continue_from_kind"`
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
	ThinkingMode  string `json:"thinkingmode,omitempty"`  // quick, balanced, or deep
}

func (opts AIOptsType) IsWaveProxy() bool {
	return strings.Contains(opts.BaseURL, ".waveterm.")
}

func (opts AIOptsType) IsPremiumModel() bool {
	return opts.Model == "gpt-5" || opts.Model == "gpt-5.1" || strings.Contains(opts.Model, "claude-sonnet")
}

type AIChat struct {
	ChatId         string         `json:"chatid"`
	APIType        string         `json:"apitype"`
	Model          string         `json:"model"`
	APIVersion     string         `json:"apiversion"`
	NativeMessages []GenAIMessage `json:"nativemessages"`
}

type AIUsage struct {
	APIType              string `json:"apitype"`
	Model                string `json:"model"`
	InputTokens          int    `json:"inputtokens,omitempty"`
	OutputTokens         int    `json:"outputtokens,omitempty"`
	NativeWebSearchCount int    `json:"nativewebsearchcount,omitempty"`
}

type AIMetrics struct {
	ChatId            string         `json:"chatid"`
	StepNum           int            `json:"stepnum"`
	Usage             AIUsage        `json:"usage"`
	RequestCount      int            `json:"requestcount"`
	ToolUseCount      int            `json:"toolusecount"`
	ToolUseErrorCount int            `json:"tooluseerrorcount"`
	ToolDetail        map[string]int `json:"tooldetail,omitempty"`
	PremiumReqCount   int            `json:"premiumreqcount"`
	ProxyReqCount     int            `json:"proxyreqcount"`
	HadError          bool           `json:"haderror"`
	ImageCount        int            `json:"imagecount"`
	PDFCount          int            `json:"pdfcount"`
	TextDocCount      int            `json:"textdoccount"`
	TextLen           int            `json:"textlen"`
	FirstByteLatency  int            `json:"firstbytelatency"` // ms
	RequestDuration   int            `json:"requestduration"`  // ms
	WidgetAccess      bool           `json:"widgetaccess"`
	ThinkingLevel     string         `json:"thinkinglevel,omitempty"`
	ThinkingMode      string         `json:"thinkingmode,omitempty"`
}

type AIFunctionCallInput struct {
	CallId      string                `json:"call_id"`
	Name        string                `json:"name"`
	Arguments   string                `json:"arguments"`
	ToolUseData *UIMessageDataToolUse `json:"toolusedata,omitempty"`
}

// GenAIMessage interface for messages stored in conversations
// All messages must have a unique identifier for idempotency checks
type GenAIMessage interface {
	GetMessageId() string
	GetUsage() *AIUsage
	GetRole() string
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
	FileName   string `json:"filename,omitempty"`
	MimeType   string `json:"mimetype,omitempty"` // required
	Data       []byte `json:"data,omitempty"`     // raw data (base64 on wire)
	URL        string `json:"url,omitempty"`
	Size       int    `json:"size,omitempty"`
	PreviewUrl string `json:"previewurl,omitempty"` // 128x128 webp data url for images
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

type WaveChatOpts struct {
	ChatId               string
	ClientId             string
	Config               AIOptsType
	Tools                []ToolDefinition
	SystemPrompt         []string
	TabStateGenerator    func() (string, []ToolDefinition, string, error)
	BuilderAppGenerator  func() (string, string, string, error)
	WidgetAccess         bool
	RegisterToolApproval func(string)
	AllowNativeWebSearch bool
	BuilderId            string
	BuilderAppId         string

	// ephemeral to the step
	TabState       string
	TabTools       []ToolDefinition
	TabId          string
	AppGoFile      string
	AppStaticFiles string
	PlatformInfo   string
}

func (opts *WaveChatOpts) GetToolDefinition(toolName string) *ToolDefinition {
	for _, tool := range opts.Tools {
		if tool.Name == toolName {
			return &tool
		}
	}
	for _, tool := range opts.TabTools {
		if tool.Name == toolName {
			return &tool
		}
	}
	return nil
}

func (opts *WaveChatOpts) GetWaveRequestType() string {
	if opts.BuilderId != "" {
		return "waveapps-builder"
	} else {
		return "waveai"
	}
}

type ProxyErrorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

type RateLimitInfo struct {
	Req        int   `json:"req"`
	ReqLimit   int   `json:"reqlimit"`
	PReq       int   `json:"preq"`
	PReqLimit  int   `json:"preqlimit"`
	ResetEpoch int64 `json:"resetepoch"`
	Unknown    bool  `json:"unknown,omitempty"`
}

// ParseRateLimitHeader parses the X-Wave-RateLimit header
// Format: X-Wave-RateLimit: req=<remaining>, reqlimit=<max_requests>, preq=<premium_remaining>, preqlimit=<max_premium>, reset=<expiration_epoch_seconds>
// Example: X-Wave-RateLimit: req=180, reqlimit=200, preq=45, preqlimit=50, reset=1727818382
// - req: remaining regular requests in the current window
// - reqlimit: maximum regular requests allowed in the window
// - preq: remaining premium requests in the current window
// - preqlimit: maximum premium requests allowed in the window
// - reset: unix timestamp (epoch seconds) when the rate limit window resets
func ParseRateLimitHeader(header string) *RateLimitInfo {
	if header == "" {
		return nil
	}

	info := &RateLimitInfo{}
	parts := strings.Split(header, ",")

	for _, part := range parts {
		part = strings.TrimSpace(part)
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}

		key := strings.TrimSpace(kv[0])
		value := strings.TrimSpace(kv[1])

		switch key {
		case "req":
			if val, err := fmt.Sscanf(value, "%d", &info.Req); err == nil && val == 1 {
				// Successfully parsed
			}
		case "reqlimit":
			if val, err := fmt.Sscanf(value, "%d", &info.ReqLimit); err == nil && val == 1 {
				// Successfully parsed
			}
		case "preq":
			if val, err := fmt.Sscanf(value, "%d", &info.PReq); err == nil && val == 1 {
				// Successfully parsed
			}
		case "preqlimit":
			if val, err := fmt.Sscanf(value, "%d", &info.PReqLimit); err == nil && val == 1 {
				// Successfully parsed
			}
		case "reset":
			if val, err := fmt.Sscanf(value, "%d", &info.ResetEpoch); err == nil && val == 1 {
				// Successfully parsed
			}
		}
	}

	return info
}

func AreModelsCompatible(apiType, model1, model2 string) bool {
	if model1 == model2 {
		return true
	}

	if apiType == "openai" {
		gpt5Models := map[string]bool{
			"gpt-5.1":    true,
			"gpt-5":      true,
			"gpt-5-mini": true,
			"gpt-5-nano": true,
		}

		if gpt5Models[model1] && gpt5Models[model2] {
			return true
		}
	}

	return false
}
