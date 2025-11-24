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
			Content: strings.Join(chatOpts.SystemPrompt, "\n"),
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

	if wavebase.IsDevMode() {
		log.Printf("openaicomp: model %s, messages: %d\n", opts.Model, len(messages))
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
	req.Header.Set("X-Wave-APIType", "openai-comp")
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

		uiMsg := uctypes.UIMessage{
			ID:   compMsg.MessageId,
			Role: compMsg.Message.Role,
			Parts: []uctypes.UIMessagePart{
				{
					Type: "text",
					Text: compMsg.Message.Content,
				},
			},
		}

		uiChat.Messages = append(uiChat.Messages, uiMsg)
	}

	return uiChat, nil
}
