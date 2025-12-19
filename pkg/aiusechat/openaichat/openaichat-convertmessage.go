// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	OpenAIChatDefaultMaxTokens = 4096
)

// appendToLastUserMessage appends text to the last user message in the messages slice
func appendToLastUserMessage(messages []ChatRequestMessage, text string) {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			messages[i].Content += "\n\n" + text
			break
		}
	}
}

// convertToolDefinitions converts Wave ToolDefinitions to OpenAI format
// Only includes tools whose required capabilities are met
func convertToolDefinitions(waveTools []uctypes.ToolDefinition, capabilities []string) []ToolDefinition {
	if len(waveTools) == 0 {
		return nil
	}

	openaiTools := make([]ToolDefinition, 0, len(waveTools))
	for _, waveTool := range waveTools {
		if !waveTool.HasRequiredCapabilities(capabilities) {
			continue
		}
		openaiTool := ToolDefinition{
			Type: "function",
			Function: ToolFunctionDef{
				Name:        waveTool.Name,
				Description: waveTool.Description,
				Parameters:  waveTool.InputSchema,
			},
		}
		openaiTools = append(openaiTools, openaiTool)
	}
	return openaiTools
}

// buildChatHTTPRequest creates an HTTP request for the OpenAI chat completions API
func buildChatHTTPRequest(ctx context.Context, messages []ChatRequestMessage, chatOpts uctypes.WaveChatOpts) (*http.Request, error) {
	opts := chatOpts.Config

	// Model is required for all providers except azure-legacy (which uses deployment name in URL)
	if opts.Model == "" && opts.Provider != uctypes.AIProvider_AzureLegacy {
		return nil, errors.New("ai:model is required")
	}
	if opts.Endpoint == "" {
		return nil, errors.New("ai:endpoint is required")
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = OpenAIChatDefaultMaxTokens
	}

	finalMessages := messages
	if len(chatOpts.SystemPrompt) > 0 {
		systemMessage := ChatRequestMessage{
			Role:    "system",
			Content: strings.Join(chatOpts.SystemPrompt, "\n\n"),
		}
		finalMessages = append([]ChatRequestMessage{systemMessage}, messages...)
	}

	// injected data
	if chatOpts.TabState != "" {
		appendToLastUserMessage(finalMessages, chatOpts.TabState)
	}
	if chatOpts.PlatformInfo != "" {
		appendToLastUserMessage(finalMessages, "<PlatformInfo>\n"+chatOpts.PlatformInfo+"\n</PlatformInfo>")
	}

	reqBody := &ChatRequest{
		Messages: finalMessages,
		Stream:   true,
	}

	// Model is only added to request for non-azure-legacy providers
	if opts.Provider != uctypes.AIProvider_AzureLegacy {
		reqBody.Model = opts.Model
	}

	if aiutil.IsOpenAIReasoningModel(opts.Model) {
		reqBody.MaxCompletionTokens = maxTokens
	} else {
		reqBody.MaxTokens = maxTokens
	}

	// Add tool definitions if tools capability is available and tools exist
	var allTools []uctypes.ToolDefinition
	if opts.HasCapability(uctypes.AICapabilityTools) {
		allTools = append(allTools, chatOpts.Tools...)
		allTools = append(allTools, chatOpts.TabTools...)
		if len(allTools) > 0 {
			reqBody.Tools = convertToolDefinitions(allTools, opts.Capabilities)
		}
	}

	if wavebase.IsDevMode() {
		log.Printf("openaichat: model %s, messages: %d, tools: %d\n", opts.Model, len(messages), len(allTools))
	}

	buf, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, opts.Endpoint, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	// Azure OpenAI uses "api-key" header instead of "Authorization: Bearer"
	if opts.Provider == uctypes.AIProvider_Azure || opts.Provider == uctypes.AIProvider_AzureLegacy {
		req.Header.Set("api-key", opts.APIToken)
	} else {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
	}

	req.Header.Set("Accept", "text/event-stream")

	// Only send Wave-specific headers when using Wave provider
	if opts.Provider == uctypes.AIProvider_Wave {
		if chatOpts.ClientId != "" {
			req.Header.Set("X-Wave-ClientId", chatOpts.ClientId)
		}
		if chatOpts.ChatId != "" {
			req.Header.Set("X-Wave-ChatId", chatOpts.ChatId)
		}
		req.Header.Set("X-Wave-Version", wavebase.WaveVersion)
		req.Header.Set("X-Wave-APIType", uctypes.APIType_OpenAIChat)
		req.Header.Set("X-Wave-RequestType", chatOpts.GetWaveRequestType())
	}

	return req, nil
}

// ConvertAIMessageToStoredChatMessage converts an AIMessage to StoredChatMessage
// These messages are ALWAYS role "user"
func ConvertAIMessageToStoredChatMessage(aiMsg uctypes.AIMessage) (*StoredChatMessage, error) {
	if err := aiMsg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid AIMessage: %w", err)
	}

	var textBuilder strings.Builder
	firstText := true
	for _, part := range aiMsg.Parts {
		var partText string

		switch {
		case part.Type == uctypes.AIMessagePartTypeText:
			partText = part.Text

		case part.MimeType == "text/plain":
			textData, err := aiutil.ExtractTextData(part.Data, part.URL)
			if err != nil {
				log.Printf("openaichat: error extracting text data for %s: %v\n", part.FileName, err)
				continue
			}
			partText = aiutil.FormatAttachedTextFile(part.FileName, textData)

		case part.MimeType == "directory":
			if len(part.Data) == 0 {
				log.Printf("openaichat: directory listing part missing data for %s\n", part.FileName)
				continue
			}
			partText = aiutil.FormatAttachedDirectoryListing(part.FileName, string(part.Data))

		default:
			continue
		}

		if partText != "" {
			if !firstText {
				textBuilder.WriteString("\n\n")
			}
			textBuilder.WriteString(partText)
			firstText = false
		}
	}

	return &StoredChatMessage{
		MessageId: aiMsg.MessageId,
		Message: ChatRequestMessage{
			Role:    "user",
			Content: textBuilder.String(),
		},
	}, nil
}

