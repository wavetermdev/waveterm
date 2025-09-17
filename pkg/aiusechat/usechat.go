// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const DefaultClaudeModel = "claude-sonnet-4-20250514"

func getWaveAISettings() (*wshrpc.WaveAIOptsType, error) {
	anthropicSecret := os.Getenv("WAVETERM_ANTHROPIC_SECRET")
	if anthropicSecret == "" {
		return nil, fmt.Errorf("no anthropic secret found")
	}
	return &wshrpc.WaveAIOptsType{
		APIToken:  anthropicSecret,
		Model:     DefaultClaudeModel,
		APIType:   APIType_Anthropic,
		MaxTokens: 10 * 1024,
	}, nil
}

func runWaveAIRequest(ctx context.Context, sseHandler *SSEHandlerCh, req *UseChatRequest) error {
	// Use WaveAI settings
	aiOpts, err := getWaveAISettings()
	if err != nil {
		return fmt.Errorf("WaveAI configuration error: %v", err)
	}

	// Validate configuration
	if aiOpts.Model == "" {
		return fmt.Errorf("no AI model specified")
	}

	// Support OpenAI and Anthropic
	if aiOpts.APIType != APIType_OpenAI && aiOpts.APIType != APIType_Anthropic && aiOpts.APIType != "" {
		return fmt.Errorf("unsupported API type: %s (only OpenAI and Anthropic supported)", aiOpts.APIType)
	}

	if aiOpts.APIToken == "" {
		return fmt.Errorf("no API token provided")
	}

	log.Printf("using AI model: %s (%s)", aiOpts.Model, aiOpts.BaseURL)

	// Stream response based on API type
	if aiOpts.APIType == APIType_Anthropic {
		// _, err := StreamAnthropicResponses(ctx, sseHandler, aiOpts, req.Messages, nil)
		// if err != nil {
		// 	return fmt.Errorf("anthropic streaming error: %v", err)
		// }
		return fmt.Errorf("Anthropic provider is unimplemented")
	} else if aiOpts.APIType == APIType_OpenAI {
		// Default to OpenAI
		// Route to appropriate API based on model
		if shouldUseChatCompletionsAPI(aiOpts.Model) {
			// Older models (gpt-3.5, gpt-4, gpt-4-turbo, o1-*) use Chat Completions API
			// StreamOpenAIChatCompletions(sseHandler, ctx, aiOpts, req.Messages)
		} else {
			// Newer models (gpt-4.1, gpt-4o, gpt-5, o3, o4, etc.) use Responses API for reasoning support
			// StreamOpenAIResponsesAPI(sseHandler, ctx, aiOpts, req.Messages, tools)
		}
		return fmt.Errorf("OpenAI provider is unimplemented")
	}
	return fmt.Errorf("Unimplemented API Type %q", aiOpts.APIType)
}

func WaveAIHandler(w http.ResponseWriter, r *http.Request) {
	// Handle CORS preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Parse request body completely before sending any response
	var req UseChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Create SSE handler and set up streaming
	sseHandler := MakeSSEHandlerCh(w, r.Context())

	// Run the AI request
	if err := runWaveAIRequest(r.Context(), sseHandler, &req); err != nil {
		http.Error(w, fmt.Sprintf("AI request error: %v", err), http.StatusInternalServerError)
		return
	}
}
