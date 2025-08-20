// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

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

type UseChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type UseChatRequest struct {
	Messages []UseChatMessage `json:"messages"`
	Options  map[string]any   `json:"options,omitempty"`
}

type UseChatTextResponse struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type UseChatFinishResponse struct {
	Type         string                `json:"type"`
	FinishReason string                `json:"finish_reason"`
	Usage        *UseChatUsageResponse `json:"usage,omitempty"`
}

type UseChatUsageResponse struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type UseChatErrorResponse struct {
	Type  string `json:"type"`
	Error string `json:"error"`
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
		if preset, ok := fullConfig.Presets[fmt.Sprintf("ai@%s", finalPreset)]; ok {
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
		prompt = append(prompt, wshrpc.WaveAIPromptMessageType{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}
	return prompt
}

func streamOpenAIToUseChat(w http.ResponseWriter, ctx context.Context, opts *wshrpc.WaveAIOptsType, messages []UseChatMessage) {
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

	// Convert messages
	var openaiMessages []openaiapi.ChatCompletionMessage
	for _, msg := range messages {
		openaiMessages = append(openaiMessages, openaiapi.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
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
		writeUseChatError(w, fmt.Sprintf("OpenAI API error: %v", err))
		return
	}
	defer stream.Close()

	// Stream responses
	for {
		response, err := stream.Recv()
		if err == io.EOF {
			writeUseChatDone(w)
			return
		}
		if err != nil {
			writeUseChatError(w, fmt.Sprintf("Stream error: %v", err))
			return
		}

		// Process choices
		for _, choice := range response.Choices {
			if choice.Delta.Content != "" {
				writeUseChatText(w, choice.Delta.Content)
			}
			if choice.FinishReason != "" {
				usage := &UseChatUsageResponse{}
				if response.Usage.PromptTokens > 0 {
					usage.PromptTokens = response.Usage.PromptTokens
					usage.CompletionTokens = response.Usage.CompletionTokens
					usage.TotalTokens = response.Usage.TotalTokens
				}
				writeUseChatFinish(w, string(choice.FinishReason), usage)
			}
		}

		// Flush the response
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
}

func writeUseChatText(w http.ResponseWriter, text string) {
	resp := UseChatTextResponse{
		Type: "text",
		Text: text,
	}
	data, _ := json.Marshal(resp)
	fmt.Fprintf(w, "data: %s\n\n", data)
}

func writeUseChatFinish(w http.ResponseWriter, finishReason string, usage *UseChatUsageResponse) {
	resp := UseChatFinishResponse{
		Type:         "finish",
		FinishReason: finishReason,
		Usage:        usage,
	}
	data, _ := json.Marshal(resp)
	fmt.Fprintf(w, "data: %s\n\n", data)
}

func writeUseChatError(w http.ResponseWriter, errorMsg string) {
	resp := UseChatErrorResponse{
		Type:  "error",
		Error: errorMsg,
	}
	data, _ := json.Marshal(resp)
	fmt.Fprintf(w, "data: %s\n\n", data)
	writeUseChatDone(w)
}

func writeUseChatDone(w http.ResponseWriter) {
	fmt.Fprintf(w, "data: [DONE]\n\n")
}

func HandleAIChat(w http.ResponseWriter, r *http.Request) {
	// Handle CORS preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Parse query parameters
	blockId := r.URL.Query().Get("blockid")
	presetKey := r.URL.Query().Get("preset")

	if blockId == "" {
		http.Error(w, "blockid query parameter is required", http.StatusBadRequest)
		return
	}

	// Parse request body
	var req UseChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Resolve AI configuration
	aiOpts, err := resolveAIConfig(r.Context(), blockId, presetKey, req.Options)
	if err != nil {
		http.Error(w, fmt.Sprintf("Configuration error: %v", err), http.StatusBadRequest)
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

	// Set SSE headers
	w.Header().Set("Content-Type", UseChatContentTypeSSE)
	w.Header().Set("Cache-Control", UseChatCacheControl)
	w.Header().Set("Connection", UseChatConnection)

	// Stream OpenAI response
	streamOpenAIToUseChat(w, r.Context(), aiOpts, req.Messages)
}
