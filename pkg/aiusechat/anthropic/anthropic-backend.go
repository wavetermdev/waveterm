package anthropic

// Package anthropicadapter streams Anthropic Messages API events and adapts them
// to our AI‑SDK style SSE parts. Mapping is based on the AI‑SDK data stream
// protocol (start/text-start/text-delta/text-end, reasoning-*, tool-input-*, finish, finish-step) :contentReference[oaicite:0]{index=0}
// and Anthropic's Messages + Streaming event schemas (message_start,
// content_block_start/delta/stop, message_delta, message_stop, error). :contentReference[oaicite:1]{index=1} :contentReference[oaicite:2]{index=2}
//
// NOTE: The public signature in api.txt references wshrpc.WaveAIOptsType;
// for this self-contained package we define WaveAIOptsType locally with the
// same shape. Adapt the import/alias as needed in your codebase. :contentReference[oaicite:3]{index=3}

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
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const (
	AnthropicDefaultBaseURL    = "https://api.anthropic.com"
	AnthropicDefaultAPIVersion = "2023-06-01"
	AnthropicDefaultMaxTokens  = 4096
	AnthropicThinkingBudget    = 1024
)

// ---------- Anthropic wire types (subset) ----------
// Derived from anthropic-messages-api.md and anthropic-streaming.md. :contentReference[oaicite:6]{index=6} :contentReference[oaicite:7]{index=7}

type anthropicInputMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"` // string or []blocks
}

