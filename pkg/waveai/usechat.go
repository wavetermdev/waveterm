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
	"net/http"
	"strings"

	openaiapi "github.com/sashabaranov/go-openai"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	UseChatContentTypeSSE = "text/event-stream"
	UseChatCacheControl   = "no-cache"
	UseChatConnection     = "keep-alive"
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
	Messages []UseChatMessage `json:"messages"`
	Options  map[string]any   `json:"options,omitempty"`
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

func resolveAIConfig(ctx context.Context, blockId, presetKey string, requestOptions map[string]any) (*wshrpc.WaveAIOptsType, error) {
	// Get block metadata
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("failed to get block: %v", err)
	}

	// Get global settings
	fullConfig := wconfig.GetWatcher().GetFullConfig()

	// Resolve preset hierarchy
	finalPreset := presetKey
	if finalPreset == "" && block != nil && block.Meta != nil {
		if blockPreset, ok := block.Meta["ai:preset"].(string); ok {
			finalPreset = blockPreset
		}
	}
	if finalPreset == "" {
		if globalPreset := fullConfig.Settings.AiPreset; globalPreset != "" {
			finalPreset = globalPreset
		}
	}
	if finalPreset == "" {
		finalPreset = "default"
	}

	// Load preset configuration
	var presetConfig map[string]any
	if finalPreset != "default" {
		// Check if preset already has ai@ prefix
		var presetKey string
		if strings.HasPrefix(finalPreset, "ai@") {
			presetKey = finalPreset
		} else {
			presetKey = fmt.Sprintf("ai@%s", finalPreset)
		}
		if preset, ok := fullConfig.Presets[presetKey]; ok {
			presetConfig = preset
		}
	}

	// Build AI options with hierarchy: global < preset < block < request
	aiOpts := &wshrpc.WaveAIOptsType{}

	// Helper function to get string value from hierarchy
	getString := func(key string) string {
		// Request options (highest priority)
		if val, ok := requestOptions[key]; ok {
			if str, ok := val.(string); ok {
				return str
			}
		}
		// Block metadata
		if block != nil && block.Meta != nil {
			if val, ok := block.Meta[key]; ok {
				if str, ok := val.(string); ok {
					return str
				}
			}
		}
		// Preset config
		if presetConfig != nil {
			if val, ok := presetConfig[key]; ok {
				if str, ok := val.(string); ok {
					return str
				}
			}
		}
		// Global settings - use struct fields
		switch key {
		case "ai:preset":
			return fullConfig.Settings.AiPreset
		case "ai:apitype":
			return fullConfig.Settings.AiApiType
		case "ai:apitoken":
			return fullConfig.Settings.AiApiToken
		case "ai:baseurl":
			return fullConfig.Settings.AiBaseURL
		case "ai:model":
			return fullConfig.Settings.AiModel
		case "ai:orgid":
			return fullConfig.Settings.AiOrgID
		case "ai:apiversion":
			return fullConfig.Settings.AIApiVersion
		case "ai:proxyurl":
			return fullConfig.Settings.AiProxyUrl
		}
		return ""
	}

	// Helper function to get int value from hierarchy
	getInt := func(key string) int {
		// Request options (highest priority)
		if val, ok := requestOptions[key]; ok {
			if num, ok := val.(float64); ok {
				return int(num)
			}
			if num, ok := val.(int); ok {
				return num
			}
		}
		// Block metadata
		if block != nil && block.Meta != nil {
			if val, ok := block.Meta[key]; ok {
				if num, ok := val.(float64); ok {
					return int(num)
				}
				if num, ok := val.(int); ok {
					return num
				}
			}
		}
		// Preset config
		if presetConfig != nil {
			if val, ok := presetConfig[key]; ok {
				if num, ok := val.(float64); ok {
					return int(num)
				}
				if num, ok := val.(int); ok {
					return num
				}
			}
		}
		// Global settings - use struct fields
		switch key {
		case "ai:maxtokens":
			return int(fullConfig.Settings.AiMaxTokens)
		case "ai:timeoutms":
			return int(fullConfig.Settings.AiTimeoutMs)
		}
		return 0
	}

	// Populate AI options
	aiOpts.Model = getString("ai:model")
	aiOpts.APIType = getString("ai:apitype")
	aiOpts.APIToken = getString("ai:apitoken")
	aiOpts.BaseURL = getString("ai:baseurl")
	aiOpts.OrgID = getString("ai:orgid")
	aiOpts.APIVersion = getString("ai:apiversion")
	aiOpts.ProxyURL = getString("ai:proxyurl")
	aiOpts.MaxTokens = getInt("ai:maxtokens")
	aiOpts.MaxChoices = getInt("ai:maxchoices")
	aiOpts.TimeoutMs = getInt("ai:timeoutms")

	// Set defaults
	if aiOpts.Model == "" {
		aiOpts.Model = "gpt-4"
	}
	if aiOpts.APIType == "" {
		aiOpts.APIType = APIType_OpenAI
	}
	if aiOpts.MaxTokens == 0 {
		aiOpts.MaxTokens = 4000
	}

	return aiOpts, nil
}

