// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"fmt"
	"strings"

	"github.com/openai/openai-go/v2"
	"github.com/openai/openai-go/v2/option"
	"github.com/openai/openai-go/v2/responses"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func streamOpenAIResponsesAPI(sseHandler *SSEHandlerCh, ctx context.Context, opts *wshrpc.WaveAIOptsType, messages []UseChatMessage) {
	// Set up OpenAI client options
	clientOpts := []option.RequestOption{
		option.WithAPIKey(opts.APIToken),
	}

	if opts.BaseURL != "" {
		clientOpts = append(clientOpts, option.WithBaseURL(opts.BaseURL))
	}
	if opts.OrgID != "" {
		clientOpts = append(clientOpts, option.WithOrganization(opts.OrgID))
	}

	client := openai.NewClient(clientOpts...)

	// Convert messages to input items, filtering out empty content
	var inputItems []responses.ResponseInputItemUnionParam
	for _, msg := range messages {
		content := msg.GetContent()
		// Skip messages with empty content as OpenAI requires non-empty content
		if strings.TrimSpace(content) == "" {
			continue
		}

		// Convert role to EasyInputMessageRole
		var role responses.EasyInputMessageRole
		switch msg.Role {
		case "user":
			role = responses.EasyInputMessageRoleUser
		case "assistant":
			role = responses.EasyInputMessageRoleAssistant
		case "system":
			role = responses.EasyInputMessageRoleSystem
		default:
			role = responses.EasyInputMessageRoleUser
		}

		inputItems = append(inputItems, responses.ResponseInputItemParamOfMessage(content, role))
	}

	// Create request using Responses API for reasoning support
	req := responses.ResponseNewParams{
		Model: opts.Model,
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: responses.ResponseInputParam(inputItems),
		},
	}

	if opts.MaxTokens > 0 {
		req.MaxOutputTokens = openai.Int(int64(opts.MaxTokens))
	}

	// Create stream using Responses API
	stream := client.Responses.NewStreaming(ctx, req)
	defer stream.Close()

	// Generate IDs for the streaming protocol
	messageId := generateID()
	textId := generateID()
	reasoningId := generateID()

	// Send message start
	sseHandler.AiMsgStart(messageId)

	// Track whether we've started text/reasoning streaming and finished
	textStarted := false
	textEnded := false
	reasoningStarted := false
	reasoningEnded := false
	finished := false

	// Stream responses using event-based API
	for stream.Next() {
		event := stream.Current()

		switch event.Type {
		case "response.output_text.delta":
			textDelta := event.AsResponseOutputTextDelta()
			if textDelta.Delta != "" {
				// Send text start only when we have actual content
				if !textStarted {
					sseHandler.AiMsgTextStart(textId)
					textStarted = true
				}
				sseHandler.AiMsgTextDelta(textId, textDelta.Delta)
			}

		case "response.reasoning_text.delta":
			reasoningDelta := event.AsResponseReasoningTextDelta()
			if reasoningDelta.Delta != "" {
				// Send reasoning start only when we have actual reasoning content
				if !reasoningStarted {
					sseHandler.AiMsgReasoningStart(reasoningId)
					reasoningStarted = true
				}
				sseHandler.AiMsgReasoningDelta(reasoningId, reasoningDelta.Delta)
			}

		case "response.reasoning_text.done":
			// End reasoning when reasoning text is done
			if reasoningStarted && !reasoningEnded {
				sseHandler.AiMsgReasoningEnd(reasoningId)
				reasoningEnded = true
			}

		case "response.completed":
			responseDone := event.AsResponseCompleted()
			if !finished {
				usage := &OpenAIUsageResponse{}
				responseUsage := responseDone.Response.Usage
				usage.PromptTokens = int(responseUsage.InputTokens)
				usage.CompletionTokens = int(responseUsage.OutputTokens)
				usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens

				// End reasoning if it was started but not ended
				if reasoningStarted && !reasoningEnded {
					sseHandler.AiMsgReasoningEnd(reasoningId)
					reasoningEnded = true
				}
				// End text if it was started but not ended
				if textStarted && !textEnded {
					sseHandler.AiMsgTextEnd(textId)
					textEnded = true
				}

				finishReason := "stop"
				if responseDone.Response.Status == "completed" {
					finishReason = "stop"
				}

				sseHandler.AiMsgFinish(finishReason, usage)
				finished = true
			}
			return
		}
	}

	// Handle stream errors
	if err := stream.Err(); err != nil {
		sseHandler.WriteError(fmt.Sprintf("OpenAI API error: %v", err))
		return
	}

	// Cleanup if stream ended without completion event
	if !finished {
		// End reasoning if it was started but not ended
		if reasoningStarted && !reasoningEnded {
			sseHandler.AiMsgReasoningEnd(reasoningId)
			reasoningEnded = true
		}
		// End text if it was started but not ended
		if textStarted && !textEnded {
			sseHandler.AiMsgTextEnd(textId)
			textEnded = true
		}
		sseHandler.AiMsgFinish("stop", nil)
	}
}