type anthropicStreamRequest struct {
	Model      string                   `json:"model"`
	Messages   []anthropicInputMessage  `json:"messages"`
	MaxTokens  int                      `json:"max_tokens"`
	Stream     bool                     `json:"stream"`
	System     any                      `json:"system,omitempty"`
	ToolChoice any                      `json:"tool_choice,omitempty"`
	Tools      []uctypes.ToolDefinition `json:"tools,omitempty"`
	Thinking   any                      `json:"thinking,omitempty"`
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

func StreamAnthropicResponses(
	ctx context.Context,
	sse *sse.SSEHandlerCh,
	opts *uctypes.AIOptsType,
	messages []uctypes.UseChatMessage,
	tools []uctypes.ToolDefinition,
) (*uctypes.StopReason, error) {
	if sse == nil {
		return nil, errors.New("sse handler is nil")
	}
	// Context with timeout if provided.
	if opts.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(opts.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	req, err := buildAnthropicHTTPRequest(ctx, opts, messages, tools)
	if err != nil {
		return nil, err
	}

	httpClient := &http.Client{
		Timeout: 0, // rely on ctx; streaming can be long
	}
	// Proxy support
	if opts.ProxyURL != "" {
		pURL, perr := url.Parse(opts.ProxyURL)
		if perr == nil {
			httpClient.Transport = &http.Transport{
				Proxy: http.ProxyURL(pURL),
			}
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

	// Per-response state
	blockMap := map[int]*blockState{}
	var toolCalls []uctypes.ToolCall
	var stopFromDelta string
	var msgID string
	var model string
	var finished bool

	// SSE event processing loop
	for {
		// Check for context cancellation
		if err := ctx.Err(); err != nil {
			_ = sse.AiMsgError("request cancelled")
			return &uctypes.StopReason{
				Kind:      uctypes.StopKindCanceled,
				ErrorType: "cancelled",
				ErrorText: "request cancelled",
			}, err
		}

		event, err := decoder.Decode()
		if err != nil {
			if errors.Is(err, io.EOF) {
				// Normal end of stream
				break
			}
			// transport error mid-stream
			_ = sse.AiMsgError(err.Error())
			return &uctypes.StopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream",
				ErrorText: err.Error(),
			}, err
		}

		if stop, ret := handleAnthropicEvent(event, sse, blockMap, &toolCalls, &msgID, &model, stopFromDelta); ret != nil {
			// Either error or message_stop triggered return
			finished = true
			return ret, nil
		} else {
			// maybe updated final stop reason (from message_delta)
			if stop != nil && *stop != "" {
				stopFromDelta = *stop
			}
		}
	}

	// If we got here without a message_stop, close as done.
	if !finished {
		_ = sse.AiMsgFinish("", nil)
	}
	return &uctypes.StopReason{
		Kind:      uctypes.StopKindDone,
		RawReason: stopFromDelta,
		MessageID: msgID,
		Model:     model,
	}, nil
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
	blocks map[int]*blockState,
	toolCalls *[]uctypes.ToolCall,
	msgID *string,
	model *string,
	stopFromPreviousDelta string,
) (stopFromDelta *string, final *uctypes.StopReason) {
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
			return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		msg := "unknown error"
		etype := "error"
		if ev.Error != nil {
			msg = ev.Error.Message
			etype = ev.Error.Type
		}
		_ = sse.AiMsgError(msg)
		return nil, &uctypes.StopReason{
			Kind:      uctypes.StopKindError,
			ErrorType: etype,
			ErrorText: msg,
		}

	case "message_start":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Message != nil {
			*msgID = ev.Message.ID
			*model = ev.Message.Model
		}
		_ = sse.AiMsgStart(*msgID)
		_ = sse.AiMsgStartStep()
		return nil, nil

	case "content_block_start":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Index == nil || ev.ContentBlock == nil {
			return nil, nil
		}
		idx := *ev.Index
		switch ev.ContentBlock.Type {
		case "text":
			id := uuid.New().String()
			blocks[idx] = &blockState{kind: blockText, localID: id}
			_ = sse.AiMsgTextStart(id)
		case "thinking":
			id := uuid.New().String()
			blocks[idx] = &blockState{kind: blockThinking, localID: id}
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
			blocks[idx] = st
			_ = sse.AiMsgToolInputStart(tcID, tName)
		default:
			// ignore other block types gracefully per Anthropic guidance :contentReference[oaicite:18]{index=18}
		}
		return nil, nil

	case "content_block_delta":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Index == nil || ev.Delta == nil {
			return nil, nil
		}
		st := blocks[*ev.Index]
		if st == nil {
			return nil, nil
		}
		switch ev.Delta.Type {
		case "text_delta":
			if st.kind == blockText {
				_ = sse.AiMsgTextDelta(st.localID, ev.Delta.Text)
			}
		case "thinking_delta":
			if st.kind == blockThinking {
				_ = sse.AiMsgReasoningDelta(st.localID, ev.Delta.Thinking)
			}
		case "input_json_delta":
			if st.kind == blockToolUse {
				st.accumJSON.Write(ev.Delta.PartialJSON)
				_ = sse.AiMsgToolInputDelta(st.toolCallID, ev.Delta.PartialJSON)
			}
		case "signature_delta":
			// ignore; integrity metadata for thinking blocks. :contentReference[oaicite:19]{index=19}
		default:
			// ignore unknown deltas gracefully. :contentReference[oaicite:20]{index=20}
		}
		return nil, nil

	case "content_block_stop":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Index == nil {
			return nil, nil
		}
		st := blocks[*ev.Index]
		if st == nil {
			return nil, nil
		}
		switch st.kind {
		case blockText:
			_ = sse.AiMsgTextEnd(st.localID)
		case blockThinking:
			_ = sse.AiMsgReasoningEnd(st.localID)
		case blockToolUse:
			raw, jerr := st.accumJSON.FinalObject()
			if jerr != nil {
				_ = sse.AiMsgError(jerr.Error())
				return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "parse", ErrorText: jerr.Error()}
			}
			var input any
			if len(raw) > 0 {
				jerr = json.Unmarshal(raw, &input)
				if jerr != nil {
					_ = sse.AiMsgError(jerr.Error())
					return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "parse", ErrorText: jerr.Error()}
				}
			}
			_ = sse.AiMsgToolInputAvailable(st.toolCallID, st.toolName, raw)
			*toolCalls = append(*toolCalls, uctypes.ToolCall{
				ID:    st.toolCallID,
				Name:  st.toolName,
				Input: input,
			})
		}
		return nil, nil

	case "message_delta":
		var ev anthropicFullStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return nil, &uctypes.StopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}
		}
		if ev.Delta != nil && ev.Delta.StopReason != nil {
			stopFromDelta = ev.Delta.StopReason
		}
		return stopFromDelta, nil

	case "message_stop":
		// Decide finalization based on last known stop_reason.
		// If we didn't capture it in message_delta, treat as end_turn.
		reason := "end_turn"
		if stopFromPreviousDelta != "" {
			reason = stopFromPreviousDelta
		}
		switch reason {
		case "tool_use":
			// Finish step, return tool calls (no finish). :contentReference[oaicite:21]{index=21}
			_ = sse.AiMsgFinishStep()
			return nil, &uctypes.StopReason{
				Kind:       uctypes.StopKindToolUse,
				RawReason:  reason,
				MessageID:  *msgID,
				Model:      *model,
				ToolCalls:  *toolCalls,
				FinishStep: true,
			}
		case "max_tokens":
			_ = sse.AiMsgFinish(reason, nil)
			return nil, &uctypes.StopReason{
				Kind:      uctypes.StopKindMaxTokens,
				RawReason: reason,
				MessageID: *msgID,
				Model:     *model,
			}
		case "refusal":
			_ = sse.AiMsgFinish(reason, nil)
			return nil, &uctypes.StopReason{
				Kind:      uctypes.StopKindContent,
				RawReason: reason,
				MessageID: *msgID,
				Model:     *model,
			}
		default:
			// end_turn, stop_sequence, pause_turn (treat as end of this call)
			_ = sse.AiMsgFinish(reason, nil)
			return nil, &uctypes.StopReason{
				Kind:      uctypes.StopKindDone,
				RawReason: reason,
				MessageID: *msgID,
				Model:     *model,
			}
		}

	default:
		log.Printf("unknown anthropic event type: %s", eventName)
		return nil, nil
	}
}

