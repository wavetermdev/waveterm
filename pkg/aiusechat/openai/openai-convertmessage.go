// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	OpenAIDefaultAPIVersion = "2024-12-31"
	OpenAIDefaultMaxTokens  = 4096
)

// convertContentBlockToParts converts a single content block to UIMessageParts
func convertContentBlockToParts(block OpenAIMessageContent, role string) []uctypes.UIMessagePart {
	var parts []uctypes.UIMessagePart

	switch block.Type {
	case "input_text", "output_text":
		if found, part := aiutil.ConvertDataUserFile(block.Text); found {
			if part != nil {
				parts = append(parts, *part)
			}
		} else {
			parts = append(parts, uctypes.UIMessagePart{
				Type: "text",
				Text: block.Text,
			})
		}
	case "input_image":
		if role == "user" {
			parts = append(parts, uctypes.UIMessagePart{
				Type: "data-userfile",
				Data: uctypes.UIMessageDataUserFile{
					FileName:   block.Filename,
					MimeType:   "image/*",
					PreviewUrl: block.PreviewUrl,
				},
			})
		}
	case "input_file":
		if role == "user" {
			parts = append(parts, uctypes.UIMessagePart{
				Type: "data-userfile",
				Data: uctypes.UIMessageDataUserFile{
					FileName:   block.Filename,
					MimeType:   "application/pdf",
					PreviewUrl: block.PreviewUrl,
				},
			})
		}
	}

	return parts
}

// appendToLastUserMessage appends a text block to the last user message in the inputs slice
func appendToLastUserMessage(inputs []any, text string) {
	for i := len(inputs) - 1; i >= 0; i-- {
		if msg, ok := inputs[i].(OpenAIMessage); ok && msg.Role == "user" {
			block := OpenAIMessageContent{
				Type: "input_text",
				Text: text,
			}
			msg.Content = append(msg.Content, block)
			inputs[i] = msg
			break
		}
	}
}

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
	Type        string `json:"type"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"`
	Strict      bool   `json:"strict,omitempty"`
}

// ConvertToolDefinitionToOpenAI converts a generic ToolDefinition to OpenAI format
func ConvertToolDefinitionToOpenAI(tool uctypes.ToolDefinition) OpenAIRequestTool {
	return OpenAIRequestTool{
		Name:        tool.Name,
		Description: tool.Description,
		Parameters:  tool.InputSchema,
		Strict:      tool.Strict,
		Type:        "function",
	}
}

func debugPrintReq(req *OpenAIRequest, endpoint string) {
	if !wavebase.IsDevMode() {
		return
	}
	if endpoint != uctypes.DefaultAIEndpoint {
		log.Printf("endpoint: %s\n", endpoint)
	}
	var toolNames []string
	for _, tool := range req.Tools {
		toolNames = append(toolNames, tool.Name)
	}
	modelInfo := req.Model
	var details []string
	if req.Reasoning != nil && req.Reasoning.Effort != "" {
		details = append(details, fmt.Sprintf("reasoning: %s", req.Reasoning.Effort))
	}
	if req.MaxOutputTokens > 0 {
		details = append(details, fmt.Sprintf("max_tokens: %d", req.MaxOutputTokens))
	}
	if len(details) > 0 {
		log.Printf("model %s (%s)\n", modelInfo, strings.Join(details, ", "))
	} else {
		log.Printf("model %s\n", modelInfo)
	}
	if len(toolNames) > 0 {
		log.Printf("tools: %s\n", strings.Join(toolNames, ","))
	}

	log.Printf("inputs (%d):", len(req.Input))
	for idx, input := range req.Input {
		debugPrintInput(idx, input)
	}
}