// ConvertToolResultsToNativeChatMessage converts tool results to OpenAI tool messages
func ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	if len(toolResults) == 0 {
		return nil, nil
	}

	messages := make([]uctypes.GenAIMessage, 0, len(toolResults))
	for _, toolResult := range toolResults {
		var content string
		if toolResult.ErrorText != "" {
			content = fmt.Sprintf("Error: %s", toolResult.ErrorText)
		} else {
			content = toolResult.Text
		}

		msg := &StoredChatMessage{
			MessageId: toolResult.ToolUseID,
			Message: ChatRequestMessage{
				Role:       "tool",
				ToolCallID: toolResult.ToolUseID,
				Name:       toolResult.ToolName,
				Content:    content,
			},
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

// ConvertAIChatToUIChat converts stored chat to UI format
func ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	uiChat := &uctypes.UIChat{
		ChatId:     aiChat.ChatId,
		APIType:    aiChat.APIType,
		Model:      aiChat.Model,
		APIVersion: aiChat.APIVersion,
		Messages:   make([]uctypes.UIMessage, 0, len(aiChat.NativeMessages)),
	}

	for _, genMsg := range aiChat.NativeMessages {
		chatMsg, ok := genMsg.(*StoredChatMessage)
		if !ok {
			continue
		}

		var parts []uctypes.UIMessagePart

		// Add text content if present
		if chatMsg.Message.Content != "" {
			parts = append(parts, uctypes.UIMessagePart{
				Type: "text",
				Text: chatMsg.Message.Content,
			})
		}

		// Add tool calls if present (assistant requesting tool use)
		if len(chatMsg.Message.ToolCalls) > 0 {
			for _, toolCall := range chatMsg.Message.ToolCalls {
				if toolCall.Type != "function" {
					continue
				}

				// Only add if ToolUseData is available
				if toolCall.ToolUseData != nil {
					parts = append(parts, uctypes.UIMessagePart{
						Type: "data-tooluse",
						ID:   toolCall.ID,
						Data: *toolCall.ToolUseData,
					})
				}
			}
		}

		// Tool result messages (role "tool") are not converted to UIMessage
		if chatMsg.Message.Role == "tool" && chatMsg.Message.ToolCallID != "" {
			continue
		}

		// Skip messages with no parts
		if len(parts) == 0 {
			continue
		}

		uiMsg := uctypes.UIMessage{
			ID:    chatMsg.MessageId,
			Role:  chatMsg.Message.Role,
			Parts: parts,
		}

		uiChat.Messages = append(uiChat.Messages, uiMsg)
	}

	return uiChat, nil
}

// GetFunctionCallInputByToolCallId searches for a tool call by ID in the chat history
func GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	for _, genMsg := range aiChat.NativeMessages {
		chatMsg, ok := genMsg.(*StoredChatMessage)
		if !ok {
			continue
		}
		idx := chatMsg.Message.FindToolCallIndex(toolCallId)
		if idx == -1 {
			continue
		}
		toolCall := chatMsg.Message.ToolCalls[idx]
		return &uctypes.AIFunctionCallInput{
			CallId:      toolCall.ID,
			Name:        toolCall.Function.Name,
			Arguments:   toolCall.Function.Arguments,
			ToolUseData: toolCall.ToolUseData,
		}
	}
	return nil
}

// UpdateToolUseData updates the ToolUseData for a specific tool call in the chat history
func UpdateToolUseData(chatId string, callId string, newToolUseData uctypes.UIMessageDataToolUse) error {
	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return fmt.Errorf("chat not found: %s", chatId)
	}

	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*StoredChatMessage)
		if !ok {
			continue
		}
		idx := chatMsg.Message.FindToolCallIndex(callId)
		if idx == -1 {
			continue
		}
		updatedMsg := chatMsg.Copy()
		updatedMsg.Message.ToolCalls[idx].ToolUseData = &newToolUseData
		aiOpts := &uctypes.AIOptsType{
			APIType:    chat.APIType,
			Model:      chat.Model,
			APIVersion: chat.APIVersion,
		}
		return chatstore.DefaultChatStore.PostMessage(chatId, aiOpts, updatedMsg)
	}

	return fmt.Errorf("tool call with callId %s not found in chat %s", callId, chatId)
}

func RemoveToolUseCall(chatId string, callId string) error {
	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return fmt.Errorf("chat not found: %s", chatId)
	}

	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*StoredChatMessage)
		if !ok {
			continue
		}
		idx := chatMsg.Message.FindToolCallIndex(callId)
		if idx == -1 {
			continue
		}
		updatedMsg := chatMsg.Copy()
		updatedMsg.Message.ToolCalls = slices.Delete(updatedMsg.Message.ToolCalls, idx, idx+1)
		if len(updatedMsg.Message.ToolCalls) == 0 {
			chatstore.DefaultChatStore.RemoveMessage(chatId, chatMsg.MessageId)
		} else {
			aiOpts := &uctypes.AIOptsType{
				APIType:    chat.APIType,
				Model:      chat.Model,
				APIVersion: chat.APIVersion,
			}
			if err := chatstore.DefaultChatStore.PostMessage(chatId, aiOpts, updatedMsg); err != nil {
				return err
			}
		}
		return nil
	}

	return nil
}
