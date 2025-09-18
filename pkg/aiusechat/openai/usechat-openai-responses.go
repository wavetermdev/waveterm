// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/openai/openai-go/v2"
	"github.com/openai/openai-go/v2/option"
	"github.com/openai/openai-go/v2/responses"
	"github.com/openai/openai-go/v2/shared"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

func createOpenAIRequest(opts *uctypes.AIOptsType, messages []uctypes.UseChatMessage, tools []uctypes.ToolDefinition) (openai.Client, responses.ResponseNewParams) {
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

	// Convert tools if provided
	if len(tools) > 0 {
		var responseTools []responses.ToolUnionParam
		for _, tool := range tools {
			responseTool := responses.ToolParamOfFunction(tool.Name, tool.InputSchema, false)
			responseTools = append(responseTools, responseTool)
		}
		req.Tools = responseTools
	}

	// Only set reasoning parameter for reasoning models
	if isReasoningModel(opts.Model) {
		req.Reasoning = shared.ReasoningParam{
			Effort:  openai.ReasoningEffortMedium,
			Summary: openai.ReasoningSummaryAuto,
		}
	}

	if opts.MaxTokens > 0 {
		req.MaxOutputTokens = openai.Int(int64(opts.MaxTokens))
	}

	return client, req
}

func StreamOpenAIResponsesAPI(sseHandler *sse.SSEHandlerCh, ctx context.Context, opts *uctypes.AIOptsType, messages []uctypes.UseChatMessage, tools []uctypes.ToolDefinition) {
	client, req := createOpenAIRequest(opts, messages, tools)

	// Create stream using Responses API
	stream := client.Responses.NewStreaming(ctx, req)
	defer stream.Close()

	// Generate IDs for the streaming protocol
	messageId := uuid.New().String()
	textId := uuid.New().String()
	reasoningId := uuid.New().String()

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

		fmt.Printf("DEBUG: Received event type: %s\n", event.Type)

		switch event.Type {
		case "response.output_item.added":
			outputItem := event.AsResponseOutputItemAdded()
			// fmt.Printf("DEBUG: output_item.added - Type: %s\n", outputItem.Item.Type)
			if outputItem.Item.Type == "reasoning" && !reasoningStarted {
				sseHandler.AiMsgReasoningStart(reasoningId)
				reasoningStarted = true
			}

		case "response.reasoning_summary_part.added":
			// Optional; first empty part—no-op

		case "response.reasoning_summary_text.delta":
			reasoningDelta := event.AsResponseReasoningSummaryTextDelta()
			fmt.Printf("DEBUG: reasoning delta - reasoningEnded=%t, delta='%s'\n", reasoningEnded, reasoningDelta.Delta)
			if reasoningDelta.Delta != "" && !reasoningEnded {
				sseHandler.AiMsgReasoningDelta(reasoningId, reasoningDelta.Delta)
			}

		case "response.reasoning_summary_text.done":
			fmt.Printf("DEBUG: reasoning summary text done - reasoningStarted=%t, reasoningEnded=%t (not ending here, waiting for output_item.done)\n", reasoningStarted, reasoningEnded)
			// Don't end reasoning here - there may be multiple reasoning parts
			// Wait for response.output_item.done to end reasoning

		case "response.reasoning_summary_part.done":
			// Reasoning summary part done - no action needed

		case "response.content_part.added":
			// First output_text part for message—no-op

		case "response.content_part.done":
			// Content part done - no action needed

		case "response.output_text.delta":
			textDelta := event.AsResponseOutputTextDelta()
			if textDelta.Delta != "" && !textEnded {
				if !textStarted {
					sseHandler.AiMsgTextStart(textId)
					textStarted = true
				}
				sseHandler.AiMsgTextDelta(textId, textDelta.Delta)
			}

		case "response.output_text.done":
			if textStarted && !textEnded {
				sseHandler.AiMsgTextEnd(textId)
				textEnded = true
			}

		case "response.output_item.done":
			// Item-level close (reasoning or message)
			// If we had started reasoning but haven't ended it, end it now
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

		default:
			// Log unhandled event types in dev mode
			if wavebase.IsDevMode() {
				fmt.Printf("DEBUG: Unhandled event type: %s\n", event.Type)
			}
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
