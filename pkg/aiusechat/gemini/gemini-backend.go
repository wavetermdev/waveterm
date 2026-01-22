// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gemini

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
	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// ensureAltSse ensures the ?alt=sse query parameter is set on the endpoint
func ensureAltSse(endpoint string) (string, error) {
	parsedURL, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid ai:endpoint URL: %w", err)
	}

	query := parsedURL.Query()
	if query.Get("alt") != "sse" {
		query.Set("alt", "sse")
		parsedURL.RawQuery = query.Encode()
		return parsedURL.String(), nil
	}

	return endpoint, nil
}

// appendPartToLastUserMessage appends a text part to the last user message in the contents slice
func appendPartToLastUserMessage(contents []GeminiContent, text string) {
	for i := len(contents) - 1; i >= 0; i-- {
		if contents[i].Role == "user" {
			contents[i].Parts = append(contents[i].Parts, GeminiMessagePart{
				Text: text,
			})
			break
		}
	}
}

// buildGeminiHTTPRequest creates an HTTP request for the Gemini API
func buildGeminiHTTPRequest(ctx context.Context, contents []GeminiContent, chatOpts uctypes.WaveChatOpts) (*http.Request, error) {
	opts := chatOpts.Config

	if opts.Model == "" {
		return nil, errors.New("ai:model is required")
	}
	if opts.APIToken == "" {
		return nil, errors.New("ai:apitoken is required")
	}
	if opts.Endpoint == "" {
		return nil, errors.New("ai:endpoint is required")
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

	// Map thinking level for Gemini 3+ models
	if opts.ThinkingLevel != "" && strings.Contains(opts.Model, "gemini-3") {
		geminiThinkingLevel := "high"
		if opts.ThinkingLevel == uctypes.ThinkingLevelLow {
			geminiThinkingLevel = "low"
		}
		reqBody.GenerationConfig.ThinkingConfig = &GeminiThinkingConfig{
			ThinkingLevel: geminiThinkingLevel,
		}
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

	// Injected data - append to last user message as separate parts
	if chatOpts.TabState != "" {
		appendPartToLastUserMessage(reqBody.Contents, chatOpts.TabState)
	}
	if chatOpts.PlatformInfo != "" {
		appendPartToLastUserMessage(reqBody.Contents, "<PlatformInfo>\n"+chatOpts.PlatformInfo+"\n</PlatformInfo>")
	}
	if chatOpts.AppStaticFiles != "" {
		appendPartToLastUserMessage(reqBody.Contents, "<CurrentAppStaticFiles>\n"+chatOpts.AppStaticFiles+"\n</CurrentAppStaticFiles>")
	}
	if chatOpts.AppGoFile != "" {
		appendPartToLastUserMessage(reqBody.Contents, "<CurrentAppGoFile>\n"+chatOpts.AppGoFile+"\n</CurrentAppGoFile>")
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

	// Build URL
	endpoint, err := ensureAltSse(opts.Endpoint)
	if err != nil {
		return nil, err
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return nil, err
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", opts.APIToken)

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
	var textThoughtSignature string
	var finishReason string
	var functionCalls []GeminiMessagePart
	var usageMetadata *GeminiUsageMetadata

	if cont == nil {
		_ = sseHandler.AiMsgStart(msgID)
	}
	_ = sseHandler.AiMsgStartStep()

	decoder := eventsource.NewDecoder(body)

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
			if sseHandler.Err() != nil {
				partialMsg := extractPartialGeminiMessage(msgID, textBuilder.String())
				return &uctypes.WaveStopReason{
					Kind:      uctypes.StopKindCanceled,
					ErrorType: "client_disconnect",
					ErrorText: "client disconnected",
				}, partialMsg, nil
			}
			_ = sseHandler.AiMsgError(fmt.Sprintf("stream decode error: %v", err))
			return &uctypes.WaveStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream",
				ErrorText: err.Error(),
			}, nil, fmt.Errorf("stream decode error: %w", err)
		}

		data := event.Data()
		if data == "" {
			continue
		}

		// Parse the JSON response
		var chunk GeminiStreamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
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

		// Log grounding metadata (web search queries)
		if chunk.GroundingMetadata != nil && len(chunk.GroundingMetadata.WebSearchQueries) > 0 {
			if wavebase.IsDevMode() {
				log.Printf("gemini: web search queries executed: %v\n", chunk.GroundingMetadata.WebSearchQueries)
			}
		}

		// Process candidates
		if len(chunk.Candidates) == 0 {
			continue
		}

		candidate := chunk.Candidates[0]

		// Log candidate grounding metadata if present
		if candidate.GroundingMetadata != nil && len(candidate.GroundingMetadata.WebSearchQueries) > 0 {
			if wavebase.IsDevMode() {
				log.Printf("gemini: candidate web search queries: %v\n", candidate.GroundingMetadata.WebSearchQueries)
			}
		}

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
				if part.ThoughtSignature != "" {
					textThoughtSignature = part.ThoughtSignature
				}
			}

			if part.FunctionCall != nil {
				toolCallId := uuid.New().String()

				argsBytes, _ := json.Marshal(part.FunctionCall.Args)
				aiutil.SendToolProgress(toolCallId, part.FunctionCall.Name, argsBytes, chatOpts, sseHandler, false)

				// Preserve thought_signature exactly as received from API
				// It can be at part level, FunctionCall level, or both
				functionCalls = append(functionCalls, GeminiMessagePart{
					FunctionCall:     part.FunctionCall,
					ThoughtSignature: part.ThoughtSignature,
					ToolUseData: &uctypes.UIMessageDataToolUse{
						ToolCallId: toolCallId,
						ToolName:   part.FunctionCall.Name,
					},
				})
			}
		}
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
			Text:             textBuilder.String(),
			ThoughtSignature: textThoughtSignature,
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

func extractPartialGeminiMessage(msgID string, text string) *GeminiChatMessage {
	if text == "" {
		return nil
	}

	return &GeminiChatMessage{
		MessageId: msgID,
		Role:      "model",
		Parts: []GeminiMessagePart{
			{
				Text: text,
			},
		},
	}
}
