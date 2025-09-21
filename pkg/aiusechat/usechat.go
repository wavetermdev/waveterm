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

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/anthropic"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const (
	APIType_Anthropic = "anthropic"
	APIType_OpenAI    = "openai"
)

const DefaultClaudeModel = "claude-sonnet-4-20250514"

func getWaveAISettings() (*uctypes.AIOptsType, error) {
	anthropicSecret := os.Getenv("WAVETERM_ANTHROPIC_SECRET")
	if anthropicSecret == "" {
		return nil, fmt.Errorf("no anthropic secret found")
	}
	return &uctypes.AIOptsType{
		APIToken:      anthropicSecret,
		Model:         DefaultClaudeModel,
		APIType:       APIType_Anthropic,
		MaxTokens:     4 * 1024,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
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

func RunWaveAIRequestStep(ctx context.Context, sseHandler *sse.SSEHandlerCh, aiOpts *uctypes.AIOptsType, req *uctypes.UseChatRequest, tools []uctypes.ToolDefinition, cont *uctypes.WaveContinueResponse) error {
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

func RunWaveAIRequest(ctx context.Context, sseHandler *sse.SSEHandlerCh, aiOpts *uctypes.AIOptsType, req *uctypes.UseChatRequest, tools []uctypes.ToolDefinition) error {
	return RunWaveAIRequestStep(ctx, sseHandler, aiOpts, req, tools, nil)
}

func WaveAIPostMessage(ctx context.Context, sseHandler *sse.SSEHandlerCh, aiOpts *uctypes.AIOptsType, chatID string, tools []uctypes.ToolDefinition) error {
	// Stream the Anthropic chat response
	_, rtnMessage, err := anthropic.StreamAnthropicChatStep(ctx, sseHandler, aiOpts, chatID, tools, nil)
	if err != nil {
		return fmt.Errorf("failed to stream anthropic chat: %w", err)
	}
	if rtnMessage != nil {
		chatstore.DefaultChatStore.PostMessage(chatID, aiOpts, rtnMessage)
	}
	return nil
}

func WaveAIPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, aiOpts *uctypes.AIOptsType, chatID string, message *uctypes.AIMessage, tools []uctypes.ToolDefinition) error {
	// Only support Anthropic for now
	if aiOpts.APIType != APIType_Anthropic {
		return fmt.Errorf("only Anthropic API type is supported, got: %s", aiOpts.APIType)
	}

	// Convert AIMessage to Anthropic chat message
	anthropicMsg, err := anthropic.ConvertAIMessageToAnthropicChatMessage(*message)
	if err != nil {
		return fmt.Errorf("message conversion failed: %w", err)
	}

	// Post message to chat store
	if err := chatstore.DefaultChatStore.PostMessage(chatID, aiOpts, anthropicMsg); err != nil {
		return fmt.Errorf("failed to store message: %w", err)
	}

	return WaveAIPostMessage(ctx, sseHandler, aiOpts, chatID, tools)
}

// PostMessageRequest represents the request body for posting a message
type PostMessageRequest struct {
	Msg    uctypes.AIMessage `json:"msg"`
	ChatID string            `json:"chatid"`
}

func WaveAIPostMessageHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow POST method
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req PostMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate chatid is present and is a UUID
	if req.ChatID == "" {
		http.Error(w, "chatid is required in request body", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.ChatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Validate the message
	if err := req.Msg.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("Message validation failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Get WaveAI settings
	aiOpts, err := getWaveAISettings()
	if err != nil {
		http.Error(w, fmt.Sprintf("WaveAI configuration error: %v", err), http.StatusInternalServerError)
		return
	}

	// Create SSE handler and set up streaming
	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	// Call the core WaveAIPostMessage function
	if err := WaveAIPostMessageWrap(r.Context(), sseHandler, aiOpts, req.ChatID, &req.Msg, nil); err != nil {
		http.Error(w, fmt.Sprintf("Failed to post message: %v", err), http.StatusInternalServerError)
		return
	}
}
