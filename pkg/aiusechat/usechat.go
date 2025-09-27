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
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	APIType_Anthropic = "anthropic"
	APIType_OpenAI    = "openai"
)

const DefaultAPI = APIType_OpenAI
const DefaultAnthropicModel = "claude-sonnet-4-20250514"
const DefaultAIEndpoint = "https://cfapi.waveterm.dev/api/waveai"
const DefaultMaxTokens = 4 * 1024
const DefaultOpenAIModel = "gpt-5-mini"

var SystemPromptText = strings.Join([]string{
	`You are Wave AI, an intelligent assistant embedded within Wave Terminal, a modern terminal application with graphical widgets.`,
	`You appear as a pull-out panel on the left side of a tab, with the tab's widgets laid out on the right.`,
	`Widget context is provided as informationa only.`,
	`Do NOT assume any API access or ability to interact with the widgets except via tools provided (note that some widgets may expose NO tools, so their context is informational only).`,
}, " ")

var SystemPromptText_OpenAI = strings.Join([]string{
	`You are Wave AI, an intelligent assistant embedded within Wave Terminal, a modern terminal application with graphical widgets.`,
	`You appear as a pull-out panel on the left side of a tab, with the tab's widgets laid out on the right.`,
	`If tools are provided, those are the *only* tools you have access to.`,
	`Do not claim any abilities beyond what the tools provide. NEVER make up fake data and present it as real.`,
	`If the user enables context, you may see information about widgets and applications showing in the UI.`,
	`Do not assume any ability to interact with those widgets (reading content, executing commands, taking screenshots) unless those abilities are clearly detailed in a provided tool.`,
	`Note that some widgets may expose NO tools, so their provided context is informational only.`,
	`You have NO API access to the widgets or to Wave unless provided with an explicit tool.`,
}, " ")

func getWaveAISettings() (*uctypes.AIOptsType, error) {
	baseUrl := DefaultAIEndpoint
	if os.Getenv("WAVETERM_WAVEAI_ENDPOINT") != "" {
		baseUrl = os.Getenv("WAVETERM_WAVEAI_ENDPOINT")
	}
	if DefaultAPI == APIType_Anthropic {
		return &uctypes.AIOptsType{
			APIType:       APIType_Anthropic,
			Model:         DefaultAnthropicModel,
			MaxTokens:     DefaultMaxTokens,
			ThinkingLevel: uctypes.ThinkingLevelMedium,
			BaseURL:       baseUrl,
		}, nil
	} else {
		return &uctypes.AIOptsType{
			APIType:       APIType_OpenAI,
			Model:         DefaultOpenAIModel,
			MaxTokens:     DefaultMaxTokens,
			ThinkingLevel: uctypes.ThinkingLevelLow,
			BaseURL:       baseUrl,
		}, nil
	}
}

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for older models: gpt-3.5-*, gpt-4, gpt-4-turbo, o1-*
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4" ||
		strings.HasPrefix(m, "o1-")
}

func runAIChatStep(ctx context.Context, sseHandler *sse.SSEHandlerCh, chatOpts uctypes.WaveChatOpts, cont *uctypes.WaveContinueResponse) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, error) {
	if chatOpts.Config.APIType == APIType_Anthropic {
		stopReason, msg, err := anthropic.RunAnthropicChatStep(ctx, sseHandler, chatOpts, cont)
		return stopReason, []uctypes.GenAIMessage{msg}, err
	}
	if chatOpts.Config.APIType == APIType_OpenAI {
		if shouldUseChatCompletionsAPI(chatOpts.Config.Model) {
			return nil, nil, fmt.Errorf("Chat completions API not available (must use newer OpenAI models)")
		}
		stopReason, msgs, err := openai.RunOpenAIChatStep(ctx, sseHandler, chatOpts, cont)
		var messages []uctypes.GenAIMessage
		for _, msg := range msgs {
			messages = append(messages, msg)
		}
		return stopReason, messages, err
	}
	return nil, nil, fmt.Errorf("Invalid APIType %q", chatOpts.Config.APIType)
}

