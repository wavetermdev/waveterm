// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	OpenAIDefaultBaseURL    = "https://api.openai.com/v1/responses"
	OpenAIDefaultAPIVersion = "2024-12-31"
	OpenAIDefaultMaxTokens  = 4096
)

// ---------- OpenAI Request Types ----------

type OpenAIMessage struct {
	Role    string                 `json:"role"`
	Content []OpenAIMessageContent `json:"content"`
}

type OpenAIMessageContent struct {
	Type string `json:"type"` // "input_text", "output_text"
	Text string `json:"text,omitempty"`
}

type StreamOptionsType struct {
	IncludeObfuscation bool `json:"include_obfuscation"`
}

type ReasoningType struct {
	Effort  string `json:"effort,omitempty"`  // "minimal", "low", "medium", "high"
	Summary string `json:"summary,omitempty"` // "auto", "concise", "detailed"
}

type TextType struct {
	Format    interface{} `json:"format,omitempty"`    // Format object, e.g. {"type": "text"}, {"type": "json_object"}, {"type": "json_schema"}
	Verbosity string      `json:"verbosity,omitempty"` // "low", "medium", "high"
}

type PromptType struct {
	ID        string                 `json:"id"`
	Variables map[string]interface{} `json:"variables,omitempty"`
	Version   string                 `json:"version,omitempty"`
}

type OpenAIRequest struct {
	Background         bool               `json:"background,omitempty"`
	Conversation       string             `json:"conversation,omitempty"`
	Include            []string           `json:"include,omitempty"`
	Input              []OpenAIMessage    `json:"input,omitempty"`
	Instructions       string             `json:"instructions,omitempty"`
	MaxOutputTokens    int                `json:"max_output_tokens,omitempty"`
	MaxToolCalls       int                `json:"max_tool_calls,omitempty"`
	Metadata           map[string]string  `json:"metadata,omitempty"`
	Model              string             `json:"model,omitempty"`
	ParallelToolCalls  bool               `json:"parallel_tool_calls,omitempty"`
	PreviousResponseID string             `json:"previous_response_id,omitempty"`
	Prompt             *PromptType        `json:"prompt,omitempty"`
	PromptCacheKey     string             `json:"prompt_cache_key,omitempty"`
	Reasoning          *ReasoningType     `json:"reasoning,omitempty"`
	SafetyIdentifier   string             `json:"safety_identifier,omitempty"`
	ServiceTier        string             `json:"service_tier,omitempty"` // "auto", "default", "flex", "priority"
	Store              bool               `json:"store,omitempty"`
	Stream             bool               `json:"stream,omitempty"`
	StreamOptions      *StreamOptionsType `json:"stream_options,omitempty"`
	Temperature        float64            `json:"temperature,omitempty"`
	Text               *TextType          `json:"text,omitempty"`
	ToolChoice         interface{}        `json:"tool_choice,omitempty"` // "none", "auto", "required", or object
	Tools              []interface{}      `json:"tools,omitempty"`
	TopLogprobs        int                `json:"top_logprobs,omitempty"`
	TopP               float64            `json:"top_p,omitempty"`
	Truncation         string             `json:"truncation,omitempty"` // "auto", "disabled"
}

