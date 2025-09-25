// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
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

// ---------- OpenAI wire types (subset) ----------

type OpenAIChatMessage struct {
	MessageId string                 `json:"messageid"` // internal field for idempotency (cannot send to openai)
	Role      string                 `json:"role"`
	Content   []OpenAIMessageContent `json:"content"`
}

type openAIErrorResponse struct {
	Error openAIErrorType `json:"error"`
}

type openAIErrorType struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code"`
}

func (m *OpenAIChatMessage) GetMessageId() string {
	return m.MessageId
}

// ---------- OpenAI SSE Event Types ----------

type openaiResponseCreatedEvent struct {
	Type           string         `json:"type"`
	SequenceNumber int            `json:"sequence_number"`
	Response       openaiResponse `json:"response"`
}

type openaiResponseInProgressEvent struct {
	Type           string         `json:"type"`
	SequenceNumber int            `json:"sequence_number"`
	Response       openaiResponse `json:"response"`
}

type openaiResponseOutputItemAddedEvent struct {
	Type           string           `json:"type"`
	SequenceNumber int              `json:"sequence_number"`
	OutputIndex    int              `json:"output_index"`
	Item           openaiOutputItem `json:"item"`
}

type openaiResponseOutputItemDoneEvent struct {
	Type           string           `json:"type"`
	SequenceNumber int              `json:"sequence_number"`
	OutputIndex    int              `json:"output_index"`
	Item           openaiOutputItem `json:"item"`
}

type openaiResponseContentPartAddedEvent struct {
	Type           string               `json:"type"`
	SequenceNumber int                  `json:"sequence_number"`
	ItemId         string               `json:"item_id"`
	OutputIndex    int                  `json:"output_index"`
	ContentIndex   int                  `json:"content_index"`
	Part           OpenAIMessageContent `json:"part"`
}

type openaiResponseOutputTextDeltaEvent struct {
	Type           string   `json:"type"`
	SequenceNumber int      `json:"sequence_number"`
	ItemId         string   `json:"item_id"`
	OutputIndex    int      `json:"output_index"`
	ContentIndex   int      `json:"content_index"`
	Delta          string   `json:"delta"`
	Logprobs       []string `json:"logprobs"`
	Obfuscation    string   `json:"obfuscation"`
}

type openaiResponseOutputTextDoneEvent struct {
	Type           string   `json:"type"`
	SequenceNumber int      `json:"sequence_number"`
	ItemId         string   `json:"item_id"`
	OutputIndex    int      `json:"output_index"`
	ContentIndex   int      `json:"content_index"`
	Text           string   `json:"text"`
	Logprobs       []string `json:"logprobs"`
}

type openaiResponseContentPartDoneEvent struct {
	Type           string               `json:"type"`
	SequenceNumber int                  `json:"sequence_number"`
	ItemId         string               `json:"item_id"`
	OutputIndex    int                  `json:"output_index"`
	ContentIndex   int                  `json:"content_index"`
	Part           OpenAIMessageContent `json:"part"`
}

type openaiResponseCompletedEvent struct {
	Type           string         `json:"type"`
	SequenceNumber int            `json:"sequence_number"`
	Response       openaiResponse `json:"response"`
}

// ---------- OpenAI Response Structure Types ----------

type openaiResponse struct {
	Id                 string                 `json:"id"`
	Object             string                 `json:"object"`
	CreatedAt          int64                  `json:"created_at"`
	Status             string                 `json:"status"`
	Background         bool                   `json:"background"`
	Error              *openaiError           `json:"error"`
	IncompleteDetails  *openaiIncompleteInfo  `json:"incomplete_details"`
	Instructions       *string                `json:"instructions"`
	MaxOutputTokens    *int                   `json:"max_output_tokens"`
	MaxToolCalls       *int                   `json:"max_tool_calls"`
	Model              string                 `json:"model"`
	Output             []openaiOutputItem     `json:"output"`
	ParallelToolCalls  bool                   `json:"parallel_tool_calls"`
	PreviousResponseId *string                `json:"previous_response_id"`
	PromptCacheKey     *string                `json:"prompt_cache_key"`
	Reasoning          openaiReasoning        `json:"reasoning"`
	SafetyIdentifier   *string                `json:"safety_identifier"`
	ServiceTier        string                 `json:"service_tier"`
	Store              bool                   `json:"store"`
	Temperature        float64                `json:"temperature"`
	Text               openaiTextConfig       `json:"text"`
	ToolChoice         string                 `json:"tool_choice"`
	Tools              []openaiTool           `json:"tools"`
	TopLogprobs        int                    `json:"top_logprobs"`
	TopP               float64                `json:"top_p"`
	Truncation         string                 `json:"truncation"`
	Usage              *openaiUsage           `json:"usage"`
	User               *string                `json:"user"`
	Metadata           map[string]interface{} `json:"metadata"`
}

