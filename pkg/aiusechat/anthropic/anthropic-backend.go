// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package anthropic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/launchdarkly/eventsource"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const (
	AnthropicDefaultBaseURL              = "https://api.anthropic.com"
	AnthropicDefaultAPIVersion           = "2023-06-01"
	AnthropicDefaultMaxTokens            = 4096
	AnthropicThinkingBudget              = 1024
	AnthropicMinThinkingBudget           = 1024
	ProviderMetadataThinkingSignatureKey = "anthropic:signature"
)

// ---------- Anthropic wire types (subset) ----------
// Derived from anthropic-messages-api.md and anthropic-streaming.md. :contentReference[oaicite:6]{index=6} :contentReference[oaicite:7]{index=7}

type anthropicChatMessage struct {
	MessageId string                         `json:"messageid"` // internal field for idempotency (cannot send to anthropic)
	Role      string                         `json:"role"`
	Content   []anthropicMessageContentBlock `json:"content"`
}

func (m *anthropicChatMessage) GetMessageId() string {
	return m.MessageId
}

type anthropicInputMessage struct {
	Role    string                         `json:"role"`
	Content []anthropicMessageContentBlock `json:"content"`
}

type anthropicMessageContentBlock struct {
	// text, image, document, tool_use, tool_result, thinking, redacted_thinking,
	// server_tool_use, web_search_tool_result, code_execution_tool_result,
	// mcp_tool_use, mcp_tool_result, container_upload, search_result, web_search_result
	Type string `json:"type"`

	CacheControl *anthropicCacheControl `json:"cache_control,omitempty"`

	// Text content
	Text      string              `json:"text,omitempty"`
	Citations []anthropicCitation `json:"citations,omitempty"`

	// Image+File content
	Source *anthropicSource `json:"source,omitempty"`

	// Document content
	Title   string `json:"title,omitempty"`
	Context string `json:"context,omitempty"`

	// Tool use content
	ID    string      `json:"id,omitempty"`
	Name  string      `json:"name,omitempty"`
	Input interface{} `json:"input,omitempty"`

	ToolUseDisplayName      string `json:"toolusedisplayname,omitempty"`      // internal field (cannot marshal to API, must be stripped)
	ToolUseShortDescription string `json:"tooluseshortdescription,omitempty"` // internal field (cannot marshal to API, must be stripped)

	// Tool result content
	ToolUseID string      `json:"tool_use_id,omitempty"`
	IsError   bool        `json:"is_error,omitempty"`
	Content   interface{} `json:"content,omitempty"` // string or []blocks for tool results

	// Thinking content (extended thinking feature)
	Thinking  string `json:"thinking,omitempty"`
	Signature string `json:"signature,omitempty"`

	// Server tool use/MCP (web search, code execution, MCP tools)
	ServerName string `json:"server_name,omitempty"`

	// Container upload
	FileID string `json:"file_id,omitempty"`

	// Web search result (for responses)
	URL              string `json:"url,omitempty"`
	EncryptedContent string `json:"encrypted_content,omitempty"`
	PageAge          string `json:"page_age,omitempty"`

	// Code execution results
	ReturnCode int    `json:"return_code,omitempty"`
	Stdout     string `json:"stdout,omitempty"`
	Stderr     string `json:"stderr,omitempty"`
}

type anthropicSource struct {
	Type      string      `json:"type"` // "base64", "url", "file", "text", "content"
	Data      string      `json:"data,omitempty"`
	MediaType string      `json:"media_type,omitempty"` // MIME type
	URL       string      `json:"url,omitempty"`        // URL reference
	FileID    string      `json:"file_id,omitempty"`    // file upload ID
	Text      string      `json:"text,omitempty"`       // plain text (documents only)
	Content   interface{} `json:"content,omitempty"`    // content blocks (documents only)
	FileName  string      `json:"filename,omitempty"`   // internal field (cannot marshal to API, must be stripped)
	Size      int         `json:"size,omitempty"`       // internal field (cannot marshal to API, must be stripped)
}