// buildOpenAIHTTPRequest creates a complete HTTP request for the OpenAI API
func buildOpenAIHTTPRequest(ctx context.Context, msgs []OpenAIMessage, chatOpts uctypes.WaveChatOpts) (*http.Request, error) {
	opts := chatOpts.Config
	if opts.Model == "" {
		return nil, errors.New("opts.model is required")
	}

	// Set defaults
	endpoint := opts.BaseURL
	if endpoint == "" {
		endpoint = OpenAIDefaultBaseURL
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = OpenAIDefaultMaxTokens
	}

	// Copy input messages and prepare for modifications
	openaiMessages := make([]OpenAIMessage, len(msgs))
	copy(openaiMessages, msgs)

	// Inject chatOpts.TabState as a text block at the end of the last "user" message
	if chatOpts.TabState != "" {
		// Find the last "user" message
		for i := len(openaiMessages) - 1; i >= 0; i-- {
			if openaiMessages[i].Role == "user" {
				// Add TabState as a new text block
				tabStateBlock := OpenAIMessageContent{
					Type: "input_text",
					Text: chatOpts.TabState,
				}
				openaiMessages[i].Content = append(openaiMessages[i].Content, tabStateBlock)
				break
			}
		}
	}

	// Build request body
	reqBody := &OpenAIRequest{
		Model:           opts.Model,
		Input:           openaiMessages,
		Stream:          true,
		StreamOptions:   &StreamOptionsType{IncludeObfuscation: false},
		MaxOutputTokens: maxTokens,
		Text:            &TextType{Verbosity: "low"},
	}

	// Add system prompt as instructions if provided
	if len(chatOpts.SystemPrompt) > 0 {
		reqBody.Instructions = joinTextParts(chatOpts.SystemPrompt)
	}

	// // Add tools if provided
	// if len(chatOpts.Tools) > 0 {
	// 	tools := make([]interface{}, len(chatOpts.Tools))
	// 	for i, tool := range chatOpts.Tools {
	// 		tools[i] = *tool.Clean()
	// 	}
	// 	reqBody.Tools = tools
	// }
	// for _, tool := range chatOpts.TabTools {
	// 	cleanedTool := *tool.Clean()
	// 	reqBody.Tools = append(reqBody.Tools, cleanedTool)
	// }

	// Set reasoning based on thinking level
	if opts.ThinkingLevel != "" {
		reqBody.Reasoning = &ReasoningType{
			Effort: opts.ThinkingLevel, // low, medium, high map directly
		}
	}

	// Set temperature if provided
	if opts.APIVersion != "" && opts.APIVersion != OpenAIDefaultAPIVersion {
		// Temperature and other parameters could be set here based on config
		// For now, using defaults
	}

	// Pretty print request for debugging
	if jsonStr, err := utilfn.MarshalIndentNoHTMLString(openaiMessages, "", "  "); err == nil {
		log.Printf("system-prompt: %v\n", chatOpts.SystemPrompt)
		var toolNames []string
		for _, tool := range chatOpts.Tools {
			toolNames = append(toolNames, tool.Name)
		}
		for _, tool := range chatOpts.TabTools {
			toolNames = append(toolNames, tool.Name)
		}
		if len(toolNames) > 0 {
			log.Printf("tools: %s\n", joinTextParts(toolNames))
		}
		log.Printf("openaiMsgs JSON:\n%s", jsonStr)
		log.Printf("has-api-key: %v\n", opts.APIToken != "")
		if endpoint != OpenAIDefaultBaseURL {
			log.Printf("baseurl: %s\n", endpoint)
		}
	}

	// Encode request body
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(reqBody)
	if err != nil {
		return nil, err
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return nil, err
	}

	// Get client for Wave AI request
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client for Wave AI request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	if opts.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("X-Wave-ClientId", client.OID)
	req.Header.Set("X-Wave-APIType", "openai")

	return req, nil
}

// joinTextParts joins text parts with newlines
func joinTextParts(parts []string) string {
	var result string
	for i, part := range parts {
		if i > 0 {
			result += "\n"
		}
		result += part
	}
	return result
}

// ConvertAIMessageToOpenAIChatMessage converts an AIMessage to OpenAIChatMessage
// These messages are ALWAYS role "user"
// For now, this only handles text parts and drops files/images/etc.
func ConvertAIMessageToOpenAIChatMessage(aiMsg uctypes.AIMessage) (*OpenAIChatMessage, error) {
	if err := aiMsg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid AIMessage: %w", err)
	}

	var contentBlocks []OpenAIMessageContent

	for i, part := range aiMsg.Parts {
		switch part.Type {
		case uctypes.AIMessagePartTypeText:
			if part.Text == "" {
				return nil, fmt.Errorf("part %d: text type requires non-empty text field", i)
			}
			contentBlocks = append(contentBlocks, OpenAIMessageContent{
				Type: "input_text",
				Text: part.Text,
			})

		case uctypes.AIMessagePartTypeFile:
			// For now, just drop files/images as requested
			log.Printf("openai: dropping file part (not implemented yet)")
			continue

		default:
			// Drop unknown part types
			log.Printf("openai: dropping unknown part type '%s'", part.Type)
			continue
		}
	}

	return &OpenAIChatMessage{
		MessageId: aiMsg.MessageId,
		Role:      "user",
		Content:   contentBlocks,
	}, nil
}
