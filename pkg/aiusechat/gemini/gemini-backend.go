// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gemini

import (
	"bufio"
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
	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const (
	GeminiStreamingEndpointTemplate = "https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent?alt=sse&key=%s"
)

// UpdateToolUseData updates the tool use data for a specific tool call in the chat
func UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return fmt.Errorf("chat not found: %s", chatId)
	}

	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*GeminiChatMessage)
		if !ok {
			continue
		}

		for i, part := range chatMsg.Parts {
			if part.FunctionCall != nil && part.ToolUseData != nil && part.ToolUseData.ToolCallId == toolCallId {
				// Update the message with new tool use data
				updatedMsg := &GeminiChatMessage{
					MessageId: chatMsg.MessageId,
					Role:      chatMsg.Role,
					Parts:     make([]GeminiMessagePart, len(chatMsg.Parts)),
					Usage:     chatMsg.Usage,
				}
				copy(updatedMsg.Parts, chatMsg.Parts)
				updatedMsg.Parts[i].ToolUseData = &toolUseData

				aiOpts := &uctypes.AIOptsType{
					APIType:    chat.APIType,
					Model:      chat.Model,
					APIVersion: chat.APIVersion,
				}

				return chatstore.DefaultChatStore.PostMessage(chatId, aiOpts, updatedMsg)
			}
		}
	}

	return fmt.Errorf("tool call with ID %s not found in chat %s", toolCallId, chatId)
}