func (s *anthropicSource) Clean() *anthropicSource {
	if s == nil {
		return nil
	}
	rtn := *s
	rtn.FileName = ""
	rtn.Size = 0
	return &rtn
}

func (b *anthropicMessageContentBlock) Clean() *anthropicMessageContentBlock {
	if b == nil {
		return nil
	}
	rtn := *b
	rtn.ToolUseDisplayName = ""
	rtn.ToolUseShortDescription = ""
	if rtn.Source != nil {
		rtn.Source = rtn.Source.Clean()
	}
	return &rtn
}

type anthropicCitation struct {
	Type           string `json:"type"`
	CitedText      string `json:"cited_text"`
	DocumentIndex  int    `json:"document_index,omitempty"`
	DocumentTitle  string `json:"document_title,omitempty"`
	StartCharIndex int    `json:"start_char_index,omitempty"`
	EndCharIndex   int    `json:"end_char_index,omitempty"`
	// ... other citation type fields
}

type anthropicStreamRequest struct {
	Model      string                         `json:"model"`
	Messages   []anthropicInputMessage        `json:"messages"`
	MaxTokens  int                            `json:"max_tokens"`
	Stream     bool                           `json:"stream"`
	System     []anthropicMessageContentBlock `json:"system,omitempty"`
	ToolChoice any                            `json:"tool_choice,omitempty"`
	Tools      []uctypes.ToolDefinition       `json:"tools,omitempty"`
	Thinking   *anthropicThinkingOpts         `json:"thinking,omitempty"`
}

type anthropicCacheControl struct {
	Type string `json:"type"` // "ephemeral"
	TTL  string `json:"ttl"`  // "5m" or "1h"
}

type anthropicMessageObj struct {
	ID           string  `json:"id"`
	Model        string  `json:"model"`
	StopReason   *string `json:"stop_reason"`
	StopSequence *string `json:"stop_sequence"`
}

type anthropicContentBlockType struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	Thinking string          `json:"thinking,omitempty"`
	ID       string          `json:"id,omitempty"`
	Name     string          `json:"name,omitempty"`
	Input    json.RawMessage `json:"input,omitempty"`
}

type anthropicDeltaType struct {
	Type        string  `json:"type"`
	Text        string  `json:"text,omitempty"`     // text_delta.text
	Thinking    string  `json:"thinking,omitempty"` // thinking_delta.thinking
	PartialJSON string  `json:"partial_json,omitempty"`
	Signature   string  `json:"signature,omitempty"`
	StopReason  *string `json:"stop_reason,omitempty"`   // message_delta.delta.stop_reason
	StopSeq     *string `json:"stop_sequence,omitempty"` // message_delta.delta.stop_sequence
}

type anthropicUsageType struct {
	OutputTokens int `json:"output_tokens,omitempty"` // cumulative
}

type anthropicErrorType struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type anthropicHTTPErrorResponse struct {
	Type  string             `json:"type"`
	Error anthropicErrorType `json:"error"`
}

type anthropicFullStreamEvent struct {
	Type         string                     `json:"type"`
	Message      *anthropicMessageObj       `json:"message,omitempty"`
	Index        *int                       `json:"index,omitempty"`
	ContentBlock *anthropicContentBlockType `json:"content_block,omitempty"`
	Delta        *anthropicDeltaType        `json:"delta,omitempty"`
	Usage        *anthropicUsageType        `json:"usage,omitempty"`
	Error        *anthropicErrorType        `json:"error,omitempty"`
}

type anthropicThinkingOpts struct {
	Type         string `json:"type"`
	BudgetTokens int    `json:"budget_tokens"`
}

// ---------- per-index content block bookkeeping ----------
type blockKind int

const (
	blockText blockKind = iota
	blockThinking
	blockToolUse
)