func RunAIChat(ctx context.Context, sseHandler *sse.SSEHandlerCh, chatOpts uctypes.WaveChatOpts) error {
	log.Printf("RunAIChat\n")
	firstStep := true
	var cont *uctypes.WaveContinueResponse
	for {
		if chatOpts.TabStateGenerator != nil {
			tabState, tabTools, tabErr := chatOpts.TabStateGenerator()
			if tabErr == nil {
				chatOpts.TabState = tabState
				chatOpts.TabTools = tabTools
			}
		}
		stopReason, rtnMessage, err := runAIChatStep(ctx, sseHandler, chatOpts, cont)
		if firstStep && err != nil {
			return fmt.Errorf("failed to stream %s chat: %w", chatOpts.Config.APIType, err)
		}
		if err != nil {
			_ = sseHandler.AiMsgError(err.Error())
			_ = sseHandler.AiMsgFinish("", nil)
			break
		}
		for _, msg := range rtnMessage {
			if msg != nil {
				chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg)
			}
		}
		if stopReason != nil && stopReason.Kind == uctypes.StopKindToolUse {
			var toolResults []uctypes.AIToolResult
			for _, toolCall := range stopReason.ToolCalls {
				inputJSON, _ := json.Marshal(toolCall.Input)
				log.Printf("TOOLUSE name=%s id=%s input=%s\n", toolCall.Name, toolCall.ID, string(inputJSON))
				result := ResolveToolCall(toolCall, chatOpts)
				toolResults = append(toolResults, result)
				if result.ErrorText != "" {
					log.Printf("  error=%s\n", result.ErrorText)
				} else {
					log.Printf("  result=%s\n", result.Text)
				}
			}

			// Convert tool results to messages and post to chat store
			if chatOpts.Config.APIType == APIType_OpenAI {
				toolResultMsgs, err := openai.ConvertToolResultsToOpenAIChatMessage(toolResults)
				if err != nil {
					_ = sseHandler.AiMsgError(fmt.Sprintf("Failed to convert tool results to OpenAI messages: %v", err))
					_ = sseHandler.AiMsgFinish("", nil)
				} else {
					for _, msg := range toolResultMsgs {
						chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg)
					}
				}
			} else {
				toolResultMsg, err := anthropic.ConvertToolResultsToAnthropicChatMessage(toolResults)
				if err != nil {
					_ = sseHandler.AiMsgError(fmt.Sprintf("Failed to convert tool results to Anthropic message: %v", err))
					_ = sseHandler.AiMsgFinish("", nil)
				} else {
					chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, toolResultMsg)
				}
			}

			var messageID string
			if len(rtnMessage) > 0 && rtnMessage[0] != nil {
				messageID = rtnMessage[0].GetMessageId()
			}
			cont = &uctypes.WaveContinueResponse{
				MessageID:             messageID,
				Model:                 chatOpts.Config.Model,
				ContinueFromKind:      uctypes.StopKindToolUse,
				ContinueFromRawReason: stopReason.RawReason,
			}
			continue
		}
		break
	}
	return nil
}

// ResolveToolCall resolves a single tool call and returns an AIToolResult
func ResolveToolCall(toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts) (result uctypes.AIToolResult) {
	result = uctypes.AIToolResult{
		ToolName:  toolCall.Name,
		ToolUseID: toolCall.ID,
	}

	defer func() {
		if r := recover(); r != nil {
			result.ErrorText = fmt.Sprintf("panic in tool execution: %v", r)
			result.Text = ""
		}
	}()

	// Find the matching tool definition
	var toolDef *uctypes.ToolDefinition
	for _, tool := range chatOpts.Tools {
		if tool.Name == toolCall.Name {
			toolDef = &tool
			break
		}
	}
	if toolDef == nil {
		for _, tool := range chatOpts.TabTools {
			if tool.Name == toolCall.Name {
				toolDef = &tool
				break
			}
		}
	}

	if toolDef == nil {
		result.ErrorText = fmt.Sprintf("tool '%s' not found", toolCall.Name)
		return
	}

	// Try ToolTextCallback first, then ToolAnyCallback
	if toolDef.ToolTextCallback != nil {
		text, err := toolDef.ToolTextCallback(toolCall.Input)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			result.Text = text
		}
	} else if toolDef.ToolAnyCallback != nil {
		output, err := toolDef.ToolAnyCallback(toolCall.Input)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			// Marshal the result to JSON
			jsonBytes, marshalErr := json.Marshal(output)
			if marshalErr != nil {
				result.ErrorText = fmt.Sprintf("failed to marshal tool output: %v", marshalErr)
			} else {
				result.Text = string(jsonBytes)
			}
		}
	} else {
		result.ErrorText = fmt.Sprintf("tool '%s' has no callback functions", toolCall.Name)
	}

	return
}

func WaveAIPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, message *uctypes.AIMessage, chatOpts uctypes.WaveChatOpts) error {
	log.Printf("WaveAIPostMessageWrap\n")

	// Convert AIMessage to Anthropic chat message
	var convertedMessage uctypes.GenAIMessage
	if chatOpts.Config.APIType == APIType_Anthropic {
		var err error
		convertedMessage, err = anthropic.ConvertAIMessageToAnthropicChatMessage(*message)
		if err != nil {
			return fmt.Errorf("message conversion failed: %w", err)
		}
	} else if chatOpts.Config.APIType == APIType_OpenAI {
		var err error
		convertedMessage, err = openai.ConvertAIMessageToOpenAIChatMessage(*message)
		if err != nil {
			return fmt.Errorf("message conversion failed: %w", err)
		}
	} else {
		return fmt.Errorf("unsupported APIType %q", chatOpts.Config.APIType)
	}

	// Post message to chat store
	if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, convertedMessage); err != nil {
		return fmt.Errorf("failed to store message: %w", err)
	}

	return RunAIChat(ctx, sseHandler, chatOpts)
}

// PostMessageRequest represents the request body for posting a message
type PostMessageRequest struct {
	TabId        string            `json:"tabid"`
	ChatID       string            `json:"chatid"`
	Msg          uctypes.AIMessage `json:"msg"`
	WidgetAccess bool              `json:"widgetaccess,omitempty"`
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

	// Get WaveAI settings
	aiOpts, err := getWaveAISettings()
	if err != nil {
		http.Error(w, fmt.Sprintf("WaveAI configuration error: %v", err), http.StatusInternalServerError)
		return
	}

	// Get client ID from database
	client, err := wstore.DBGetSingleton[*waveobj.Client](r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get client: %v", err), http.StatusInternalServerError)
		return
	}

	// Call the core WaveAIPostMessage function
	chatOpts := uctypes.WaveChatOpts{
		ChatId:   req.ChatID,
		ClientId: client.OID,
		Config:   *aiOpts,
	}
	if chatOpts.Config.APIType == APIType_OpenAI {
		chatOpts.SystemPrompt = []string{SystemPromptText_OpenAI}
	} else {
		chatOpts.SystemPrompt = []string{SystemPromptText}
	}

	chatOpts.TabStateGenerator = func() (string, []uctypes.ToolDefinition, error) {
		return GenerateTabStateAndTools(r.Context(), req.TabId, req.WidgetAccess)
	}

	// Validate the message
	if err := req.Msg.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("Message validation failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Create SSE handler and set up streaming
	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	if err := WaveAIPostMessageWrap(r.Context(), sseHandler, &req.Msg, chatOpts); err != nil {
		http.Error(w, fmt.Sprintf("Failed to post message: %v", err), http.StatusInternalServerError)
		return
	}
}

func WaveAIGetChatHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow GET method
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get chatid from URL parameters
	chatID := r.URL.Query().Get("chatid")
	if chatID == "" {
		http.Error(w, "chatid parameter is required", http.StatusBadRequest)
		return
	}

	// Validate chatid is a UUID
	if _, err := uuid.Parse(chatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatID)
	if chat == nil {
		http.Error(w, "chat not found", http.StatusNotFound)
		return
	}

	// Set response headers for JSON
	w.Header().Set("Content-Type", "application/json")

	// Encode and return the chat
	if err := json.NewEncoder(w).Encode(chat); err != nil {
		http.Error(w, fmt.Sprintf("Failed to encode response: %v", err), http.StatusInternalServerError)
		return
	}
}
