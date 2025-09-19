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
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// OpenAI Chat Completion streaming response format
type OpenAIStreamChoice struct {
	Index int `json:"index"`
	Delta struct {
		Content   string `json:"content,omitempty"`
		Reasoning string `json:"reasoning,omitempty"`
	} `json:"delta"`
	FinishReason *string `json:"finish_reason"`
}

type OpenAIStreamResponse struct {
	ID      string               `json:"id"`
	Object  string               `json:"object"`
	Created int64                `json:"created"`
	Model   string               `json:"model"`
	Choices []OpenAIStreamChoice `json:"choices"`
	Usage   *OpenAIUsageResponse `json:"usage,omitempty"`
}

type OpenAIUsageResponse struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

func StreamOpenAIChatCompletions(sseHandler *sse.SSEHandlerCh, ctx context.Context, opts *uctypes.AIOptsType, messages []uctypes.UIMessage) {
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

	// Convert messages to ChatCompletionMessageParam, filtering out empty content
	var chatMessages []openai.ChatCompletionMessageParamUnion
	for _, msg := range messages {
		content := msg.GetContent()
		// Skip messages with empty content as OpenAI requires non-empty content
		if strings.TrimSpace(content) == "" {
			continue
		}

		// Create appropriate message based on role
		switch msg.Role {
		case "user":
			chatMessages = append(chatMessages, openai.UserMessage(content))
		case "assistant":
			chatMessages = append(chatMessages, openai.AssistantMessage(content))
		case "system":
			chatMessages = append(chatMessages, openai.SystemMessage(content))
		default:
			chatMessages = append(chatMessages, openai.UserMessage(content))
		}
	}

	// Create request using Chat Completions API
	req := openai.ChatCompletionNewParams{
		Model:    opts.Model,
		Messages: chatMessages,
	}

	if opts.MaxTokens > 0 {
		if isReasoningModel(opts.Model) {
			req.MaxCompletionTokens = openai.Int(int64(opts.MaxTokens))
		} else {
			req.MaxTokens = openai.Int(int64(opts.MaxTokens))
		}
	}

	// Create stream using Chat Completions API
	stream := client.Chat.Completions.NewStreaming(ctx, req)
	defer stream.Close()

	// Generate IDs for the streaming protocol
	messageId := uuid.New().String()
	textId := uuid.New().String()

	// Send message start
	sseHandler.AiMsgStart(messageId)

	// Track whether we've started text streaming and finished
	textStarted := false
	textEnded := false
	finished := false

	// Stream responses using event-based API
	for stream.Next() {
		chunk := stream.Current()

		if len(chunk.Choices) > 0 {
			choice := chunk.Choices[0]

			// Handle content delta
			if choice.Delta.Content != "" {
				// Send text start only when we have actual content
				if !textStarted {
					sseHandler.AiMsgTextStart(textId)
					textStarted = true
				}
				sseHandler.AiMsgTextDelta(textId, choice.Delta.Content)
			}

			// Handle finish reason
			if choice.FinishReason != "" && !finished {
				usage := &OpenAIUsageResponse{}
				if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 {
					usage.PromptTokens = int(chunk.Usage.PromptTokens)
					usage.CompletionTokens = int(chunk.Usage.CompletionTokens)
					usage.TotalTokens = int(chunk.Usage.TotalTokens)
				}

				// End text if it was started but not ended
				if textStarted && !textEnded {
					sseHandler.AiMsgTextEnd(textId)
					textEnded = true
				}

				sseHandler.AiMsgFinish(choice.FinishReason, usage)
				finished = true
				return
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
		// End text if it was started but not ended
		if textStarted && !textEnded {
			sseHandler.AiMsgTextEnd(textId)
			textEnded = true
		}
		sseHandler.AiMsgFinish("stop", nil)
	}
}