type blockState struct {
	kind blockKind
	// For text/reasoning: local SSE id
	localID string
	// Content block being built for rtnMessage
	contentBlock *anthropicMessageContentBlock
	// For tool_use:
	toolCallID string // Anthropic tool_use.id
	toolName   string
	accumJSON  *partialJSON // accumulator for input_json_delta
}

// partialJSON is a minimal, allocation-friendly accumulator for Anthropic
// input_json_delta (concat, then parse once on content_block_stop). :contentReference[oaicite:8]{index=8}
type partialJSON struct {
	buf bytes.Buffer
}

type streamingState struct {
	blockMap      map[int]*blockState
	toolCalls     []uctypes.WaveToolCall
	stopFromDelta string
	msgID         string
	model         string
	stepStarted   bool
	rtnMessage    *anthropicChatMessage
}

func (p *partialJSON) Write(s string) {
	// The stream may send empty "" chunks; ignore if zero-length
	if s == "" {
		return
	}
	p.buf.WriteString(s)
}

func (p *partialJSON) Bytes() []byte { return p.buf.Bytes() }

func (p *partialJSON) FinalObject() (json.RawMessage, error) {
	raw := p.buf.Bytes()
	// If empty, treat as "{}"
	if len(bytes.TrimSpace(raw)) == 0 {
		return json.RawMessage(`{}`), nil
	}
	// The accumulated content should be a valid JSON object string; parse it.
	var v interface{}
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("invalid accumulated tool input JSON: %w", err)
	}
	// Ensure it's an object per Anthropic contract
	switch v.(type) {
	case map[string]interface{}:
		return json.RawMessage(raw), nil
	default:
		return nil, fmt.Errorf("tool input is not an object")
	}
}

// makeThinkingOpts creates thinking options based on level and max tokens
func makeThinkingOpts(thinkingLevel string, maxTokens int) *anthropicThinkingOpts {
	if thinkingLevel != uctypes.ThinkingLevelMedium && thinkingLevel != uctypes.ThinkingLevelHigh {
		return nil
	}

	maxThinkingBudget := int(float64(maxTokens) * 0.75)

	// If 75% of maxTokens is less than minimum, disable thinking
	if maxThinkingBudget < AnthropicMinThinkingBudget {
		return nil
	}

	// Use the smaller of our default budget or 75% of maxTokens
	thinkingBudget := AnthropicThinkingBudget
	if thinkingBudget > maxThinkingBudget {
		thinkingBudget = maxThinkingBudget
	}

	return &anthropicThinkingOpts{
		Type:         "enabled",
		BudgetTokens: thinkingBudget,
	}
}

// ---------- Public entrypoint ----------
//
// Mapping rules recap (Anthropic → AI‑SDK):
// - message_start → AiMsgStart + AiMsgStartStep
// - content_block_start(type=text) → AiMsgTextStart; text_delta → AiMsgTextDelta; content_block_stop → AiMsgTextEnd
// - content_block_start(type=thinking) → AiMsgReasoningStart; thinking_delta → AiMsgReasoningDelta; stop → AiMsgReasoningEnd
// - content_block_start(type=tool_use) → AiMsgToolInputStart; input_json_delta → AiMsgToolInputDelta; stop → AiMsgToolInputAvailable
// - If final stop_reason == "tool_use": emit AiMsgFinishStep and return StopReason{Kind:ToolUse, ...} WITHOUT AiMsgFinish
// - If message_stop with stop_reason == "end_turn" or nil: emit AiMsgFinish then [DONE]
// - On Anthropic error event: AiMsgError and return StopKindError. :contentReference[oaicite:9]{index=9} :contentReference[oaicite:10]{index=10}

