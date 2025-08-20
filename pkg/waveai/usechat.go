// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

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

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for older models: gpt-3.5-*, gpt-4, gpt-4-turbo, o1-*
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4" ||
		strings.HasPrefix(m, "o1-")
}

func streamOpenAIToUseChat(sseHandler *SSEHandlerCh, ctx context.Context, opts *wshrpc.WaveAIOptsType, messages []UseChatMessage) {
	// Route to appropriate API based on model
	if shouldUseChatCompletionsAPI(opts.Model) {
		// Older models (gpt-3.5, gpt-4, gpt-4-turbo, o1-*) use Chat Completions API
		streamOpenAIChatCompletions(sseHandler, ctx, opts, messages)
	} else {
		// Newer models (gpt-4.1, gpt-4o, gpt-5, o3, o4, etc.) use Responses API for reasoning support
		streamOpenAIResponsesAPI(sseHandler, ctx, opts, messages)
	}
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
