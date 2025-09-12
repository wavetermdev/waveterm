// Package anthropicadapter streams Anthropic Messages API events and adapts them
// to our AI‑SDK style SSE parts. Mapping is based on the AI‑SDK data stream
// protocol (start/text-start/text-delta/text-end, reasoning-*, tool-input-*, finish, finish-step) :contentReference[oaicite:0]{index=0}
// and Anthropic's Messages + Streaming event schemas (message_start,
// content_block_start/delta/stop, message_delta, message_stop, error). :contentReference[oaicite:1]{index=1} :contentReference[oaicite:2]{index=2}
//
// NOTE: The public signature in api.txt references wshrpc.WaveAIOptsType;
// for this self-contained package we define WaveAIOptsType locally with the
// same shape. Adapt the import/alias as needed in your codebase. :contentReference[oaicite:3]{index=3}
package waveai

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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

type ToolCall struct {
	ID    string          `json:"id"`              // Anthropic tool_use.id
	Name  string          `json:"name,omitempty"`  // tool name (if provided)
	Input json.RawMessage `json:"input,omitempty"` // accumulated input JSON
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
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"input_schema"`
}

// ---------- Anthropic wire types (subset) ----------
// Derived from anthropic-messages-api.md and anthropic-streaming.md. :contentReference[oaicite:6]{index=6} :contentReference[oaicite:7]{index=7}

type anthropicInputMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"` // string or []blocks
}

type anthropicStreamRequest struct {
	Model      string                  `json:"model"`
	Messages   []anthropicInputMessage `json:"messages"`
	MaxTokens  int                     `json:"max_tokens"`
	Stream     bool                    `json:"stream"`
	System     any                     `json:"system,omitempty"`
	ToolChoice any                     `json:"tool_choice,omitempty"`
	Tools      []ToolDefinition        `json:"tools,omitempty"`
	Thinking   any                     `json:"thinking,omitempty"`
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

type anthropicFullStreamEvent struct {
	Type         string                      `json:"type"`
	Message      *anthropicMessageObj        `json:"message,omitempty"`
	Index        *int                        `json:"index,omitempty"`
	ContentBlock *anthropicContentBlockType  `json:"content_block,omitempty"`
	Delta        *anthropicDeltaType         `json:"delta,omitempty"`
	Usage        *anthropicUsageType         `json:"usage,omitempty"`
	Error        *anthropicErrorType         `json:"error,omitempty"`
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
// - message_start → AiMsgStart
// - content_block_start(type=text) → AiMsgTextStart; text_delta → AiMsgTextDelta; content_block_stop → AiMsgTextEnd
// - content_block_start(type=thinking) → AiMsgReasoningStart; thinking_delta → AiMsgReasoningDelta; stop → AiMsgReasoningEnd
// - content_block_start(type=tool_use) → AiMsgToolInputStart; input_json_delta → AiMsgToolInputDelta; stop → AiMsgToolInputAvailable
// - If final stop_reason == "tool_use": emit AiMsgFinishStep and return StopReason{Kind:ToolUse, ...} WITHOUT AiMsgFinish
// - If message_stop with stop_reason == "end_turn" or nil: emit AiMsgFinish then [DONE]
// - On Anthropic error event: AiMsgError and return StopKindError. :contentReference[oaicite:9]{index=9} :contentReference[oaicite:10]{index=10}
func StreamAnthropicResponses(
	ctx context.Context,
	sse *SSEHandlerCh,
	opts *wshrpc.WaveAIOptsType,
	messages []UseChatMessage,
	tools []ToolDefinition,
) (*StopReason, error) {
	if sse == nil {
		return nil, errors.New("sse handler is nil")
	}
	if opts == nil {
		return nil, errors.New("opts is nil")
	}
	if opts.APIToken == "" {
		return nil, errors.New("Anthropic API token missing")
	}
	baseURL := opts.BaseURL
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/messages" // :contentReference[oaicite:11]{index=11}
	apiVersion := opts.APIVersion
	if apiVersion == "" {
		apiVersion = "2023-06-01" // default from examples :contentReference[oaicite:12]{index=12}
	}
	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024 // safe default per docs/examples :contentReference[oaicite:13]{index=13}
	}

	reqBody, err := buildAnthropicRequest(opts.Model, maxTokens, messages, tools)
	if err != nil {
		return nil, err
	}
	bodyBytes, _ := json.Marshal(reqBody)

	// Context with timeout if provided.
	if opts.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(opts.TimeoutMs)*time.Millisecond)
		defer cancel()
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

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", opts.APIToken)
	req.Header.Set("anthropic-version", apiVersion)
	// Request streaming SSE. :contentReference[oaicite:14]{index=14}
	req.Header.Set("accept", "text/event-stream")

	resp, err := httpClient.Do(req)
	if err != nil {
		// Distinguish context cancellation.
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return &StopReason{
				Kind:       StopKindCanceled,
				RawReason:  "canceled",
				ErrorText:  err.Error(),
				FinishStep: false,
			}, err
		}
		_ = sse.AiMsgError(err.Error())
		return &StopReason{
			Kind:      StopKindError,
			ErrorType: "transport",
			ErrorText: err.Error(),
		}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		// Try to decode Anthropic error JSON schema then surface it. :contentReference[oaicite:15]{index=15}
		var eresp struct {
			Type  string `json:"type"`
			Error struct {
				Type    string `json:"type"`
				Message string `json:"message"`
			} `json:"error"`
		}
		slurp, _ := io.ReadAll(resp.Body)
		_ = json.Unmarshal(slurp, &eresp)
		msg := strings.TrimSpace(string(slurp))
		if eresp.Error.Message != "" {
			msg = eresp.Error.Message
		}
		_ = sse.AiMsgError(msg)
		return &StopReason{
			Kind:      StopKindError,
			ErrorType: eresp.Error.Type,
			ErrorText: msg,
		}, fmt.Errorf("anthropic %s: %s", resp.Status, msg)
	}

	// Stream decoding state
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024) // allow large lines
	var curEvent string
	var dataBuf bytes.Buffer

	reset := func() {
		curEvent = ""
		dataBuf.Reset()
	}

	// Per-response state
	blockMap := map[int]*blockState{}
	var toolCalls []ToolCall
	var finalStop string
	var msgID string
	var model string

	// SSE loop per RFC: collect "event:" and multi-line "data:" until blank line.
	for {
		if !scanner.Scan() {
			// EOF or read error: treat as end of stream.
			if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
				// transport error mid-stream
				_ = sse.AiMsgError(err.Error())
				return &StopReason{
					Kind:      StopKindError,
					ErrorType: "stream",
					ErrorText: err.Error(),
				}, err
			}
			break
		}
		line := scanner.Text()
		if line == "" {
			// dispatch event
			if curEvent != "" {
				if stop, ret, rerr := handleAnthropicEvent(curEvent, dataBuf.String(), sse, blockMap, &toolCalls, &msgID, &model, finalStop); rerr != nil {
					// Anthropic sent error event or malformed JSON.
					return stop, rerr
				} else if ret != nil {
					// message_stop triggered return
					return ret, nil
				} else {
					// maybe updated final stop reason (from message_delta)
					if stop != nil && stop.RawReason != "" {
						finalStop = stop.RawReason
					}
				}
			}
			reset()
			continue
		}

		if strings.HasPrefix(line, "event:") {
			curEvent = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if strings.HasPrefix(line, "data:") {
			if dataBuf.Len() > 0 {
				dataBuf.WriteByte('\n')
			}
			dataBuf.WriteString(strings.TrimPrefix(line, "data: "))
			continue
		}
		// ignore comments and retry: lines
	}

	// If we got here without a message_stop, close as done.
	_ = sse.AiMsgFinish("", nil)
	return &StopReason{
		Kind:      StopKindDone,
		RawReason: finalStop,
		MessageID: msgID,
		Model:     model,
	}, nil
}