// buildAnthropicHTTPRequest creates a complete HTTP request for the Anthropic API
func buildAnthropicHTTPRequest(ctx context.Context, opts *uctypes.AIOptsType, msgs []uctypes.UseChatMessage, tools []uctypes.ToolDefinition) (*http.Request, error) {
	if opts == nil {
		return nil, errors.New("opts is nil")
	}
	if opts.APIToken == "" {
		return nil, errors.New("Anthropic API token missing")
	}
	if opts.Model == "" {
		return nil, errors.New("opts.model is required")
	}

	// Set defaults
	baseURL := opts.BaseURL
	if baseURL == "" {
		baseURL = AnthropicDefaultBaseURL
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/messages"

	apiVersion := opts.APIVersion
	if apiVersion == "" {
		apiVersion = AnthropicDefaultAPIVersion
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = AnthropicDefaultMaxTokens
	}

	// Build request body
	reqBody := &anthropicStreamRequest{
		Model:     opts.Model,
		MaxTokens: maxTokens,
		Stream:    true,
	}
	if len(tools) > 0 {
		reqBody.Tools = tools
	}

	// Enable extended thinking based on level
	if opts.ThinkingLevel == uctypes.ThinkingLevelMedium || opts.ThinkingLevel == uctypes.ThinkingLevelHigh {
		thinking := map[string]interface{}{
			"type":          "enabled",
			"budget_tokens": AnthropicThinkingBudget,
		}
		reqBody.Thinking = thinking
	}

	for _, m := range msgs {
		aim := anthropicInputMessage{Role: m.Role}
		if len(m.Parts) > 0 {
			blocks, err := convertPartsToAnthropicBlocks(m.Parts, m.Role)
			if err != nil {
				return nil, fmt.Errorf("invalid message parts: %w", err)
			}
			bs, _ := json.Marshal(blocks)
			aim.Content = bs
		} else {
			// Shorthand: string becomes a single text block
			if m.Content == "" {
				m.Content = ""
			}
			aim.Content = json.RawMessage(fmt.Sprintf("%q", m.Content))
		}
		reqBody.Messages = append(reqBody.Messages, aim)
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", opts.APIToken)
	req.Header.Set("anthropic-version", apiVersion)
	req.Header.Set("accept", "text/event-stream")

	return req, nil
}

// convertPartsToAnthropicBlocks converts UseChatMessagePart array to Anthropic content blocks with role-based validation
func convertPartsToAnthropicBlocks(parts []uctypes.UseChatMessagePart, role string) ([]interface{}, error) {
	var blocks []interface{}

	for _, p := range parts {
		switch strings.ToLower(p.Type) {
		case "text", "":
			blocks = append(blocks, map[string]interface{}{
				"type": "text",
				"text": p.Text,
			})

		case "image":
			// Anthropic expects images in user messages
			if role != "user" {
				log.Printf("anthropic: dropping image part in %s message (images should be in user messages)", role)
				continue
			}
			if p.Source == nil {
				return nil, errors.New("image part missing source")
			}
			block, err := convertImagePart(p)
			if err != nil {
				return nil, err
			}
			blocks = append(blocks, block)

		case "tool_result":
			// Anthropic requires tool_result in user messages
			if role != "user" {
				log.Printf("anthropic: dropping tool_result part in %s message (tool_result must be in user messages)", role)
				continue
			}
			block, err := convertToolResultPart(p)
			if err != nil {
				return nil, err
			}
			blocks = append(blocks, block)

		default:
			// Log and skip unknown part types
			log.Printf("anthropic: dropping unknown part type '%s'", p.Type)
		}
	}

	return blocks, nil
}

// convertImagePart converts an image part to Anthropic image block format
func convertImagePart(p uctypes.UseChatMessagePart) (map[string]interface{}, error) {
	if p.Source == nil {
		return nil, errors.New("image part missing source")
	}

	source := map[string]interface{}{
		"type": p.Source.Type,
	}

	switch p.Source.Type {
	case "url":
		if p.Source.URL == "" {
			return nil, errors.New("image source type 'url' requires url field")
		}
		source["url"] = p.Source.URL

	case "base64":
		if p.Source.Data == "" {
			return nil, errors.New("image source type 'base64' requires data field")
		}
		if p.Source.MediaType == "" {
			return nil, errors.New("image source type 'base64' requires media_type field")
		}
		source["data"] = p.Source.Data
		source["media_type"] = p.Source.MediaType

	case "file":
		if p.Source.FileID == "" {
			return nil, errors.New("image source type 'file' requires file_id field")
		}
		source["file_id"] = p.Source.FileID

	default:
		return nil, fmt.Errorf("unsupported image source type: %s", p.Source.Type)
	}

	return map[string]interface{}{
		"type":   "image",
		"source": source,
	}, nil
}

// convertToolResultPart converts a tool_result part to Anthropic tool_result block format
func convertToolResultPart(p uctypes.UseChatMessagePart) (map[string]interface{}, error) {
	if p.ToolUseID == "" {
		return nil, errors.New("tool_result part missing tool_use_id")
	}

	block := map[string]interface{}{
		"type":        "tool_result",
		"tool_use_id": p.ToolUseID,
	}

	// Handle content field - can be string or array of content blocks
	if len(p.Content) == 0 {
		// No content blocks, use empty string
		block["content"] = ""
	} else if len(p.Content) == 1 && p.Content[0].Type == "text" {
		// Single text block - use string format
		block["content"] = p.Content[0].Text
	} else {
		// Multiple blocks or non-text - convert to Anthropic content block array
		var contentBlocks []interface{}
		for _, cb := range p.Content {
			switch cb.Type {
			case "text":
				contentBlocks = append(contentBlocks, map[string]interface{}{
					"type": "text",
					"text": cb.Text,
				})
			default:
				// For now, convert non-text content to text representation
				// This handles cases like tool output data
				text := ""
				if cb.Text != "" {
					text = cb.Text
				} else if cb.Data != nil {
					// Convert data to JSON string
					if jsonBytes, err := json.Marshal(cb.Data); err == nil {
						text = string(jsonBytes)
					}
				}
				contentBlocks = append(contentBlocks, map[string]interface{}{
					"type": "text",
					"text": text,
				})
			}
		}
		block["content"] = contentBlocks
	}

	// Add is_error if specified
	if p.IsError != nil {
		block["is_error"] = *p.IsError
	}

	return block, nil
}