type openaiOutputItem struct {
	Id      string                 `json:"id"`
	Type    string                 `json:"type"`
	Status  string                 `json:"status,omitempty"`
	Content []OpenAIMessageContent `json:"content,omitempty"`
	Role    string                 `json:"role,omitempty"`
	Summary []string               `json:"summary,omitempty"`
}

type openaiReasoning struct {
	Effort  string  `json:"effort"`
	Summary *string `json:"summary"`
}

type openaiTextConfig struct {
	Format    openaiTextFormat `json:"format"`
	Verbosity string           `json:"verbosity"`
}

type openaiTextFormat struct {
	Type string `json:"type"`
}

type openaiTool struct {
	// Tool definition - can be expanded later
}

type openaiUsage struct {
	InputTokens         int                       `json:"input_tokens"`
	InputTokensDetails  openaiInputTokensDetails  `json:"input_tokens_details"`
	OutputTokens        int                       `json:"output_tokens"`
	OutputTokensDetails openaiOutputTokensDetails `json:"output_tokens_details"`
	TotalTokens         int                       `json:"total_tokens"`
}

type openaiInputTokensDetails struct {
	CachedTokens int `json:"cached_tokens"`
}

type openaiOutputTokensDetails struct {
	ReasoningTokens int `json:"reasoning_tokens"`
}

type openaiError struct {
	// Error details - can be expanded later
}

type openaiIncompleteInfo struct {
	Reason string `json:"reason"`
}

// ---------- OpenAI streaming state types ----------

type openaiBlockKind int

const (
	openaiBlockText openaiBlockKind = iota
	openaiBlockReasoning
	openaiBlockToolUse
)

type openaiBlockState struct {
	kind    openaiBlockKind
	localID string // For SSE streaming to UI
}

type openaiStreamingState struct {
	blockMap    map[string]*openaiBlockState // Use item_id as key for UI streaming
	msgID       string
	model       string
	stepStarted bool
}

// ---------- Public entrypoint ----------

func RunOpenAIChatStep(
	ctx context.Context,
	sse *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, *OpenAIChatMessage, error) {
	if sse == nil {
		return nil, nil, errors.New("sse handler is nil")
	}
	if cont != nil {
		return nil, nil, errors.New("tool/cont functionality in OpenAI backend unimplemented")
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

	// Convert GenAIMessages to OpenAIMessages
	var openaiMsgs []OpenAIMessage
	for _, genMsg := range chat.NativeMessages {
		// Cast to OpenAIChatMessage
		chatMsg, ok := genMsg.(*OpenAIChatMessage)
		if !ok {
			return nil, nil, fmt.Errorf("expected OpenAIChatMessage, got %T", genMsg)
		}
		// Convert to OpenAIMessage with copied content
		contentCopy := make([]OpenAIMessageContent, len(chatMsg.Content))
		copy(contentCopy, chatMsg.Content)
		inputMsg := OpenAIMessage{
			Role:    chatMsg.Role,
			Content: contentCopy,
		}
		openaiMsgs = append(openaiMsgs, inputMsg)
	}

	req, err := buildOpenAIHTTPRequest(ctx, openaiMsgs, chatOpts)
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
		return nil, nil, parseOpenAIHTTPError(resp)
	}

	// At this point we have a valid SSE stream, so setup SSE handling
	// From here on, errors must be returned through the SSE stream
	if cont == nil {
		sse.SetupSSE()
	}

	// Use eventsource decoder for proper SSE parsing
	decoder := eventsource.NewDecoder(resp.Body)

	stopReason, rtnMessage := handleOpenAIStreamingResp(ctx, sse, decoder, cont)
	return stopReason, rtnMessage, nil
}