// handleAnthropicEvent processes one SSE event block. It may emit SSE parts
// and/or return a StopReason when the stream is complete.
//
// Return tuple:
//   - stopFromDelta: a *StopReason with only RawReason set when message_delta updates stop_reason
//   - final: a *StopReason to return immediately (e.g., after message_stop)
//   - err: non-nil if an error event occurred or parsing failed.
//
// Event model: anthropic-streaming.md. :contentReference[oaicite:16]{index=16}
func handleAnthropicEvent(
	eventName string,
	data string,
	sse *SSEHandlerCh,
	blocks map[int]*blockState,
	toolCalls *[]ToolCall,
	msgID *string,
	model *string,
	finalStop string,
) (stopFromDelta *StopReason, final *StopReason, err error) {

	switch eventName {
	case "ping":
		return nil, nil, nil // ignore

	case "error":
		// Example: data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}} :contentReference[oaicite:17]{index=17}
		var ev anthropicFullStreamEvent
		if jerr := json.Unmarshal([]byte(data), &ev); jerr != nil {
			err = fmt.Errorf("error event decode: %w", jerr)
			_ = sse.AiMsgError(err.Error())
			return &StopReason{Kind: StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil, err
		}
		msg := "unknown error"
		etype := "error"
		if ev.Error != nil {
			msg = ev.Error.Message
			etype = ev.Error.Type
		}
		_ = sse.AiMsgError(msg)
		return &StopReason{
				Kind:      StopKindError,
				ErrorType: etype,
				ErrorText: msg,
			}, &StopReason{
				Kind:      StopKindError,
				ErrorType: etype,
				ErrorText: msg,
			}, fmt.Errorf("anthropic error: %s", msg)

	case "message_start":
		var ev anthropicFullStreamEvent
		if err = json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &StopReason{Kind: StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil, err
		}
		if ev.Message != nil {
			*msgID = ev.Message.ID
			*model = ev.Message.Model
		}
		_ = sse.AiMsgStart(*msgID)
		return nil, nil, nil

	case "content_block_start":
		var ev anthropicFullStreamEvent
		if err = json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &StopReason{Kind: StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil, err
		}
		if ev.Index == nil || ev.ContentBlock == nil {
			return nil, nil, nil
		}
		idx := *ev.Index
		switch ev.ContentBlock.Type {
		case "text":
			id := genID("text")
			blocks[idx] = &blockState{kind: blockText, localID: id}
			_ = sse.AiMsgTextStart(id)
		case "thinking":
			id := genID("reasoning")
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
		return nil, nil, nil

	case "content_block_delta":
		var ev anthropicFullStreamEvent
		if err = json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &StopReason{Kind: StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil, err
		}
		if ev.Index == nil || ev.Delta == nil {
			return nil, nil, nil
		}
		st := blocks[*ev.Index]
		if st == nil {
			return nil, nil, nil
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
		return nil, nil, nil

	case "content_block_stop":
		var ev anthropicFullStreamEvent
		if err = json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &StopReason{Kind: StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil, err
		}
		if ev.Index == nil {
			return nil, nil, nil
		}
		st := blocks[*ev.Index]
		if st == nil {
			return nil, nil, nil
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
				return &StopReason{Kind: StopKindError, ErrorType: "parse", ErrorText: jerr.Error()}, nil, jerr
			}
			_ = sse.AiMsgToolInputAvailable(st.toolCallID, st.toolName, raw)
			*toolCalls = append(*toolCalls, ToolCall{
				ID:    st.toolCallID,
				Name:  st.toolName,
				Input: raw,
			})
		}
		return nil, nil, nil

	case "message_delta":
		var ev anthropicFullStreamEvent
		if err = json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &StopReason{Kind: StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil, err
		}
		if ev.Delta != nil && ev.Delta.StopReason != nil {
			stopFromDelta = &StopReason{RawReason: *ev.Delta.StopReason}
		}
		return stopFromDelta, nil, nil

	case "message_stop":
		// Decide finalization based on last known stop_reason.
		// If we didn't capture it in message_delta, treat as end_turn.
		reason := "end_turn"
		if stopFromDelta != nil && stopFromDelta.RawReason != "" {
			reason = stopFromDelta.RawReason
		}
		switch reason {
		case "tool_use":
			// Finish step, return tool calls (no finish). :contentReference[oaicite:21]{index=21}
			_ = sse.AiMsgFinishStep()
			return nil, &StopReason{
				Kind:       StopKindToolUse,
				RawReason:  reason,
				MessageID:  *msgID,
				Model:      *model,
				ToolCalls:  *toolCalls,
				FinishStep: true,
			}, nil
		case "max_tokens":
			_ = sse.AiMsgFinish(reason, nil)
			return nil, &StopReason{
				Kind:      StopKindMaxTokens,
				RawReason: reason,
				MessageID: *msgID,
				Model:     *model,
			}, nil
		case "refusal":
			_ = sse.AiMsgFinish(reason, nil)
			return nil, &StopReason{
				Kind:      StopKindContent,
				RawReason: reason,
				MessageID: *msgID,
				Model:     *model,
			}, nil
		default:
			// end_turn, stop_sequence, pause_turn (treat as end of this call)
			_ = sse.AiMsgFinish(reason, nil)
			return nil, &StopReason{
				Kind:      StopKindDone,
				RawReason: reason,
				MessageID: *msgID,
				Model:     *model,
			}, nil
		}

	default:
		// Unknown event names may appear over time; ignore. :contentReference[oaicite:22]{index=22}
		return nil, nil, nil
	}
}

// buildAnthropicRequest converts our UseChatMessage[] to Anthropic's request
// body with stream=true and configured model/max_tokens. :contentReference[oaicite:23]{index=23}
func buildAnthropicRequest(model string, maxTokens int, msgs []UseChatMessage, tools []ToolDefinition) (*anthropicStreamRequest, error) {
	if model == "" {
		return nil, errors.New("opts.model is required")
	}
	out := &anthropicStreamRequest{
		Model:     model,
		MaxTokens: maxTokens,
		Stream:    true,
	}
	if len(tools) > 0 {
		out.Tools = tools
	}
	for _, m := range msgs {
		aim := anthropicInputMessage{Role: m.Role}
		// Content may be a string or array of blocks; support text only. :contentReference[oaicite:24]{index=24}
		if len(m.Parts) > 0 {
			var blocks []map[string]string
			for _, p := range m.Parts {
				if strings.ToLower(p.Type) == "text" || p.Type == "" {
					blocks = append(blocks, map[string]string{
						"type": "text",
						"text": p.Text,
					})
				}
			}
			bs, _ := json.Marshal(blocks)
			aim.Content = bs
		} else {
			// Shorthand: string becomes a single text block. :contentReference[oaicite:25]{index=25}
			if m.Content == "" {
				m.Content = ""
			}
			aim.Content = json.RawMessage(fmt.Sprintf("%q", m.Content))
		}
		out.Messages = append(out.Messages, aim)
	}
	return out, nil
}

func genID(prefix string) string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b[:]))
}
