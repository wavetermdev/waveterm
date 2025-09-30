// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const (
	OpenAIDefaultBaseURL    = "https://api.openai.com/v1/responses"
	OpenAIDefaultAPIVersion = "2024-12-31"
	OpenAIDefaultMaxTokens  = 4096
)

// ---------- OpenAI Request Types ----------

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
	Background         bool                `json:"background,omitempty"`
	Conversation       string              `json:"conversation,omitempty"`
	Include            []string            `json:"include,omitempty"`
	Input              []any               `json:"input,omitempty"` // either OpenAIMessage or OpenAIFunctionCallInput
	Instructions       string              `json:"instructions,omitempty"`
	MaxOutputTokens    int                 `json:"max_output_tokens,omitempty"`
	MaxToolCalls       int                 `json:"max_tool_calls,omitempty"`
	Metadata           map[string]string   `json:"metadata,omitempty"`
	Model              string              `json:"model,omitempty"`
	ParallelToolCalls  bool                `json:"parallel_tool_calls,omitempty"`
	PreviousResponseID string              `json:"previous_response_id,omitempty"`
	Prompt             *PromptType         `json:"prompt,omitempty"`
	PromptCacheKey     string              `json:"prompt_cache_key,omitempty"`
	Reasoning          *ReasoningType      `json:"reasoning,omitempty"`
	SafetyIdentifier   string              `json:"safety_identifier,omitempty"`
	ServiceTier        string              `json:"service_tier,omitempty"` // "auto", "default", "flex", "priority"
	Store              bool                `json:"store,omitempty"`
	Stream             bool                `json:"stream,omitempty"`
	StreamOptions      *StreamOptionsType  `json:"stream_options,omitempty"`
	Temperature        float64             `json:"temperature,omitempty"`
	Text               *TextType           `json:"text,omitempty"`
	ToolChoice         interface{}         `json:"tool_choice,omitempty"` // "none", "auto", "required", or object
	Tools              []OpenAIRequestTool `json:"tools,omitempty"`
	TopLogprobs        int                 `json:"top_logprobs,omitempty"`
	TopP               float64             `json:"top_p,omitempty"`
	Truncation         string              `json:"truncation,omitempty"` // "auto", "disabled"
}

type OpenAIRequestTool struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters"`
	Strict      bool   `json:"strict"`
	Type        string `json:"type"`
}

// ConvertToolDefinitionToOpenAI converts a generic ToolDefinition to OpenAI format
func ConvertToolDefinitionToOpenAI(tool uctypes.ToolDefinition) OpenAIRequestTool {
	cleanedTool := tool.Clean()
	return OpenAIRequestTool{
		Name:        cleanedTool.Name,
		Description: cleanedTool.Description,
		Parameters:  cleanedTool.InputSchema,
		Strict:      cleanedTool.Strict,
		Type:        "function",
	}
}

func debugPrintReq(req *OpenAIRequest, endpoint string) {
	var toolNames []string
	for _, tool := range req.Tools {
		toolNames = append(toolNames, tool.Name)
	}
	if len(toolNames) > 0 {
		log.Printf("tools: %s\n", strings.Join(toolNames, ","))
	}
	
	log.Printf("inputs (%d):", len(req.Input))
	for idx, input := range req.Input {
		debugPrintInput(idx, input)
	}
	
	log.Printf("baseurl: %s\n", endpoint)
}

// buildOpenAIHTTPRequest creates a complete HTTP request for the OpenAI API
func buildOpenAIHTTPRequest(ctx context.Context, inputs []any, chatOpts uctypes.WaveChatOpts) (*http.Request, error) {
	opts := chatOpts.Config
	if opts.Model == "" {
		return nil, errors.New("opts.model is required")
	}
	if chatOpts.ClientId == "" {
		return nil, errors.New("chatOpts.ClientId is required")
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

	// Inject chatOpts.TabState as a text block at the end of the last "user" message
	if chatOpts.TabState != "" {
		// Find the last "user" message
		for i := len(inputs) - 1; i >= 0; i-- {
			if msg, ok := inputs[i].(OpenAIMessage); ok && msg.Role == "user" {
				// Add TabState as a new text block
				tabStateBlock := OpenAIMessageContent{
					Type: "input_text",
					Text: chatOpts.TabState,
				}
				msg.Content = append(msg.Content, tabStateBlock)
				inputs[i] = msg
				break
			}
		}
	}

	// Build request body
	reqBody := &OpenAIRequest{
		Model:           opts.Model,
		Input:           inputs,
		Stream:          true,
		StreamOptions:   &StreamOptionsType{IncludeObfuscation: false},
		MaxOutputTokens: maxTokens,
		Text:            &TextType{Verbosity: "low"},
	}

	// Add system prompt as instructions if provided
	if len(chatOpts.SystemPrompt) > 0 {
		reqBody.Instructions = strings.Join(chatOpts.SystemPrompt, "\n")
	}

	// Add tools if provided
	if len(chatOpts.Tools) > 0 {
		tools := make([]OpenAIRequestTool, len(chatOpts.Tools))
		for i, tool := range chatOpts.Tools {
			tools[i] = ConvertToolDefinitionToOpenAI(tool)
		}
		reqBody.Tools = tools
	}
	for _, tool := range chatOpts.TabTools {
		convertedTool := ConvertToolDefinitionToOpenAI(tool)
		reqBody.Tools = append(reqBody.Tools, convertedTool)
	}

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

	debugPrintReq(reqBody, endpoint)

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

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	if opts.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
	}
	req.Header.Set("Accept", "text/event-stream")
	if chatOpts.ClientId != "" {
		req.Header.Set("X-Wave-ClientId", chatOpts.ClientId)
	}
	req.Header.Set("X-Wave-APIType", "openai")

	return req, nil
}