// parseAnthropicHTTPError parses Anthropic API HTTP error responses
func parseAnthropicHTTPError(resp *http.Response) error {
	var eresp anthropicHTTPErrorResponse
	slurp, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(slurp, &eresp)

	var msg string
	if eresp.Error.Message != "" {
		msg = eresp.Error.Message
	} else {
		// Limit raw response to avoid giant messages
		rawMsg := strings.TrimSpace(string(slurp))
		if len(rawMsg) > 500 {
			rawMsg = rawMsg[:500] + "..."
		}
		if rawMsg == "" {
			msg = "unknown error"
		} else {
			msg = rawMsg
		}
	}
	return fmt.Errorf("anthropic %s: %s", resp.Status, msg)
}

func RunAnthropicChatStep(
	ctx context.Context,
	sse *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, *anthropicChatMessage, error) {
	if sse == nil {
		return nil, nil, errors.New("sse handler is nil")
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	// Validate that chatOpts.Config match the chat's stored configuration
	if chat.APIType != chatOpts.Config.APIType {
		return nil, nil, fmt.Errorf("API type mismatch: chat has %s, chatOpts has %s", chat.APIType, chatOpts.Config.APIType)
	}
	if chat.Model != chatOpts.Config.Model {
		return nil, nil, fmt.Errorf("model mismatch: chat has %s, chatOpts has %s", chat.Model, chatOpts.Config.Model)
	}
	if chat.APIVersion != chatOpts.Config.APIVersion {
		return nil, nil, fmt.Errorf("API version mismatch: chat has %s, chatOpts has %s", chat.APIVersion, chatOpts.Config.APIVersion)
	}

	// Context with timeout if provided.
	if chatOpts.Config.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(chatOpts.Config.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	// Validate continuation if provided
	if cont != nil {
		if chatOpts.Config.Model != cont.Model {
			return nil, nil, fmt.Errorf("cannot continue with a different model, model:%q, cont-model:%q", chatOpts.Config.Model, cont.Model)
		}
	}

	// Convert GenAIMessages to anthropicInputMessages
	var anthropicMsgs []anthropicInputMessage
	for _, genMsg := range chat.NativeMessages {
		// Cast to anthropicChatMessage
		chatMsg, ok := genMsg.(*anthropicChatMessage)
		if !ok {
			return nil, nil, fmt.Errorf("expected anthropicChatMessage, got %T", genMsg)
		}
		// Convert to anthropicInputMessage with copied content
		contentCopy := make([]anthropicMessageContentBlock, len(chatMsg.Content))
		copy(contentCopy, chatMsg.Content)
		inputMsg := anthropicInputMessage{
			Role:    chatMsg.Role,
			Content: contentCopy,
		}
		anthropicMsgs = append(anthropicMsgs, inputMsg)
	}

	req, err := buildAnthropicHTTPRequest(ctx, anthropicMsgs, chatOpts)
	if err != nil {
		return nil, nil, err
	}

	httpClient := &http.Client{
		Timeout: 0, // rely on ctx; streaming can be long
	}
	// Proxy support
	if chatOpts.Config.ProxyURL != "" {
		pURL, perr := url.Parse(chatOpts.Config.ProxyURL)
		if perr != nil {
			return nil, nil, fmt.Errorf("invalid proxy URL: %w", perr)
		}
		httpClient.Transport = &http.Transport{
			Proxy: http.ProxyURL(pURL),
		}
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(ct, "text/event-stream") {
		return nil, nil, parseAnthropicHTTPError(resp)
	}

	// At this point we have a valid SSE stream, so setup SSE handling
	// From here on, errors must be returned through the SSE stream
	if cont == nil {
		sse.SetupSSE()
	}

	// Use eventsource decoder for proper SSE parsing
	decoder := eventsource.NewDecoder(resp.Body)

	stopReason, rtnMessage := handleAnthropicStreamingResp(ctx, sse, decoder, cont)
	return stopReason, rtnMessage, nil
}

// returns (nil, err) before we start streaming
// returns (stopReason, nil) after we start streaming
func StreamAnthropicResponses(
	ctx context.Context,
	sse *sse.SSEHandlerCh,
	opts *uctypes.AIOptsType,
	messages []uctypes.UIMessage,
	tools []uctypes.ToolDefinition,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, error) {
	if sse == nil {
		return nil, errors.New("sse handler is nil")
	}
	// Context with timeout if provided.
	if opts.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(opts.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	// Convert UIMessages to anthropicInputMessages
	var anthropicMsgs []anthropicInputMessage
	for _, m := range messages {
		aim := anthropicInputMessage{Role: m.Role}
		blocks, err := convertPartsToAnthropicBlocks(m.Parts, m.Role)
		if err != nil {
			return nil, fmt.Errorf("invalid message parts: %w", err)
		}
		aim.Content = blocks
		anthropicMsgs = append(anthropicMsgs, aim)
	}

	req, err := buildAnthropicHTTPRequest(ctx, anthropicMsgs, uctypes.WaveChatOpts{Config: *opts, Tools: tools})
	if err != nil {
		return nil, err
	}

	httpClient := &http.Client{
		Timeout: 0, // rely on ctx; streaming can be long
	}
	// Proxy support
	if opts.ProxyURL != "" {
		pURL, perr := url.Parse(opts.ProxyURL)
		if perr != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", perr)
		}
		httpClient.Transport = &http.Transport{
			Proxy: http.ProxyURL(pURL),
		}
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(ct, "text/event-stream") {
		return nil, parseAnthropicHTTPError(resp)
	}

	// At this point we have a valid SSE stream, so setup SSE handling
	// From here on, errors must be returned through the SSE stream
	sse.SetupSSE()

	// Use eventsource decoder for proper SSE parsing
	decoder := eventsource.NewDecoder(resp.Body)

	stopReason, _ := handleAnthropicStreamingResp(ctx, sse, decoder, cont)
	return stopReason, nil
}

// handleAnthropicStreamingResp processes the SSE stream after HTTP setup is complete
func handleAnthropicStreamingResp(
	ctx context.Context,
	sse *sse.SSEHandlerCh,
	decoder *eventsource.Decoder,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, *anthropicChatMessage) {
	// Per-response state
	state := &streamingState{
		blockMap: map[int]*blockState{},
		rtnMessage: &anthropicChatMessage{
			MessageId: uuid.New().String(),
			Role:      "assistant",
			Content:   []anthropicMessageContentBlock{},
		},
	}

	var rtnStopReason *uctypes.WaveStopReason

	// Ensure step is closed on error/cancellation
	defer func() {
		if !state.stepStarted {
			return
		}
		_ = sse.AiMsgFinishStep()
		if rtnStopReason == nil || rtnStopReason.Kind != uctypes.StopKindToolUse {
			_ = sse.AiMsgFinish("", nil)
		}
	}()

	// SSE event processing loop
	for {
		// Check for context cancellation
		if err := ctx.Err(); err != nil {
			_ = sse.AiMsgError("request cancelled")
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindCanceled,
				ErrorType: "cancelled",
				ErrorText: "request cancelled",
			}, state.rtnMessage
		}

		event, err := decoder.Decode()
		if err != nil {
			if errors.Is(err, io.EOF) {
				// Normal end of stream
				break
			}
			// transport error mid-stream
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream",
				ErrorText: err.Error(),
			}, state.rtnMessage
		}

		if stop, ret := handleAnthropicEvent(event, sse, state, cont); ret != nil {
			// Either error or message_stop triggered return
			rtnStopReason = ret
			return ret, state.rtnMessage
		} else {
			// maybe updated final stop reason (from message_delta)
			if stop != nil && *stop != "" {
				state.stopFromDelta = *stop
			}
		}
	}

	// EOF - let defer handle cleanup
	rtnStopReason = &uctypes.WaveStopReason{
		Kind:      uctypes.StopKindDone,
		RawReason: state.stopFromDelta,
		MessageID: state.msgID,
		Model:     state.model,
	}
	return rtnStopReason, state.rtnMessage
}

// handleAnthropicEvent processes one SSE event block. It may emit SSE parts
// and/or return a StopReason when the stream is complete.
//
// Return tuple:
//   - stopFromDelta: a *string with stop reason when message_delta updates stop_reason
//   - final: a *StopReason to return immediately (e.g., after message_stop or error)
//
// Event model: anthropic-streaming.md. :contentReference[oaicite:16]{index=16}
func handleAnthropicEvent(
	event eventsource.Event,
	sse *sse.SSEHandlerCh,
	state *streamingState,
	cont *uctypes.WaveContinueResponse,
) (stopFromDelta *string, final *uctypes.WaveStopReason) {
	eventName := event.Event()
	data := event.Data()
	switch eventName {
	case "ping":
		return nil, nil // ignore

	case "error":
		// Example: data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}} :contentReference[oaicite:17]{index=17}
		var ev anthropicFullStreamEvent
		if jerr := json.Unmarshal([]byte(data), &ev); jerr != nil {
			err := fmt.Errorf("error event decode: %w", jerr)
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		msg := "unknown error"
		etype := "error"
		if ev.Error != nil {
			msg = ev.Error.Message
			etype = ev.Error.Type
		}
		_ = sse.AiMsgError(msg)
		return nil, &uctypes.WaveStopReason{
			Kind:      uctypes.StopKindError,
			ErrorType: etype,
			ErrorText: msg,
		}

	case "message_start":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Message != nil {
			state.msgID = ev.Message.ID
			state.model = ev.Message.Model
		}
		if cont == nil {
			_ = sse.AiMsgStart(state.msgID)
		}
		_ = sse.AiMsgStartStep()
		state.stepStarted = true
		return nil, nil

	case "content_block_start":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Index == nil || ev.ContentBlock == nil {
			return nil, nil
		}
		idx := *ev.Index
		switch ev.ContentBlock.Type {
		case "text":
			id := uuid.New().String()
			state.blockMap[idx] = &blockState{
				kind:    blockText,
				localID: id,
				contentBlock: &anthropicMessageContentBlock{
					Type: "text",
					Text: "",
				},
			}
			_ = sse.AiMsgTextStart(id)
		case "thinking":
			id := uuid.New().String()
			state.blockMap[idx] = &blockState{
				kind:    blockThinking,
				localID: id,
				contentBlock: &anthropicMessageContentBlock{
					Type:     "thinking",
					Thinking: "",
				},
			}
			_ = sse.AiMsgReasoningStart(id)
		case "tool_use":
			tcID := ev.ContentBlock.ID
			tName := ev.ContentBlock.Name
			st := &blockState{
				kind:       blockToolUse,
				toolCallID: tcID,
				toolName:   tName,
				accumJSON:  &partialJSON{},
			}
			state.blockMap[idx] = st
			_ = sse.AiMsgToolInputStart(tcID, tName)
		default:
			// ignore other block types gracefully per Anthropic guidance :contentReference[oaicite:18]{index=18}
		}
		return nil, nil

	case "content_block_delta":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Index == nil || ev.Delta == nil {
			return nil, nil
		}
		st := state.blockMap[*ev.Index]
		if st == nil {
			return nil, nil
		}
		switch ev.Delta.Type {
		case "text_delta":
			if st.kind == blockText {
				_ = sse.AiMsgTextDelta(st.localID, ev.Delta.Text)
				// Accumulate text in the content block
				if st.contentBlock != nil {
					st.contentBlock.Text += ev.Delta.Text
				}
			}
		case "thinking_delta":
			if st.kind == blockThinking {
				_ = sse.AiMsgReasoningDelta(st.localID, ev.Delta.Thinking)
				// Accumulate thinking content in the content block
				if st.contentBlock != nil {
					st.contentBlock.Thinking += ev.Delta.Thinking
				}
			}
		case "input_json_delta":
			if st.kind == blockToolUse {
				st.accumJSON.Write(ev.Delta.PartialJSON)
				_ = sse.AiMsgToolInputDelta(st.toolCallID, ev.Delta.PartialJSON)
			}
		case "signature_delta":
			// Accumulate signature for thinking blocks
			if st.kind == blockThinking && st.contentBlock != nil {
				st.contentBlock.Signature += ev.Delta.Signature
			}
		default:
			// ignore unknown deltas gracefully. :contentReference[oaicite:20]{index=20}
		}
		return nil, nil

	case "content_block_stop":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Index == nil {
			return nil, nil
		}
		st := state.blockMap[*ev.Index]
		if st == nil {
			return nil, nil
		}
		switch st.kind {
		case blockText:
			_ = sse.AiMsgTextEnd(st.localID)
			// Add completed text block to rtnMessage
			if st.contentBlock != nil {
				state.rtnMessage.Content = append(state.rtnMessage.Content, *st.contentBlock)
			}
		case blockThinking:
			_ = sse.AiMsgReasoningEnd(st.localID)
			// Add completed thinking block to rtnMessage
			if st.contentBlock != nil {
				state.rtnMessage.Content = append(state.rtnMessage.Content, *st.contentBlock)
			}
		case blockToolUse:
			raw, jerr := st.accumJSON.FinalObject()
			if jerr != nil {
				_ = sse.AiMsgError(jerr.Error())
				return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "parse", ErrorText: jerr.Error()}
			}
			var input any
			if len(raw) > 0 {
				jerr = json.Unmarshal(raw, &input)
				if jerr != nil {
					_ = sse.AiMsgError(jerr.Error())
					return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "parse", ErrorText: jerr.Error()}
				}
			}
			_ = sse.AiMsgToolInputAvailable(st.toolCallID, st.toolName, raw)
			state.toolCalls = append(state.toolCalls, uctypes.WaveToolCall{
				ID:    st.toolCallID,
				Name:  st.toolName,
				Input: input,
			})
			// Add completed tool_use block to rtnMessage
			toolUseBlock := anthropicMessageContentBlock{
				Type:  "tool_use",
				ID:    st.toolCallID,
				Name:  st.toolName,
				Input: input,
			}
			state.rtnMessage.Content = append(state.rtnMessage.Content, toolUseBlock)
		}
		return nil, nil

	case "message_delta":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Delta != nil && ev.Delta.StopReason != nil {
			stopFromDelta = ev.Delta.StopReason
		}
		return stopFromDelta, nil

	case "message_stop":
		// Decide finalization based on last known stop_reason.
		// If we didn't capture it in message_delta, treat as end_turn.
		reason := "end_turn"
		if state.stopFromDelta != "" {
			reason = state.stopFromDelta
		}
		switch reason {
		case "tool_use":
			return nil, &uctypes.WaveStopReason{
				Kind:       uctypes.StopKindToolUse,
				RawReason:  reason,
				MessageID:  state.msgID,
				Model:      state.model,
				ToolCalls:  state.toolCalls,
				FinishStep: true,
			}
		case "max_tokens":
			return nil, &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindMaxTokens,
				RawReason: reason,
				MessageID: state.msgID,
				Model:     state.model,
			}
		case "refusal":
			return nil, &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindContent,
				RawReason: reason,
				MessageID: state.msgID,
				Model:     state.model,
			}
		case "pause_turn":
			return nil, &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindPauseTurn,
				RawReason: reason,
				MessageID: state.msgID,
				Model:     state.model,
			}
		default:
			// end_turn, stop_sequence (treat as end of this call)
			return nil, &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindDone,
				RawReason: reason,
				MessageID: state.msgID,
				Model:     state.model,
			}
		}

	default:
		log.Printf("unknown anthropic event type: %s", eventName)
		return nil, nil
	}
}
