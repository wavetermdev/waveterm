// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaicomp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	OpenAICompDefaultMaxTokens = 4096
)

// appendToLastUserMessage appends text to the last user message in the messages slice
func appendToLastUserMessage(messages []CompletionsMessage, text string) {
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

// buildCompletionsHTTPRequest creates an HTTP request for the OpenAI completions API
func buildCompletionsHTTPRequest(ctx context.Context, messages []CompletionsMessage, chatOpts uctypes.WaveChatOpts) (*http.Request, error) {
	opts := chatOpts.Config

	if opts.Model == "" {
		return nil, errors.New("opts.model is required")
	}
	if opts.BaseURL == "" {
		return nil, errors.New("BaseURL is required")
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = OpenAICompDefaultMaxTokens
	}

	finalMessages := messages
	if len(chatOpts.SystemPrompt) > 0 {
		systemMessage := CompletionsMessage{
			Role:    "system",
			Content: strings.Join(chatOpts.SystemPrompt, "\n\n"),
		}
		finalMessages = append([]CompletionsMessage{systemMessage}, messages...)
	}

	// injected data
	if chatOpts.TabState != "" {
		appendToLastUserMessage(finalMessages, chatOpts.TabState)
	}
	if chatOpts.PlatformInfo != "" {
		appendToLastUserMessage(finalMessages, "<PlatformInfo>\n"+chatOpts.PlatformInfo+"\n</PlatformInfo>")
	}

	reqBody := &CompletionsRequest{
		Model:    opts.Model,
		Messages: finalMessages,
		Stream:   true,
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
		log.Printf("openaicomp: model %s, messages: %d, tools: %d\n", opts.Model, len(messages), len(allTools))
	}

	buf, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, opts.BaseURL, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	if opts.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
	}
	req.Header.Set("Accept", "text/event-stream")
	if chatOpts.ClientId != "" {
		req.Header.Set("X-Wave-ClientId", chatOpts.ClientId)
	}
	if chatOpts.ChatId != "" {
		req.Header.Set("X-Wave-ChatId", chatOpts.ChatId)
	}
	req.Header.Set("X-Wave-Version", wavebase.WaveVersion)
	req.Header.Set("X-Wave-APIType", uctypes.APIType_OpenAIChat)
	req.Header.Set("X-Wave-RequestType", chatOpts.GetWaveRequestType())

	return req, nil
}

// ConvertAIMessageToCompletionsMessage converts an AIMessage to CompletionsChatMessage
// These messages are ALWAYS role "user"
func ConvertAIMessageToCompletionsMessage(aiMsg uctypes.AIMessage) (*CompletionsChatMessage, error) {
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
				log.Printf("openaicomp: error extracting text data for %s: %v\n", part.FileName, err)
				continue
			}
			partText = aiutil.FormatAttachedTextFile(part.FileName, textData)

		case part.MimeType == "directory":
			if len(part.Data) == 0 {
				log.Printf("openaicomp: directory listing part missing data for %s\n", part.FileName)
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

	return &CompletionsChatMessage{
		MessageId: aiMsg.MessageId,
		Message: CompletionsMessage{
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

		msg := &CompletionsChatMessage{
			MessageId: toolResult.ToolUseID,
			Message: CompletionsMessage{
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
		compMsg, ok := genMsg.(*CompletionsChatMessage)
		if !ok {
			continue
		}

		var parts []uctypes.UIMessagePart

		// Add text content if present
		if compMsg.Message.Content != "" {
			parts = append(parts, uctypes.UIMessagePart{
				Type: "text",
				Text: compMsg.Message.Content,
			})
		}

		// Add tool calls if present (assistant requesting tool use)
		if len(compMsg.Message.ToolCalls) > 0 {
			for _, toolCall := range compMsg.Message.ToolCalls {
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
		if compMsg.Message.Role == "tool" && compMsg.Message.ToolCallID != "" {
			continue
		}

		// Skip messages with no parts
		if len(parts) == 0 {
			continue
		}

		uiMsg := uctypes.UIMessage{
			ID:    compMsg.MessageId,
			Role:  compMsg.Message.Role,
			Parts: parts,
		}

		uiChat.Messages = append(uiChat.Messages, uiMsg)
	}

	return uiChat, nil
}

// GetFunctionCallInputByToolCallId searches for a tool call by ID in the chat history
func GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	for _, genMsg := range aiChat.NativeMessages {
		compMsg, ok := genMsg.(*CompletionsChatMessage)
		if !ok {
			continue
		}
		idx := compMsg.Message.FindToolCallIndex(toolCallId)
		if idx == -1 {
			continue
		}
		toolCall := compMsg.Message.ToolCalls[idx]
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
		compMsg, ok := genMsg.(*CompletionsChatMessage)
		if !ok {
			continue
		}
		idx := compMsg.Message.FindToolCallIndex(callId)
		if idx == -1 {
			continue
		}
		updatedMsg := compMsg.Copy()
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
