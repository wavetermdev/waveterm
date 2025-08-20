// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// see /aiprompts/usechat-streamingproto.md for protocol

type UseChatMessagePart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type UseChatMessage struct {
	Role    string               `json:"role"`
	Content string               `json:"content,omitempty"`
	Parts   []UseChatMessagePart `json:"parts,omitempty"`
}

// GetContent extracts the text content from either content field or parts array
func (m *UseChatMessage) GetContent() string {
	if m.Content != "" {
		return m.Content
	}
	if len(m.Parts) > 0 {
		var content strings.Builder
		for _, part := range m.Parts {
			if part.Type == "text" {
				content.WriteString(part.Text)
			}
		}
		return content.String()
	}
	return ""
}

type UseChatRequest struct {
	Messages []UseChatMessage        `json:"messages"`
	Options  *wconfig.AiSettingsType `json:"options,omitempty"`
}

// OpenAI Chat Completion streaming response format
type OpenAIStreamChoice struct {
	Index int `json:"index"`
	Delta struct {
		Content string `json:"content,omitempty"`
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

func resolveAIConfig(ctx context.Context, blockId, presetKey string, requestOptions *wconfig.AiSettingsType) (*wshrpc.WaveAIOptsType, error) {
	// Get block metadata
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("failed to get block: %v", err)
	}

	// Get global settings
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	globalAiSettings := fullConfig.Settings.GetAiSettings()

	// Resolve preset hierarchy
	finalPreset := presetKey
	if finalPreset == "" && block != nil && block.Meta != nil {
		if blockPreset, ok := block.Meta["ai:preset"].(string); ok {
			finalPreset = blockPreset
		}
	}
	if finalPreset == "" {
		finalPreset = globalAiSettings.AiPreset
	}
	if finalPreset == "" {
		finalPreset = "default"
	}

	// Load preset configuration
	var presetAiSettings *wconfig.AiSettingsType
	if finalPreset != "default" {
		var presetKey string
		if strings.HasPrefix(finalPreset, "ai@") {
			presetKey = finalPreset
		} else {
			presetKey = fmt.Sprintf("ai@%s", finalPreset)
		}
		if preset, ok := fullConfig.Presets[presetKey]; ok {
			presetAiSettings = &wconfig.AiSettingsType{}
			if err := json.Unmarshal(mustMarshal(preset), presetAiSettings); err == nil {
				// Successfully unmarshaled preset
			} else {
				presetAiSettings = nil
			}
		}
	}

	// Extract block AI settings from metadata
	var blockAiSettings *wconfig.AiSettingsType
	if block != nil && block.Meta != nil {
		blockAiSettings = &wconfig.AiSettingsType{}
		if err := json.Unmarshal(mustMarshal(block.Meta), blockAiSettings); err != nil {
			blockAiSettings = nil
		}
	}

	// Merge settings with hierarchy: global < preset < block < request
	finalSettings := wconfig.MergeAiSettings(globalAiSettings, presetAiSettings, blockAiSettings, requestOptions)

	// Convert to WaveAIOptsType
	aiOpts := &wshrpc.WaveAIOptsType{
		Model:      finalSettings.AiModel,
		APIType:    finalSettings.AiApiType,
		APIToken:   finalSettings.AiApiToken,
		BaseURL:    finalSettings.AiBaseURL,
		OrgID:      finalSettings.AiOrgID,
		APIVersion: finalSettings.AIApiVersion,
		ProxyURL:   finalSettings.AiProxyUrl,
		MaxTokens:  int(finalSettings.AiMaxTokens),
		TimeoutMs:  int(finalSettings.AiTimeoutMs),
	}

	// Set defaults
	if aiOpts.Model == "" {
		aiOpts.Model = "gpt-4.1"
	}
	if aiOpts.APIType == "" {
		aiOpts.APIType = APIType_OpenAI
	}
	if aiOpts.MaxTokens == 0 {
		aiOpts.MaxTokens = 4000
	}

	return aiOpts, nil
}

func mustMarshal(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return data
}

func streamOpenAIToUseChat(sseHandler *SSEHandlerCh, ctx context.Context, opts *wshrpc.WaveAIOptsType, messages []UseChatMessage) {

	// Set up OpenAI client
	clientConfig := openaiapi.DefaultConfig(opts.APIToken)
	if opts.BaseURL != "" {
		clientConfig.BaseURL = opts.BaseURL
	}
	if opts.OrgID != "" {
		clientConfig.OrgID = opts.OrgID
	}
	if opts.APIVersion != "" {
		clientConfig.APIVersion = opts.APIVersion
	}

	client := openaiapi.NewClientWithConfig(clientConfig)

	// Convert messages, filtering out empty content
	var openaiMessages []openaiapi.ChatCompletionMessage
	for _, msg := range messages {
		content := msg.GetContent()
		// Skip messages with empty content as OpenAI requires non-empty content
		if strings.TrimSpace(content) == "" {
			continue
		}
		openaiMessages = append(openaiMessages, openaiapi.ChatCompletionMessage{
			Role:    msg.Role,
			Content: content,
		})
	}

	// Create request
	req := openaiapi.ChatCompletionRequest{
		Model:    opts.Model,
		Messages: openaiMessages,
		Stream:   true,
	}

	if opts.MaxTokens > 0 {
		if isReasoningModel(opts.Model) {
			req.MaxCompletionTokens = opts.MaxTokens
		} else {
			req.MaxTokens = opts.MaxTokens
		}
	}

	// Create stream
	stream, err := client.CreateChatCompletionStream(ctx, req)
	if err != nil {
		sseHandler.WriteError(fmt.Sprintf("OpenAI API error: %v", err))
		return
	}
	defer stream.Close()

	// Generate IDs for the streaming protocol - use shorter, simpler IDs
	messageId := generateID()
	textId := generateID()

	// Send message start
	writeMessageStart(sseHandler, messageId)

	// Track whether we've started text streaming and finished
	textStarted := false
	textEnded := false
	finished := false

	// Stream responses
	for {
		response, err := stream.Recv()
		if err == io.EOF {
			// Send text end and finish if text was started but not ended, and we haven't finished yet
			if textStarted && !textEnded {
				writeTextEnd(sseHandler, textId)
				textEnded = true
			}
			if !finished {
				writeOpenAIFinish(sseHandler, "stop", nil)
			}
			return
		}
		if err != nil {
			sseHandler.WriteError(fmt.Sprintf("Stream error: %v", err))
			return
		}

		// Process choices
		for _, choice := range response.Choices {
			if choice.Delta.Content != "" {
				// Send text start only when we have actual content
				if !textStarted {
					writeTextStart(sseHandler, textId)
					textStarted = true
				}
				writeUseChatTextDelta(sseHandler, textId, choice.Delta.Content)
			}
			if choice.FinishReason != "" && !finished {
				usage := &OpenAIUsageResponse{}
				if response.Usage != nil && response.Usage.PromptTokens > 0 {
					usage.PromptTokens = response.Usage.PromptTokens
					usage.CompletionTokens = response.Usage.CompletionTokens
					usage.TotalTokens = response.Usage.TotalTokens
				}
				if textStarted && !textEnded {
					writeTextEnd(sseHandler, textId)
					textEnded = true
				}
				writeOpenAIFinish(sseHandler, string(choice.FinishReason), usage)
				finished = true
			}
		}
	}
}

func writeMessageStart(sseHandler *SSEHandlerCh, messageId string) {
	resp := map[string]interface{}{
		"type":      "start",
		"messageId": messageId,
	}
	sseHandler.WriteJsonData(resp)
}

func writeTextStart(sseHandler *SSEHandlerCh, textId string) {
	resp := map[string]interface{}{
		"type": "text-start",
		"id":   textId,
	}
	sseHandler.WriteJsonData(resp)
}

func writeUseChatTextDelta(sseHandler *SSEHandlerCh, textId string, text string) {
	resp := map[string]interface{}{
		"type":  "text-delta",
		"id":    textId,
		"delta": text,
	}
	sseHandler.WriteJsonData(resp)
}

func writeTextEnd(sseHandler *SSEHandlerCh, textId string) {
	resp := map[string]interface{}{
		"type": "text-end",
		"id":   textId,
	}
	sseHandler.WriteJsonData(resp)
}

func writeOpenAIFinish(sseHandler *SSEHandlerCh, finishReason string, usage *OpenAIUsageResponse) {
	resp := map[string]interface{}{
		"type": "finish",
	}
	sseHandler.WriteJsonData(resp)
}

func generateID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func HandleAIChat(w http.ResponseWriter, r *http.Request) {
	// Handle CORS preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Parse query parameters first
	blockId := r.URL.Query().Get("blockid")
	presetKey := r.URL.Query().Get("preset")

	if blockId == "" {
		http.Error(w, "blockid query parameter is required", http.StatusBadRequest)
		return
	}

	// Parse request body completely before sending any response
	var req UseChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Resolve AI configuration
	aiOpts, err := resolveAIConfig(r.Context(), blockId, presetKey, req.Options)
	if err != nil {
		http.Error(w, fmt.Sprintf("Configuration error: %v", err), http.StatusInternalServerError)
		return
	}

	// Validate configuration
	if aiOpts.Model == "" {
		http.Error(w, "No AI model specified", http.StatusBadRequest)
		return
	}
	log.Printf("using AI model: %s (%s)", aiOpts.Model, aiOpts.BaseURL)

	// For now, only support OpenAI
	if aiOpts.APIType != APIType_OpenAI && aiOpts.APIType != "" {
		http.Error(w, fmt.Sprintf("Unsupported API type: %s (only OpenAI supported in POC)", aiOpts.APIType), http.StatusBadRequest)
		return
	}

	if aiOpts.APIToken == "" {
		http.Error(w, "No API token provided", http.StatusBadRequest)
		return
	}

	// Create SSE handler and set up streaming
	sseHandler := MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	if err := sseHandler.SetupSSE(); err != nil {
		http.Error(w, fmt.Sprintf("Failed to setup SSE: %v", err), http.StatusInternalServerError)
		return
	}

	// Stream OpenAI response
	streamOpenAIToUseChat(sseHandler, r.Context(), aiOpts, req.Messages)
}