// parseOpenAIHTTPError parses OpenAI API HTTP error responses
func parseOpenAIHTTPError(resp *http.Response) error {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("openai %s: failed to read error response: %v", resp.Status, err)
	}

	var errorResp openAIErrorResponse
	if err := json.Unmarshal(body, &errorResp); err != nil {
		return fmt.Errorf("openai %s: failed to parse error response: %v", resp.Status, err)
	}

	if errorResp.Error.Message != "" {
		return fmt.Errorf("openai %s: %s", resp.Status, errorResp.Error.Message)
	}

	return fmt.Errorf("openai %s: unknown error", resp.Status)
}

// handleOpenAIStreamingResp handles the OpenAI SSE streaming response
func handleOpenAIStreamingResp(ctx context.Context, sse *sse.SSEHandlerCh, decoder *eventsource.Decoder, cont *uctypes.WaveContinueResponse) (*uctypes.WaveStopReason, *OpenAIChatMessage) {
	// Per-response state
	state := &openaiStreamingState{
		blockMap: map[string]*openaiBlockState{},
	}

	var rtnStopReason *uctypes.WaveStopReason
	var rtnMessage *OpenAIChatMessage

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
			}, rtnMessage
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
			}, rtnMessage
		}

		if finalStopReason, finalMessage := handleOpenAIEvent(event, sse, state, cont); finalStopReason != nil {
			// Either error or response.completed triggered return
			rtnStopReason = finalStopReason
			if finalMessage != nil {
				rtnMessage = finalMessage
			}
			return finalStopReason, rtnMessage
		}
	}

	// EOF - let defer handle cleanup
	if rtnMessage == nil {
		rtnMessage = &OpenAIChatMessage{
			MessageId: uuid.New().String(),
			Role:      "assistant",
			Content:   []OpenAIMessageContent{},
		}
	}
	rtnStopReason = &uctypes.WaveStopReason{
		Kind:      uctypes.StopKindDone,
		MessageID: state.msgID,
		Model:     state.model,
	}
	return rtnStopReason, rtnMessage
}

