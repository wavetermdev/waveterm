// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/anthropic"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaicomp"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// UseChatBackend defines the interface for AI chat backend providers (OpenAI, Anthropic, etc.)
// This interface abstracts the provider-specific API calls needed by the usechat system.
type UseChatBackend interface {
	// RunChatStep executes a single step in the chat conversation with the AI backend.
	// Returns the stop reason, native messages from the response, rate limit info, and any error.
	// The cont parameter allows continuing from a previous response (e.g., after rate limiting).
	RunChatStep(
		ctx context.Context,
		sseHandler *sse.SSEHandlerCh,
		chatOpts uctypes.WaveChatOpts,
		cont *uctypes.WaveContinueResponse,
	) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error)

	// UpdateToolUseData updates the tool use data for a specific tool call in the chat.
	// This is used to update the UI state for tool execution (approval status, results, etc.)
	UpdateToolUseData(chatId string, toolCallId string, toolUseData *uctypes.UIMessageDataToolUse) error

	// ConvertToolResultsToNativeChatMessage converts tool execution results into native chat messages
	// that can be sent back to the AI backend. Returns a slice of messages (some backends may
	// require multiple messages per tool result).
	ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error)

	// ConvertAIMessageToNativeChatMessage converts a generic AIMessage (from the user)
	// into the backend's native message format for sending to the API.
	ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error)

	// GetFunctionCallInputByToolCallId retrieves the function call input data for a specific
	// tool call ID from the chat history. Returns the function call structure
	// or nil if not found.
	GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput

	// ConvertAIChatToUIChat converts a stored AIChat (with native backend messages) into
	// a UI-friendly UIChat format that can be displayed in the frontend.
	ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error)
}

// Compile-time interface checks
var _ UseChatBackend = (*openaiResponsesBackend)(nil)
var _ UseChatBackend = (*openaiCompletionsBackend)(nil)
var _ UseChatBackend = (*anthropicBackend)(nil)

// GetBackendByAPIType returns the appropriate UseChatBackend implementation for the given API type
func GetBackendByAPIType(apiType string) (UseChatBackend, error) {
	switch apiType {
	case APIType_OpenAI:
		return &openaiResponsesBackend{}, nil
	case APIType_OpenAIComp:
		return &openaiCompletionsBackend{}, nil
	case APIType_Anthropic:
		return &anthropicBackend{}, nil
	default:
		return nil, fmt.Errorf("unsupported API type: %s", apiType)
	}
}

// openaiResponsesBackend implements UseChatBackend for OpenAI API
type openaiResponsesBackend struct{}

func (b *openaiResponsesBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	stopReason, msgs, rateLimitInfo, err := openai.RunOpenAIChatStep(ctx, sseHandler, chatOpts, cont)
	var genMsgs []uctypes.GenAIMessage
	for _, msg := range msgs {
		genMsgs = append(genMsgs, msg)
	}
	return stopReason, genMsgs, rateLimitInfo, err
}

func (b *openaiResponsesBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData *uctypes.UIMessageDataToolUse) error {
	return openai.UpdateToolUseData(chatId, toolCallId, toolUseData)
}

func (b *openaiResponsesBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage(toolResults)
	if err != nil {
		return nil, err
	}
	var genMsgs []uctypes.GenAIMessage
	for _, msg := range msgs {
		genMsgs = append(genMsgs, msg)
	}
	return genMsgs, nil
}

func (b *openaiResponsesBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	return openai.ConvertAIMessageToOpenAIChatMessage(message)
}

func (b *openaiResponsesBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	openaiInput := openai.GetFunctionCallInputByToolCallId(aiChat, toolCallId)
	if openaiInput == nil {
		return nil
	}
	return &uctypes.AIFunctionCallInput{
		CallId:      openaiInput.CallId,
		Name:        openaiInput.Name,
		Arguments:   openaiInput.Arguments,
		ToolUseData: openaiInput.ToolUseData,
	}
}

func (b *openaiResponsesBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return openai.ConvertAIChatToUIChat(aiChat)
}

// openaiCompletionsBackend implements UseChatBackend for OpenAI Completions API
type openaiCompletionsBackend struct{}

func (b *openaiCompletionsBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	stopReason, msgs, rateLimitInfo, err := openaicomp.RunCompletionsChatStep(ctx, sseHandler, chatOpts, cont)
	var genMsgs []uctypes.GenAIMessage
	for _, msg := range msgs {
		genMsgs = append(genMsgs, msg)
	}
	return stopReason, genMsgs, rateLimitInfo, err
}

func (b *openaiCompletionsBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData *uctypes.UIMessageDataToolUse) error {
	return fmt.Errorf("tools not supported in openai-comp backend")
}

func (b *openaiCompletionsBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return openaicomp.ConvertToolResultsToNativeChatMessage(toolResults)
}

func (b *openaiCompletionsBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	return openaicomp.ConvertAIMessageToCompletionsMessage(message)
}

func (b *openaiCompletionsBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return nil
}

func (b *openaiCompletionsBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return openaicomp.ConvertAIChatToUIChat(aiChat)
}

// anthropicBackend implements UseChatBackend for Anthropic API
type anthropicBackend struct{}

func (b *anthropicBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	stopReason, msg, rateLimitInfo, err := anthropic.RunAnthropicChatStep(ctx, sseHandler, chatOpts, cont)
	return stopReason, []uctypes.GenAIMessage{msg}, rateLimitInfo, err
}

func (b *anthropicBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData *uctypes.UIMessageDataToolUse) error {
	return fmt.Errorf("UpdateToolUseData not implemented for anthropic backend")
}

func (b *anthropicBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	msg, err := anthropic.ConvertToolResultsToAnthropicChatMessage(toolResults)
	if err != nil {
		return nil, err
	}
	return []uctypes.GenAIMessage{msg}, nil
}

func (b *anthropicBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	return anthropic.ConvertAIMessageToAnthropicChatMessage(message)
}

func (b *anthropicBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return nil
}

func (b *anthropicBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return anthropic.ConvertAIChatToUIChat(aiChat)
}