// convertFileAIMessagePart converts a file AIMessagePart to OpenAI format
func convertFileAIMessagePart(part uctypes.AIMessagePart) (*OpenAIMessageContent, error) {
	if part.Type != uctypes.AIMessagePartTypeFile {
		return nil, fmt.Errorf("convertFileAIMessagePart expects 'file' type, got '%s'", part.Type)
	}
	if part.MimeType == "" {
		return nil, fmt.Errorf("file part missing mimetype")
	}

	// Handle different file types
	switch {
	case strings.HasPrefix(part.MimeType, "image/"):
		// Handle images
		var imageUrl string

		if part.URL != "" {
			// Validate URL protocol - only allow data:, http:, https:
			if !strings.HasPrefix(part.URL, "data:") &&
				!strings.HasPrefix(part.URL, "http://") &&
				!strings.HasPrefix(part.URL, "https://") {
				return nil, fmt.Errorf("unsupported URL protocol in file part: %s", part.URL)
			}
			imageUrl = part.URL
		} else if len(part.Data) > 0 {
			// Convert raw data to base64 data URL
			base64Data := base64.StdEncoding.EncodeToString(part.Data)
			imageUrl = fmt.Sprintf("data:%s;base64,%s", part.MimeType, base64Data)
		} else {
			return nil, fmt.Errorf("file part missing both url and data")
		}

		return &OpenAIMessageContent{
			Type:       "input_image",
			ImageUrl:   imageUrl,
			PreviewUrl: part.PreviewUrl,
		}, nil

	case part.MimeType == "application/pdf":
		// Handle PDFs - OpenAI only supports base64 data for PDFs, not URLs
		if len(part.Data) == 0 {
			if part.URL != "" {
				return nil, fmt.Errorf("dropping PDF with URL (must be fetched and converted to base64 data)")
			}
			return nil, fmt.Errorf("PDF file part missing data")
		}

		// Convert raw data to base64
		base64Data := base64.StdEncoding.EncodeToString(part.Data)

		return &OpenAIMessageContent{
			Type:       "input_file",
			Filename:   part.FileName, // Optional filename
			FileData:   base64Data,
			PreviewUrl: part.PreviewUrl,
		}, nil

	case part.MimeType == "text/plain":
		// Handle text/plain files as input_text with special formatting
		var textContent string

		if len(part.Data) > 0 {
			textContent = string(part.Data)
		} else if part.URL != "" {
			return nil, fmt.Errorf("dropping text/plain file with URL (must be fetched and converted to data)")
		} else {
			return nil, fmt.Errorf("text/plain file part missing data")
		}

		// Format as: file "filename" (mimetype)\n\nfile-content
		fileName := part.FileName
		if fileName == "" {
			fileName = "untitled.txt"
		}

		formattedText := fmt.Sprintf("file %q (%s)\n\n%s", fileName, part.MimeType, textContent)

		return &OpenAIMessageContent{
			Type: "input_text",
			Text: formattedText,
		}, nil

	default:
		return nil, fmt.Errorf("dropping file with unsupported mimetype '%s' (OpenAI supports images, PDFs, and text/plain)", part.MimeType)
	}
}

// ConvertAIMessageToOpenAIChatMessage converts an AIMessage to OpenAIChatMessage
// These messages are ALWAYS role "user"
// Handles text parts, images, PDFs, and text/plain files
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
			block, err := convertFileAIMessagePart(part)
			if err != nil {
				log.Printf("openai: %v", err)
				continue
			}
			contentBlocks = append(contentBlocks, *block)

		default:
			// Drop unknown part types
			log.Printf("openai: dropping unknown part type '%s'", part.Type)
			continue
		}
	}

	return &OpenAIChatMessage{
		MessageId: aiMsg.MessageId,
		Message: &OpenAIMessage{
			Role:    "user",
			Content: contentBlocks,
		},
	}, nil
}

// ConvertToolResultsToOpenAIChatMessage converts AIToolResult slice to OpenAIChatMessage slice
func ConvertToolResultsToOpenAIChatMessage(toolResults []uctypes.AIToolResult) ([]*OpenAIChatMessage, error) {
	if len(toolResults) == 0 {
		return nil, errors.New("toolResults cannot be empty")
	}

	var messages []*OpenAIChatMessage

	for _, result := range toolResults {
		if result.ToolUseID == "" {
			return nil, fmt.Errorf("tool result missing ToolUseID")
		}

		// Create the function call output with result data
		var outputData any
		if result.ErrorText != "" {
			// Marshal error output to string
			errorOutput := OpenAIFunctionCallErrorOutput{
				Ok:    "false",
				Error: result.ErrorText,
			}
			errorBytes, err := json.Marshal(errorOutput)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal error output: %w", err)
			}
			outputData = string(errorBytes)
		} else {
			// Check if text looks like an image data URL
			if strings.HasPrefix(result.Text, "data:image/") {
				// Convert to output array with input_image type
				outputData = []OpenAIMessageContent{
					{
						Type:     "input_image",
						ImageUrl: result.Text,
					},
				}
			} else {
				// Use text result for success
				outputData = result.Text
			}
		}

		functionCallOutput := &OpenAIFunctionCallOutputInput{
			Type:   "function_call_output",
			CallId: result.ToolUseID,
			Output: outputData,
		}

		messages = append(messages, &OpenAIChatMessage{
			MessageId:          uuid.New().String(),
			FunctionCallOutput: functionCallOutput,
		})
	}

	return messages, nil
}