// handleOpenAIEvent processes one SSE event block. It may emit SSE parts
// and/or return a StopReason and final message when the stream is complete.
//
// Return tuple:
//   - final: a *StopReason to return immediately (e.g., after response.completed or error)
//   - message: a *OpenAIChatMessage when response is completed
func handleOpenAIEvent(
	event eventsource.Event,
	sse *sse.SSEHandlerCh,
	state *openaiStreamingState,
	cont *uctypes.WaveContinueResponse,
) (final *uctypes.WaveStopReason, message *OpenAIChatMessage) {
	eventName := event.Event()
	data := event.Data()

	switch eventName {
	case "response.created":
		var ev openaiResponseCreatedEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil
		}
		state.msgID = ev.Response.Id
		state.model = ev.Response.Model
		if cont == nil {
			_ = sse.AiMsgStart(state.msgID)
		}
		return nil, nil

	case "response.in_progress":
		// Start the step on in_progress
		if !state.stepStarted {
			_ = sse.AiMsgStartStep()
			state.stepStarted = true
		}
		return nil, nil

	case "response.output_item.added":
		var ev openaiResponseOutputItemAddedEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil
		}

		switch ev.Item.Type {
		case "reasoning":
			// Handle reasoning item for UI streaming
			id := uuid.New().String()
			state.blockMap[ev.Item.Id] = &openaiBlockState{
				kind:    openaiBlockReasoning,
				localID: id,
			}
			_ = sse.AiMsgReasoningStart(id)
		case "message":
			// Message item - content parts will be handled in streaming events
		}
		return nil, nil

	case "response.output_item.done":
		var ev openaiResponseOutputItemDoneEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil
		}

		if st := state.blockMap[ev.Item.Id]; st != nil {
			switch st.kind {
			case openaiBlockReasoning:
				_ = sse.AiMsgReasoningEnd(st.localID)
			}
		}
		return nil, nil

	case "response.content_part.added":
		var ev openaiResponseContentPartAddedEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil
		}

		switch ev.Part.Type {
		case "output_text":
			// Handle text content for UI streaming only
			id := uuid.New().String()
			state.blockMap[ev.ItemId] = &openaiBlockState{
				kind:    openaiBlockText,
				localID: id,
			}
			_ = sse.AiMsgTextStart(id)
		}
		return nil, nil

	case "response.output_text.delta":
		var ev openaiResponseOutputTextDeltaEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil
		}

		if st := state.blockMap[ev.ItemId]; st != nil && st.kind == openaiBlockText {
			_ = sse.AiMsgTextDelta(st.localID, ev.Delta)
		}
		return nil, nil

	case "response.content_part.done":
		var ev openaiResponseContentPartDoneEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil
		}

		if st := state.blockMap[ev.ItemId]; st != nil && st.kind == openaiBlockText {
			_ = sse.AiMsgTextEnd(st.localID)
		}
		return nil, nil

	case "response.completed", "response.failed", "response.incomplete":
		var ev openaiResponseCompletedEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			_ = sse.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{Kind: uctypes.StopKindError, ErrorType: "decode", ErrorText: err.Error()}, nil
		}

		// Handle error case
		if ev.Response.Error != nil {
			errorMsg := "OpenAI API error"
			_ = sse.AiMsgError(errorMsg)
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "api",
				ErrorText: errorMsg,
				MessageID: state.msgID,
				Model:     state.model,
			}, nil
		}

		// Handle incomplete case
		if ev.Response.IncompleteDetails != nil {
			reason := ev.Response.IncompleteDetails.Reason
			var stopKind uctypes.StopReasonKind
			var errorMsg string

			switch reason {
			case "max_output_tokens":
				stopKind = uctypes.StopKindMaxTokens
				errorMsg = "Maximum output tokens reached"
			case "max_prompt_tokens":
				stopKind = uctypes.StopKindError
				errorMsg = "Maximum prompt tokens reached"
			case "content_filter":
				stopKind = uctypes.StopKindContent
				errorMsg = "Content filtered"
			default:
				stopKind = uctypes.StopKindError
				errorMsg = fmt.Sprintf("Response incomplete: %s", reason)
			}

			// Extract partial message if available
			finalMessage, _ := extractMessageAndToolsFromResponse(ev.Response)

			_ = sse.AiMsgError(errorMsg)
			return &uctypes.WaveStopReason{
				Kind:      stopKind,
				RawReason: reason,
				ErrorText: errorMsg,
				MessageID: state.msgID,
				Model:     state.model,
			}, finalMessage
		}

		// Extract the final message and tool calls from the response output
		finalMessage, toolCalls := extractMessageAndToolsFromResponse(ev.Response)

		stopKind := uctypes.StopKindDone
		if len(toolCalls) > 0 {
			stopKind = uctypes.StopKindToolUse
		}

		return &uctypes.WaveStopReason{
			Kind:      stopKind,
			RawReason: ev.Response.Status,
			MessageID: state.msgID,
			Model:     state.model,
			ToolCalls: toolCalls,
		}, finalMessage

	default:
		// log unknown events for debugging
		log.Printf("OpenAI: unknown event: %s, data: %s", eventName, data)
		return nil, nil
	}
}

// extractMessageAndToolsFromResponse extracts the final OpenAI message and tool calls from the completed response
func extractMessageAndToolsFromResponse(resp openaiResponse) (*OpenAIChatMessage, []uctypes.WaveToolCall) {
	message := &OpenAIChatMessage{
		MessageId: uuid.New().String(),
		Role:      "assistant",
		Content:   []OpenAIMessageContent{},
	}

	var toolCalls []uctypes.WaveToolCall

	// Process all output items in the response
	for _, outputItem := range resp.Output {
		switch outputItem.Type {
		case "message":
			if outputItem.Role == "assistant" {
				// Copy ALL content parts from the output item
				for _, contentPart := range outputItem.Content {
					message.Content = append(message.Content, OpenAIMessageContent{
						Type: contentPart.Type,
						Text: contentPart.Text,
					})
				}
			}
		case "tool_call", "function_call":
			// Extract tool call information
			toolCall := uctypes.WaveToolCall{
				ID:   outputItem.Id,
				Name: "", // Will need to extract from content if available
			}
			// TODO: Extract tool name and input from outputItem.Content
			toolCalls = append(toolCalls, toolCall)
		}
	}

	return message, toolCalls
}