func convertUseChatMessagesToPrompt(messages []UseChatMessage) []wshrpc.WaveAIPromptMessageType {
	var prompt []wshrpc.WaveAIPromptMessageType
	for _, msg := range messages {
		content := msg.GetContent()
		if strings.TrimSpace(content) == "" {
			continue
		}
		prompt = append(prompt, wshrpc.WaveAIPromptMessageType{
			Role:    msg.Role,
			Content: content,
		})
	}
	return prompt
}

func streamOpenAIToUseChat(sseHandler *SSEHandler, ctx context.Context, opts *wshrpc.WaveAIOptsType, messages []UseChatMessage) {
	// Start keepalive
	sseHandler.StartKeepalive()
	defer sseHandler.StopKeepalive()

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

	// Track whether we've started text streaming
	textStarted := false
	textEnded := false

	// Stream responses
	for {
		response, err := stream.Recv()
		if err == io.EOF {
			// Send text end and finish if text was started but not ended
			if textStarted && !textEnded {
				writeTextEnd(sseHandler, textId)
				textEnded = true
			}
			writeOpenAIFinish(sseHandler, "stop", nil)
			sseHandler.WriteDone()
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
			if choice.FinishReason != "" {
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
			}
		}
	}
}

func writeMessageStart(sseHandler *SSEHandler, messageId string) {
	resp := map[string]interface{}{
		"type":      "start",
		"messageId": messageId,
	}
	sseHandler.WriteJsonData(resp)
}

func writeTextStart(sseHandler *SSEHandler, textId string) {
	resp := map[string]interface{}{
		"type": "text-start",
		"id":   textId,
	}
	sseHandler.WriteJsonData(resp)
}

func writeUseChatTextDelta(sseHandler *SSEHandler, textId string, text string) {
	resp := map[string]interface{}{
		"type":  "text-delta",
		"id":    textId,
		"delta": text,
	}
	sseHandler.WriteJsonData(resp)
}

func writeTextEnd(sseHandler *SSEHandler, textId string) {
	resp := map[string]interface{}{
		"type": "text-end",
		"id":   textId,
	}
	sseHandler.WriteJsonData(resp)
}

func writeOpenAIFinish(sseHandler *SSEHandler, finishReason string, usage *OpenAIUsageResponse) {
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
	sseHandler := MakeSSEHandler(w, r.Context())
	defer sseHandler.Close()

	if err := sseHandler.SetupSSE(); err != nil {
		http.Error(w, fmt.Sprintf("Failed to setup SSE: %v", err), http.StatusInternalServerError)
		return
	}

	// Stream OpenAI response
	streamOpenAIToUseChat(sseHandler, r.Context(), aiOpts, req.Messages)
}
