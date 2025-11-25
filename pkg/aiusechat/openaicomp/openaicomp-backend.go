// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaicomp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/launchdarkly/eventsource"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// RunCompletionsChatStep executes a chat step using the completions API
func RunCompletionsChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, []*CompletionsChatMessage, *uctypes.RateLimitInfo, error) {
	if sseHandler == nil {
		return nil, nil, nil, errors.New("sse handler is nil")
	}

	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	if chatOpts.Config.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(chatOpts.Config.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	// Convert stored messages to completions format
	var messages []CompletionsMessage

	// Add system prompt if provided
	if len(chatOpts.SystemPrompt) > 0 {
		messages = append(messages, CompletionsMessage{
			Role:    "system",
			Content: strings.Join(chatOpts.SystemPrompt, "\n"),
		})
	}

	// Convert native messages
	for _, genMsg := range chat.NativeMessages {
		compMsg, ok := genMsg.(*CompletionsChatMessage)
		if !ok {
			return nil, nil, nil, fmt.Errorf("expected CompletionsChatMessage, got %T", genMsg)
		}
		messages = append(messages, compMsg.Message)
	}

	req, err := buildCompletionsHTTPRequest(ctx, messages, chatOpts)
	if err != nil {
		return nil, nil, nil, err
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, nil, nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	// Setup SSE if this is a new request (not a continuation)
	if cont == nil {
		if err := sseHandler.SetupSSE(); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to setup SSE: %w", err)
		}
	}

	// Stream processing
	stopReason, assistantMsg, err := processCompletionsStream(ctx, resp.Body, sseHandler, chatOpts)
	if err != nil {
		return nil, nil, nil, err
	}

	return stopReason, []*CompletionsChatMessage{assistantMsg}, nil, nil
}

func processCompletionsStream(
	ctx context.Context,
	body io.Reader,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
) (*uctypes.WaveStopReason, *CompletionsChatMessage, error) {
	decoder := eventsource.NewDecoder(body)
	var textBuilder strings.Builder
	msgID := uuid.New().String()
	textID := uuid.New().String()
	var finishReason string
	textStarted := false
	var toolCallsInProgress []ToolCall

	_ = sseHandler.AiMsgStart(msgID)
	_ = sseHandler.AiMsgStartStep()

	for {
		if err := ctx.Err(); err != nil {
			_ = sseHandler.AiMsgError("request cancelled")
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindCanceled,
				ErrorType: "cancelled",
				ErrorText: "request cancelled",
			}, nil, err
		}

		event, err := decoder.Decode()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			_ = sseHandler.AiMsgError(err.Error())
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream",
				ErrorText: err.Error(),
			}, nil, fmt.Errorf("stream decode error: %w", err)
		}

		data := event.Data()
		if data == "[DONE]" {
			break
		}

		var chunk StreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			log.Printf("openaicomp: failed to parse chunk: %v\n", err)
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		choice := chunk.Choices[0]
		if choice.Delta.Content != "" {
			if !textStarted {
				_ = sseHandler.AiMsgTextStart(textID)
				textStarted = true
			}
			textBuilder.WriteString(choice.Delta.Content)
			_ = sseHandler.AiMsgTextDelta(textID, choice.Delta.Content)
		}

		if len(choice.Delta.ToolCalls) > 0 {
			for _, tcDelta := range choice.Delta.ToolCalls {
				idx := tcDelta.Index
				for len(toolCallsInProgress) <= idx {
					toolCallsInProgress = append(toolCallsInProgress, ToolCall{})
				}

				tc := &toolCallsInProgress[idx]
				if tcDelta.ID != "" {
					tc.ID = tcDelta.ID
				}
				if tcDelta.Type != "" {
					tc.Type = tcDelta.Type
				}
				if tcDelta.Function != nil {
					if tcDelta.Function.Name != "" {
						tc.Function.Name = tcDelta.Function.Name
					}
					if tcDelta.Function.Arguments != "" {
						tc.Function.Arguments += tcDelta.Function.Arguments
					}
				}
			}
		}

		if choice.FinishReason != nil && *choice.FinishReason != "" {
			finishReason = *choice.FinishReason
		}
	}

	stopKind := uctypes.StopKindDone
	if finishReason == "length" {
		stopKind = uctypes.StopKindMaxTokens
	} else if finishReason == "tool_calls" {
		stopKind = uctypes.StopKindToolUse
	}

	var waveToolCalls []uctypes.WaveToolCall
	if len(toolCallsInProgress) > 0 {
		for _, tc := range toolCallsInProgress {
			var inputJSON any
			if tc.Function.Arguments != "" {
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &inputJSON); err != nil {
					log.Printf("openaicomp: failed to parse tool call arguments: %v\n", err)
					continue
				}
			}
			waveToolCalls = append(waveToolCalls, uctypes.WaveToolCall{
				ID:    tc.ID,
				Name:  tc.Function.Name,
				Input: inputJSON,
			})
		}
	}

	stopReason := &uctypes.WaveStopReason{
		Kind:      stopKind,
		RawReason: finishReason,
		ToolCalls: waveToolCalls,
	}

	assistantMsg := &CompletionsChatMessage{
		MessageId: msgID,
		Message: CompletionsMessage{
			Role:      "assistant",
			Content:   textBuilder.String(),
			ToolCalls: toolCallsInProgress,
		},
	}

	if textStarted {
		_ = sseHandler.AiMsgTextEnd(textID)
	}
	_ = sseHandler.AiMsgFinishStep()
	_ = sseHandler.AiMsgFinish(finishReason, nil)

	return stopReason, assistantMsg, nil
}