// buildGeminiHTTPRequest creates an HTTP request for the Gemini API
func buildGeminiHTTPRequest(ctx context.Context, contents []GeminiContent, chatOpts uctypes.WaveChatOpts) (*http.Request, error) {
	opts := chatOpts.Config

	if opts.Model == "" {
		return nil, errors.New("opts.model is required")
	}
	if opts.APIToken == "" {
		return nil, errors.New("API token is required")
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = GeminiDefaultMaxTokens
	}

	// Build request body
	reqBody := &GeminiRequest{
		Contents: contents,
		GenerationConfig: &GeminiGenerationConfig{
			MaxOutputTokens: int32(maxTokens),
			Temperature:     0.7, // Default temperature
		},
	}

	// Add system instruction if provided
	if len(chatOpts.SystemPrompt) > 0 {
		systemText := strings.Join(chatOpts.SystemPrompt, "\n\n")
		reqBody.SystemInstruction = &GeminiContent{
			Parts: []GeminiMessagePart{
				{Text: systemText},
			},
		}
	}

	// Add tools if provided
	var allTools []uctypes.ToolDefinition
	allTools = append(allTools, chatOpts.Tools...)
	allTools = append(allTools, chatOpts.TabTools...)

	if len(allTools) > 0 {
		var functionDeclarations []GeminiFunctionDeclaration
		for _, tool := range allTools {
			// Only include tools whose capabilities are met
			if !tool.HasRequiredCapabilities(opts.Capabilities) {
				continue
			}
			functionDeclarations = append(functionDeclarations, ConvertToolDefinitionToGemini(tool))
		}
		if len(functionDeclarations) > 0 {
			reqBody.Tools = []GeminiTool{
				{FunctionDeclarations: functionDeclarations},
			}
			reqBody.ToolConfig = &GeminiToolConfig{
				FunctionCallingConfig: &GeminiFunctionCallingConfig{
					Mode: "AUTO",
				},
			}
		}
	}

	// Injected data - append to last user message
	if chatOpts.TabState != "" || chatOpts.PlatformInfo != "" || chatOpts.AppStaticFiles != "" || chatOpts.AppGoFile != "" {
		for i := len(reqBody.Contents) - 1; i >= 0; i-- {
			if reqBody.Contents[i].Role == "user" {
				var additionalText strings.Builder
				if chatOpts.TabState != "" {
					additionalText.WriteString("\n\n")
					additionalText.WriteString(chatOpts.TabState)
				}
				if chatOpts.PlatformInfo != "" {
					additionalText.WriteString("\n\n<PlatformInfo>\n")
					additionalText.WriteString(chatOpts.PlatformInfo)
					additionalText.WriteString("\n</PlatformInfo>")
				}
				if chatOpts.AppStaticFiles != "" {
					additionalText.WriteString("\n\n<CurrentAppStaticFiles>\n")
					additionalText.WriteString(chatOpts.AppStaticFiles)
					additionalText.WriteString("\n</CurrentAppStaticFiles>")
				}
				if chatOpts.AppGoFile != "" {
					additionalText.WriteString("\n\n<CurrentAppGoFile>\n")
					additionalText.WriteString(chatOpts.AppGoFile)
					additionalText.WriteString("\n</CurrentAppGoFile>")
				}

				if additionalText.Len() > 0 {
					reqBody.Contents[i].Parts = append(reqBody.Contents[i].Parts, GeminiMessagePart{
						Text: additionalText.String(),
					})
				}
				break
			}
		}
	}

	if wavebase.IsDevMode() {
		var toolNames []string
		for _, tool := range allTools {
			toolNames = append(toolNames, tool.Name)
		}
		log.Printf("gemini: model %s, messages: %d, tools: %s\n", opts.Model, len(contents), strings.Join(toolNames, ","))
	}

	// Encode request body
	buf, err := aiutil.JsonEncodeRequestBody(reqBody)
	if err != nil {
		return nil, err
	}

	// Build URL with API key
	endpoint := fmt.Sprintf(GeminiStreamingEndpointTemplate, opts.Model, opts.APIToken)
	if opts.BaseURL != "" {
		// If custom base URL is provided, use it instead
		endpoint = opts.BaseURL
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return nil, err
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")

	return req, nil
}

// RunGeminiChatStep executes a chat step using the Gemini API
func RunGeminiChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, *GeminiChatMessage, *uctypes.RateLimitInfo, error) {
	if sseHandler == nil {
		return nil, nil, nil, errors.New("sse handler is nil")
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	// Validate that chatOpts.Config match the chat's stored configuration
	if chat.APIType != chatOpts.Config.APIType {
		return nil, nil, nil, fmt.Errorf("API type mismatch: chat has %s, chatOpts has %s", chat.APIType, chatOpts.Config.APIType)
	}
	if chat.Model != chatOpts.Config.Model {
		return nil, nil, nil, fmt.Errorf("model mismatch: chat has %s, chatOpts has %s", chat.Model, chatOpts.Config.Model)
	}

	// Context with timeout if provided
	if chatOpts.Config.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(chatOpts.Config.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	// Convert GenAIMessages to Gemini contents
	var contents []GeminiContent
	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*GeminiChatMessage)
		if !ok {
			return nil, nil, nil, fmt.Errorf("expected GeminiChatMessage, got %T", genMsg)
		}

		content := GeminiContent{
			Role:  chatMsg.Role,
			Parts: make([]GeminiMessagePart, len(chatMsg.Parts)),
		}
		for i, part := range chatMsg.Parts {
			content.Parts[i] = *part.Clean()
		}
		contents = append(contents, content)
	}

	req, err := buildGeminiHTTPRequest(ctx, contents, chatOpts)
	if err != nil {
		return nil, nil, nil, err
	}

	httpClient := &http.Client{
		Timeout: 0, // rely on ctx; streaming can be long
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)

		// Try to parse as Gemini error
		var geminiErr GeminiErrorResponse
		if err := json.Unmarshal(bodyBytes, &geminiErr); err == nil && geminiErr.Error != nil {
			return nil, nil, nil, fmt.Errorf("Gemini API error (%d): %s", geminiErr.Error.Code, geminiErr.Error.Message)
		}

		return nil, nil, nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, utilfn.TruncateString(string(bodyBytes), 120))
	}

	// Setup SSE if this is a new request (not a continuation)
	if cont == nil {
		if err := sseHandler.SetupSSE(); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to setup SSE: %w", err)
		}
	}

	// Stream processing
	stopReason, assistantMsg, err := processGeminiStream(ctx, resp.Body, sseHandler, chatOpts, cont)
	if err != nil {
		return nil, nil, nil, err
	}

	return stopReason, assistantMsg, nil, nil
}

