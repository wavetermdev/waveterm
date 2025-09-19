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
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/anthropic"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const (
	APIType_Anthropic = "anthropic"
	APIType_OpenAI    = "openai"
)

const DefaultClaudeModel = "claude-sonnet-4-20250514"

func getWaveAISettings() (*uctypes.WaveAIOptsType, error) {
	anthropicSecret := os.Getenv("WAVETERM_ANTHROPIC_SECRET")
	if anthropicSecret == "" {
		return nil, fmt.Errorf("no anthropic secret found")
	}
	return &uctypes.WaveAIOptsType{
		APIToken:  anthropicSecret,
		Model:     DefaultClaudeModel,
		APIType:   APIType_Anthropic,
		MaxTokens: 10 * 1024,
	}, nil
}

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for older models: gpt-3.5-*, gpt-4, gpt-4-turbo, o1-*
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4" ||
		strings.HasPrefix(m, "o1-")
}

func RunWaveAIRequestStep(ctx context.Context, sseHandler *sse.SSEHandlerCh, aiOpts *uctypes.WaveAIOptsType, req *uctypes.UseChatRequest, tools []uctypes.ToolDefinition, cont *uctypes.WaveContinueResponse) error {
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

	if cont != nil && aiOpts.Model != cont.Model {
		return fmt.Errorf("cannot continue with a different model, model:%q, cont-model:%q", aiOpts.Model, cont.Model)
	}

	log.Printf("using AI model: %s (%s)", aiOpts.Model, aiOpts.BaseURL)

	// Stream response based on API type
	if aiOpts.APIType == APIType_Anthropic {
		_, err := anthropic.StreamAnthropicResponses(ctx, sseHandler, aiOpts, req.Messages, tools, cont)
		if err != nil {
			return fmt.Errorf("anthropic streaming error: %v", err)
		}
		return nil
	} else if aiOpts.APIType == APIType_OpenAI {
		// Default to OpenAI
		// Route to appropriate API based on model
		if shouldUseChatCompletionsAPI(aiOpts.Model) {
			// Older models (gpt-3.5, gpt-4, gpt-4-turbo, o1-*) use Chat Completions API
			openai.StreamOpenAIChatCompletions(sseHandler, ctx, aiOpts, req.Messages)
		} else {
			// Newer models (gpt-4.1, gpt-4o, gpt-5, o3, o4, etc.) use Responses API for reasoning support
			openai.StreamOpenAIResponsesAPI(sseHandler, ctx, aiOpts, req.Messages, tools)
		}
		return nil
	}
	return fmt.Errorf("Unimplemented API Type %q", aiOpts.APIType)
}

func RunWaveAIRequest(ctx context.Context, sseHandler *sse.SSEHandlerCh, aiOpts *uctypes.WaveAIOptsType, req *uctypes.UseChatRequest, tools []uctypes.ToolDefinition) error {
	return RunWaveAIRequestStep(ctx, sseHandler, aiOpts, req, tools, nil)
}

func WaveAIHandler(w http.ResponseWriter, r *http.Request) {
	// Handle CORS preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Parse request body completely before sending any response
	var req uctypes.UseChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Use WaveAI settings
	aiOpts, err := getWaveAISettings()
	if err != nil {
		http.Error(w, fmt.Sprintf("WaveAI configuration error: %v", err), http.StatusBadRequest)
		return
	}

	// Create SSE handler and set up streaming
	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	// Run the AI request
	if err := RunWaveAIRequest(r.Context(), sseHandler, aiOpts, &req, nil); err != nil {
		http.Error(w, fmt.Sprintf("AI request error: %v", err), http.StatusInternalServerError)
		return
	}
}