// buildOpenAIHTTPRequest creates a complete HTTP request for the OpenAI API
func buildOpenAIHTTPRequest(ctx context.Context, inputs []any, chatOpts uctypes.WaveChatOpts, cont *uctypes.WaveContinueResponse) (*http.Request, error) {
	opts := chatOpts.Config

	// If continuing from premium rate limit, downgrade to default model and low thinking
	if cont != nil && cont.ContinueFromKind == uctypes.StopKindPremiumRateLimit {
		opts.Model = uctypes.DefaultOpenAIModel
		opts.ThinkingLevel = uctypes.ThinkingLevelLow
	}

	if opts.Model == "" {
		return nil, errors.New("ai:model is required")
	}
	if chatOpts.ClientId == "" {
		return nil, errors.New("chatOpts.ClientId is required")
	}

	// Set defaults
	endpoint := opts.Endpoint
	if endpoint == "" {
		return nil, errors.New("ai:endpoint is required")
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = OpenAIDefaultMaxTokens
	}

	// injected data
	if chatOpts.TabState != "" {
		appendToLastUserMessage(inputs, chatOpts.TabState)
	}
	if chatOpts.PlatformInfo != "" {
		appendToLastUserMessage(inputs, "<PlatformInfo>\n"+chatOpts.PlatformInfo+"\n</PlatformInfo>")
	}
	if chatOpts.AppStaticFiles != "" {
		appendToLastUserMessage(inputs, "<CurrentAppStaticFiles>\n"+chatOpts.AppStaticFiles+"\n</CurrentAppStaticFiles>")
	}
	if chatOpts.AppGoFile != "" {
		appendToLastUserMessage(inputs, "<CurrentAppGoFile>\n"+chatOpts.AppGoFile+"\n</CurrentAppGoFile>")
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

	// Add native web search tool if enabled
	if chatOpts.AllowNativeWebSearch {
		webSearchTool := OpenAIRequestTool{
			Type: "web_search",
		}
		reqBody.Tools = append(reqBody.Tools, webSearchTool)
	}

	// Set reasoning based on thinking level
	if opts.ThinkingLevel != "" {
		reqBody.Reasoning = &ReasoningType{
			Effort: opts.ThinkingLevel, // low, medium, high map directly
		}
		if opts.Model == "gpt-5" || opts.Model == "gpt-5.1" {
			reqBody.Reasoning.Summary = "auto"
		}
	}

	debugPrintReq(reqBody, endpoint)

	// Encode request body
	buf, err := aiutil.JsonEncodeRequestBody(reqBody)
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
	// Azure OpenAI uses "api-key" header instead of "Authorization: Bearer"
	if opts.Provider == uctypes.AIProvider_Azure || opts.Provider == uctypes.AIProvider_AzureLegacy {
		req.Header.Set("api-key", opts.APIToken)
	} else {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
	}
	req.Header.Set("Accept", "text/event-stream")

	// Only send Wave-specific headers when using Wave provider
	if opts.Provider == uctypes.AIProvider_Wave {
		if chatOpts.ClientId != "" {
			req.Header.Set("X-Wave-ClientId", chatOpts.ClientId)
		}
		if chatOpts.ChatId != "" {
			req.Header.Set("X-Wave-ChatId", chatOpts.ChatId)
		}
		req.Header.Set("X-Wave-Version", wavebase.WaveVersion)
		req.Header.Set("X-Wave-APIType", uctypes.APIType_OpenAIResponses)
		req.Header.Set("X-Wave-RequestType", chatOpts.GetWaveRequestType())
	}

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
		imageUrl, err := aiutil.ExtractImageUrl(part.Data, part.URL, part.MimeType)
		if err != nil {
			return nil, err
		}

		return &OpenAIMessageContent{
			Type:       "input_image",
			ImageUrl:   imageUrl,
			Filename:   part.FileName,
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
		textData, err := aiutil.ExtractTextData(part.Data, part.URL)
		if err != nil {
			return nil, err
		}
		formattedText := aiutil.FormatAttachedTextFile(part.FileName, textData)
		return &OpenAIMessageContent{
			Type: "input_text",
			Text: formattedText,
		}, nil
	case part.MimeType == "directory":
		var jsonContent string

		if len(part.Data) > 0 {
			jsonContent = string(part.Data)
		} else {
			return nil, fmt.Errorf("directory listing part missing data")
		}

		formattedText := aiutil.FormatAttachedDirectoryListing(part.FileName, jsonContent)

		return &OpenAIMessageContent{
			Type: "input_text",
			Text: formattedText,
		}, nil

	default:
		return nil, fmt.Errorf("dropping file with unsupported mimetype '%s' (OpenAI supports images, PDFs, text/plain, and directories)", part.MimeType)
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

// convertToUIMessage converts an OpenAIChatMessage to a UIMessage
func (m *OpenAIChatMessage) convertToUIMessage() *uctypes.UIMessage {
	var parts []uctypes.UIMessagePart
	var role string

	// Handle different message types
	if m.Message != nil {
		role = m.Message.Role
		for _, block := range m.Message.Content {
			blockParts := convertContentBlockToParts(block, role)
			parts = append(parts, blockParts...)
		}
	} else if m.FunctionCall != nil {
		// Handle function call input
		role = "assistant"
		if m.FunctionCall.ToolUseData != nil {
			parts = append(parts, uctypes.UIMessagePart{
				Type: "data-tooluse",
				ID:   m.FunctionCall.CallId,
				Data: *m.FunctionCall.ToolUseData,
			})
		}
	} else if m.FunctionCallOutput != nil {
		// FunctionCallOutput messages are not converted to UIMessage
		return nil
	}
	if len(parts) == 0 {
		return nil
	}
	return &uctypes.UIMessage{
		ID:    m.MessageId,
		Role:  role,
		Parts: parts,
	}
}

// ConvertAIChatToUIChat converts an AIChat to a UIChat for OpenAI
func ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	if aiChat.APIType != uctypes.APIType_OpenAIResponses {
		return nil, fmt.Errorf("APIType must be '%s', got '%s'", uctypes.APIType_OpenAIResponses, aiChat.APIType)
	}
	uiMessages := make([]uctypes.UIMessage, 0, len(aiChat.NativeMessages))
	for i, nativeMsg := range aiChat.NativeMessages {
		openaiMsg, ok := nativeMsg.(*OpenAIChatMessage)
		if !ok {
			return nil, fmt.Errorf("message %d: expected *OpenAIChatMessage, got %T", i, nativeMsg)
		}
		uiMsg := openaiMsg.convertToUIMessage()
		if uiMsg != nil {
			uiMessages = append(uiMessages, *uiMsg)
		}
	}
	return &uctypes.UIChat{
		ChatId:     aiChat.ChatId,
		APIType:    aiChat.APIType,
		Model:      aiChat.Model,
		APIVersion: aiChat.APIVersion,
		Messages:   uiMessages,
	}, nil
}

// GetFunctionCallInputByToolCallId returns the OpenAIFunctionCallInput associated with the given ToolCallId,
// or nil if not found in the AIChat
func GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *OpenAIFunctionCallInput {
	for _, nativeMsg := range aiChat.NativeMessages {
		openaiMsg, ok := nativeMsg.(*OpenAIChatMessage)
		if !ok {
			continue
		}
		if openaiMsg.FunctionCall != nil && openaiMsg.FunctionCall.CallId == toolCallId {
			return openaiMsg.FunctionCall
		}
	}
	return nil
}