// processGeminiStream handles the streaming response from Gemini
func processGeminiStream(
	ctx context.Context,
	body io.Reader,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, *GeminiChatMessage, error) {
	msgID := uuid.New().String()
	textID := uuid.New().String()
	textStarted := false
	var textBuilder strings.Builder
	var finishReason string
	var functionCalls []GeminiMessagePart
	var usageMetadata *GeminiUsageMetadata

	if cont == nil {
		_ = sseHandler.AiMsgStart(msgID)
	}
	_ = sseHandler.AiMsgStartStep()

	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			_ = sseHandler.AiMsgError("request cancelled")
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindCanceled,
				ErrorType: "cancelled",
				ErrorText: "request cancelled",
			}, nil, err
		}

		line := scanner.Text()
		line = strings.TrimSpace(line)

		// Skip empty lines and "data:" prefix
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}

		// Remove "data: " prefix
		jsonData := strings.TrimPrefix(line, "data:")
		jsonData = strings.TrimSpace(jsonData)

		// Parse the JSON response
		var chunk GeminiStreamResponse
		if err := json.Unmarshal([]byte(jsonData), &chunk); err != nil {
			log.Printf("gemini: failed to parse chunk: %v\n", err)
			continue
		}

		// Check for prompt feedback (blocking)
		if chunk.PromptFeedback != nil && chunk.PromptFeedback.BlockReason != "" {
			errorMsg := fmt.Sprintf("Content blocked: %s", chunk.PromptFeedback.BlockReason)
			_ = sseHandler.AiMsgError(errorMsg)
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindContent,
				ErrorType: "blocked",
				ErrorText: errorMsg,
			}, nil, fmt.Errorf("%s", errorMsg)
		}

		// Store usage metadata if present
		if chunk.UsageMetadata != nil {
			usageMetadata = chunk.UsageMetadata
		}

		// Process candidates
		if len(chunk.Candidates) == 0 {
			continue
		}

		candidate := chunk.Candidates[0]

		// Store finish reason
		if candidate.FinishReason != "" {
			finishReason = candidate.FinishReason
		}

		if candidate.Content == nil {
			continue
		}

		// Process content parts
		for _, part := range candidate.Content.Parts {
			if part.Text != "" {
				if !textStarted {
					_ = sseHandler.AiMsgTextStart(textID)
					textStarted = true
				}
				textBuilder.WriteString(part.Text)
				_ = sseHandler.AiMsgTextDelta(textID, part.Text)
			}

			if part.FunctionCall != nil {
				// Track function call for tool use
				toolCallId := uuid.New().String()

				// Send tool progress using aiutil
				argsBytes, _ := json.Marshal(part.FunctionCall.Args)
				aiutil.SendToolProgress(toolCallId, part.FunctionCall.Name, argsBytes, chatOpts, sseHandler, false)

				functionCalls = append(functionCalls, GeminiMessagePart{
					FunctionCall: part.FunctionCall,
					ToolUseData: &uctypes.UIMessageDataToolUse{
						ToolCallId: toolCallId,
						ToolName:   part.FunctionCall.Name,
					},
				})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		_ = sseHandler.AiMsgError(fmt.Sprintf("stream read error: %v", err))
		return &uctypes.WaveStopReason{
			Kind:      uctypes.StopKindError,
			ErrorType: "stream",
			ErrorText: err.Error(),
		}, nil, err
	}

	// Determine stop reason
	stopKind := uctypes.StopKindDone
	switch finishReason {
	case "MAX_TOKENS":
		stopKind = uctypes.StopKindMaxTokens
	case "SAFETY":
		stopKind = uctypes.StopKindContent
	case "RECITATION":
		stopKind = uctypes.StopKindContent
	}

	// Build assistant message
	var parts []GeminiMessagePart
	if textBuilder.Len() > 0 {
		parts = append(parts, GeminiMessagePart{
			Text: textBuilder.String(),
		})
	}
	parts = append(parts, functionCalls...)

	// Set usage metadata model
	if usageMetadata != nil {
		usageMetadata.Model = chatOpts.Config.Model
	}

	assistantMsg := &GeminiChatMessage{
		MessageId: msgID,
		Role:      "model",
		Parts:     parts,
		Usage:     usageMetadata,
	}

	// Build tool calls for stop reason
	var waveToolCalls []uctypes.WaveToolCall
	if len(functionCalls) > 0 {
		stopKind = uctypes.StopKindToolUse
		for _, fcPart := range functionCalls {
			if fcPart.FunctionCall != nil && fcPart.ToolUseData != nil {
				waveToolCalls = append(waveToolCalls, uctypes.WaveToolCall{
					ID:          fcPart.ToolUseData.ToolCallId,
					Name:        fcPart.FunctionCall.Name,
					Input:       fcPart.FunctionCall.Args,
					ToolUseData: fcPart.ToolUseData,
				})
			}
		}
	}

	stopReason := &uctypes.WaveStopReason{
		Kind:      stopKind,
		RawReason: finishReason,
		ToolCalls: waveToolCalls,
	}

	if textStarted {
		_ = sseHandler.AiMsgTextEnd(textID)
	}
	_ = sseHandler.AiMsgFinishStep()
	if stopKind != uctypes.StopKindToolUse {
		_ = sseHandler.AiMsgFinish(finishReason, nil)
	}

	return stopReason, assistantMsg, nil
}
