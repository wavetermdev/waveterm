// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package anthropic

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// these conversions are based off the anthropic spec
// and the aiprompts/aisdk-uimessage-type.md doc (v5)

// buildAnthropicHTTPRequest creates a complete HTTP request for the Anthropic API
func buildAnthropicHTTPRequest(ctx context.Context, msgs []anthropicInputMessage, chatOpts uctypes.WaveChatOpts) (*http.Request, error) {
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
		return nil, errors.New("BaseURL is required")
	}

	apiVersion := opts.APIVersion
	if apiVersion == "" {
		apiVersion = AnthropicDefaultAPIVersion
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = AnthropicDefaultMaxTokens
	}

	// Convert messages to clear FileName fields from Source blocks
	convertedMsgs := make([]anthropicInputMessage, len(msgs))
	for i, msg := range msgs {
		convertedMsgs[i] = convertMessageForAPI(msg)
	}

	// inject chatOpts.TabState as a "text" block at the END of the LAST "user" message found (append to Content)
	if chatOpts.TabState != "" {
		// Find the last "user" message
		for i := len(convertedMsgs) - 1; i >= 0; i-- {
			if convertedMsgs[i].Role == "user" {
				// Create a text block with the TabState content
				tabStateBlock := anthropicMessageContentBlock{
					Type: "text",
					Text: chatOpts.TabState,
				}
				// Append to the Content of this message
				convertedMsgs[i].Content = append(convertedMsgs[i].Content, tabStateBlock)
				break
			}
		}
	}

	// Build request body
	reqBody := &anthropicStreamRequest{
		Model:     opts.Model,
		MaxTokens: maxTokens,
		Stream:    true,
		Messages:  convertedMsgs,
	}

	// Add system prompt if provided
	if len(chatOpts.SystemPrompt) > 0 {
		systemBlocks := make([]anthropicMessageContentBlock, len(chatOpts.SystemPrompt))
		for i, prompt := range chatOpts.SystemPrompt {
			systemBlocks[i] = anthropicMessageContentBlock{
				Type: "text",
				Text: prompt,
			}
		}
		reqBody.System = systemBlocks
	}

	if len(chatOpts.Tools) > 0 {
		cleanedTools := make([]uctypes.ToolDefinition, len(chatOpts.Tools))
		for i, tool := range chatOpts.Tools {
			cleanedTools[i] = *tool.Clean()
		}
		reqBody.Tools = cleanedTools
	}
	for _, tool := range chatOpts.TabTools {
		cleanedTool := *tool.Clean()
		reqBody.Tools = append(reqBody.Tools, cleanedTool)
	}

	// Enable extended thinking based on level
	reqBody.Thinking = makeThinkingOpts(opts.ThinkingLevel, maxTokens)

	// pretty print json of anthropicMsgs
	if jsonStr, err := utilfn.MarshalIndentNoHTMLString(convertedMsgs, "", "  "); err == nil {
		log.Printf("system-prompt: %v\n", chatOpts.SystemPrompt)
		var toolNames []string
		for _, tool := range chatOpts.Tools {
			toolNames = append(toolNames, tool.Name)
		}
		for _, tool := range chatOpts.TabTools {
			toolNames = append(toolNames, tool.Name)
		}
		log.Printf("tools: %s\n", strings.Join(toolNames, ", "))
		log.Printf("anthropicMsgs JSON:\n%s", jsonStr)
		log.Printf("has-api-key: %v\n", opts.APIToken != "")
	}

	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(reqBody)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	if opts.APIToken != "" {
		req.Header.Set("x-api-key", opts.APIToken)
	}
	req.Header.Set("anthropic-version", apiVersion)
	req.Header.Set("accept", "text/event-stream")
	req.Header.Set("X-Wave-ClientId", chatOpts.ClientId)
	req.Header.Set("X-Wave-APIType", "anthropic")

	return req, nil
}

// convertToolUsePart converts a tool-* type UIMessagePart to an Anthropic tool_use or tool_result block
func convertToolUsePart(p uctypes.UIMessagePart) (*anthropicMessageContentBlock, error) {
	// Sanity check that this is actually a tool-* type
	if !strings.HasPrefix(p.Type, "tool-") {
		return nil, fmt.Errorf("convertToolUsePart expects 'tool-*' type, got '%s'", p.Type)
	}

	// Extract tool name from type field (format: "tool-{name}")
	toolName := strings.TrimPrefix(p.Type, "tool-")
	if toolName == "" {
		return nil, fmt.Errorf("tool name is empty (type was '%s')", p.Type)
	}
	if len(toolName) > 200 {
		return nil, fmt.Errorf("tool name exceeds 200 character limit: %d characters", len(toolName))
	}
	if p.ToolCallID == "" {
		return nil, fmt.Errorf("tool call ID is required but missing")
	}

	// Validate ToolCallID charset (must match ^[a-zA-Z0-9_-]+$)
	validIDPattern := regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	if !validIDPattern.MatchString(p.ToolCallID) {
		return nil, fmt.Errorf("tool call ID contains invalid characters (must be alphanumeric, underscore, or dash): %s", p.ToolCallID)
	}

	// Handle different states
	if p.State == "input-streaming" || p.State == "input-available" {
		// These states represent tool calls (tool_use blocks)
		// Anthropic expects an object for input, never nil
		input := p.Input
		if input == nil {
			input = map[string]interface{}{}
		} else {
			// Validate that input is an object (map), not string/array
			if _, ok := input.(map[string]interface{}); !ok {
				return nil, fmt.Errorf("tool input must be an object/map, got %T", input)
			}
		}

		return &anthropicMessageContentBlock{
			Type:  "tool_use",
			ID:    p.ToolCallID,
			Name:  toolName,
			Input: input,
		}, nil

	} else if p.State == "output-available" {
		// This state represents successful tool execution result (tool_result block)
		var content interface{}
		if p.Output != nil {
			// Try to convert output to string if it's not already
			if outputStr, ok := p.Output.(string); ok {
				content = outputStr
			} else {
				// If it's not a string, marshal it to JSON
				outputBytes, err := json.Marshal(p.Output)
				if err != nil {
					return nil, fmt.Errorf("failed to marshal tool output: %w", err)
				}
				content = string(outputBytes)
			}
		} else {
			content = ""
		}

		return &anthropicMessageContentBlock{
			Type:      "tool_result",
			ToolUseID: p.ToolCallID,
			Content:   content,
		}, nil

	} else if p.State == "output-error" {
		// This state represents failed tool execution (tool_result block with error)
		errorContent := p.ErrorText
		if errorContent == "" {
			errorContent = "Tool execution failed"
		}

		return &anthropicMessageContentBlock{
			Type:      "tool_result",
			ToolUseID: p.ToolCallID,
			Content:   errorContent,
			IsError:   true,
		}, nil

	} else {
		return nil, fmt.Errorf("invalid tool part state '%s' (must be 'input-streaming', 'input-available', 'output-available', or 'output-error')", p.State)
	}
}

// convertPartToAnthropicBlocks converts a single UIMessagePart to one or more Anthropic content blocks
func convertPartToAnthropicBlocks(p uctypes.UIMessagePart, role string, blockIndex int) ([]anthropicMessageContentBlock, error) {
	if p.Type == "text" {
		return []anthropicMessageContentBlock{{
			Type: "text",
			Text: p.Text,
		}}, nil
	} else if p.Type == "reasoning" {
		// Check if we have a signature in provider metadata
		signature, hasSignature := p.ProviderMetadata[ProviderMetadataThinkingSignatureKey]
		if !hasSignature {
			return nil, fmt.Errorf("reasoning part requires signature in provider metadata key '%s'", ProviderMetadataThinkingSignatureKey)
		}

		signatureStr, ok := signature.(string)
		if !ok {
			return nil, fmt.Errorf("reasoning part signature must be a string, got %T", signature)
		}

		return []anthropicMessageContentBlock{{
			Type:      "thinking",
			Thinking:  p.Text,
			Signature: signatureStr,
		}}, nil
	} else if p.Type == "source-url" || p.Type == "source-document" {
		// no longer convert citations
		return nil, nil
	} else if p.Type == "step-start" {
		// Omit step-start parts from Anthropic
		return nil, nil
	} else if strings.HasPrefix(p.Type, "data-") {
		// Omit data-* parts from Anthropic
		return nil, nil
	} else if p.Type == "file" {
		// Anthropic expects files in user messages
		if role != "user" {
			return nil, fmt.Errorf("dropping file part in %s message (files should be in user messages)", role)
		}
		block, err := convertFileUIMessagePart(p)
		if err != nil {
			return nil, err
		}
		return []anthropicMessageContentBlock{*block}, nil
	} else if strings.HasPrefix(p.Type, "tool-") {
		block, err := convertToolUsePart(p)
		if err != nil {
			return nil, err
		}
		return []anthropicMessageContentBlock{*block}, nil
	} else {
		// Skip unknown part types
		return nil, fmt.Errorf("dropping unknown part type '%s'", p.Type)
	}
}

// convertPartsToAnthropicBlocks converts UseChatMessagePart array to Anthropic content blocks with role-based validation
func convertPartsToAnthropicBlocks(parts []uctypes.UIMessagePart, role string) ([]anthropicMessageContentBlock, error) {
	var blocks []anthropicMessageContentBlock

	for _, p := range parts {
		partBlocks, err := convertPartToAnthropicBlocks(p, role, len(blocks))
		if err != nil {
			log.Printf("anthropic: %v", err)
			continue
		}
		blocks = append(blocks, partBlocks...)
	}

	return blocks, nil
}

// convertFileUIMessagePart converts a file part to Anthropic image or document block format
func convertFileUIMessagePart(p uctypes.UIMessagePart) (*anthropicMessageContentBlock, error) {
	if p.Type != "file" {
		return nil, fmt.Errorf("convertFileUIMessagePart expects 'file' type, got '%s'", p.Type)
	}
	if p.URL == "" {
		return nil, errors.New("file part missing url")
	}
	if p.MediaType == "" {
		return nil, errors.New("file part missing mediaType")
	}

	// Validate URL protocol - only allow data:, http:, https:
	if !strings.HasPrefix(p.URL, "data:") &&
		!strings.HasPrefix(p.URL, "http://") &&
		!strings.HasPrefix(p.URL, "https://") {
		return nil, fmt.Errorf("unsupported URL protocol in file part: %s", p.URL)
	}

	// Branch on mediaType first to determine block type and constraints
	switch {
	case strings.HasPrefix(p.MediaType, "image/"):
		// image/* (jpeg, png, gif, webp) → Anthropic image block
		if strings.HasPrefix(p.URL, "data:") {
			// Data URL → base64 source
			parts := strings.SplitN(p.URL, ",", 2)
			if len(parts) != 2 {
				return nil, errors.New("invalid data URL format")
			}
			return &anthropicMessageContentBlock{
				Type: "image",
				Source: &anthropicSource{
					Type:      "base64",
					Data:      parts[1],
					MediaType: p.MediaType,
				},
			}, nil
		} else {
			// HTTP/HTTPS URL → url source (no media_type for image URLs)
			return &anthropicMessageContentBlock{
				Type: "image",
				Source: &anthropicSource{
					Type: "url",
					URL:  p.URL,
				},
			}, nil
		}

	case p.MediaType == "application/pdf":
		// application/pdf → Anthropic document block
		if strings.HasPrefix(p.URL, "data:") {
			// Data URL → base64 source
			parts := strings.SplitN(p.URL, ",", 2)
			if len(parts) != 2 {
				return nil, errors.New("invalid data URL format")
			}
			return &anthropicMessageContentBlock{
				Type: "document",
				Source: &anthropicSource{
					Type:      "base64",
					Data:      parts[1],
					MediaType: p.MediaType,
				},
			}, nil
		} else {
			// HTTP/HTTPS URL → url source (no media_type for URL sources)
			return &anthropicMessageContentBlock{
				Type: "document",
				Source: &anthropicSource{
					Type: "url",
					URL:  p.URL,
				},
			}, nil
		}

	case p.MediaType == "text/plain":
		// text/plain → Anthropic document block, but NO URL form supported
		if strings.HasPrefix(p.URL, "data:") {
			// Data URL → decode base64 data and return as document with PlainTextSource
			parts := strings.SplitN(p.URL, ",", 2)
			if len(parts) != 2 {
				return nil, errors.New("invalid data URL format")
			}
			// Decode base64 data
			textData, err := base64.StdEncoding.DecodeString(parts[1])
			if err != nil {
				return nil, fmt.Errorf("failed to decode base64 data: %w", err)
			}
			return &anthropicMessageContentBlock{
				Type: "document",
				Source: &anthropicSource{
					Type:      "text",
					Data:      string(textData),
					MediaType: "text/plain",
				},
			}, nil
		} else {
			// HTTP/HTTPS URL → not supported inline, would need to fetch
			return nil, fmt.Errorf("dropping text/plain file with URL (must be fetched and converted to base64 or uploaded to Files API)")
		}

	default:
		// Other media types → not supported inline, must upload and use file_id
		return nil, fmt.Errorf("dropping file with unsupported media type '%s' (must be uploaded to Files API and sent as file_id)", p.MediaType)
	}

}

// convertAIMessageToAnthropicChatMessage converts an AIMessage to anthropicChatMessage
// These messages are ALWAYS role "user"
func ConvertAIMessageToAnthropicChatMessage(aiMsg uctypes.AIMessage) (*anthropicChatMessage, error) {
	if err := aiMsg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid AIMessage: %w", err)
	}

	var contentBlocks []anthropicMessageContentBlock

	for i, part := range aiMsg.Parts {
		switch part.Type {
		case uctypes.AIMessagePartTypeText:
			if part.Text == "" {
				return nil, fmt.Errorf("part %d: text type requires non-empty text field", i)
			}
			contentBlocks = append(contentBlocks, anthropicMessageContentBlock{
				Type: "text",
				Text: part.Text,
			})

		case uctypes.AIMessagePartTypeFile:
			block, err := convertFileAIMessagePart(part)
			if err != nil {
				return nil, fmt.Errorf("part %d: %w", i, err)
			}
			contentBlocks = append(contentBlocks, *block)

		default:
			return nil, fmt.Errorf("part %d: unsupported part type '%s'", i, part.Type)
		}
	}

	return &anthropicChatMessage{
		MessageId: aiMsg.MessageId,
		Role:      "user",
		Content:   contentBlocks,
	}, nil
}

// hasInlineData checks if the part has data available for inline use (either Data field or data URL)
func hasInlineData(part uctypes.AIMessagePart) bool {
	hasData := len(part.Data) > 0
	hasURL := part.URL != "" && strings.HasPrefix(part.URL, "data:")
	return hasData || hasURL
}

// extractBase64Data extracts base64 data from either the Data field or a data URL
func extractBase64Data(part uctypes.AIMessagePart) (string, error) {
	hasData := len(part.Data) > 0
	hasURL := part.URL != ""

	if hasData {
		// Raw data → base64 encode
		return base64.StdEncoding.EncodeToString(part.Data), nil
	} else if hasURL && strings.HasPrefix(part.URL, "data:") {
		// Data URL → check format and extract/encode data appropriately
		parts := strings.SplitN(part.URL, ",", 2)
		if len(parts) != 2 {
			return "", errors.New("invalid data URL format")
		}

		header := parts[0]
		data := parts[1]

		// Check if it's already base64 encoded: data:mediatype;base64,<data>
		if strings.Contains(header, ";base64") {
			// Already base64 encoded
			return data, nil
		} else {
			// Raw data that needs base64 encoding: data:mediatype,<raw_data>
			return base64.StdEncoding.EncodeToString([]byte(data)), nil
		}
	}

	return "", errors.New("no data available for base64 extraction")
}

// convertFileAIMessagePart converts a file AIMessagePart to anthropicMessageContentBlock
func convertFileAIMessagePart(part uctypes.AIMessagePart) (*anthropicMessageContentBlock, error) {
	if part.Type != uctypes.AIMessagePartTypeFile {
		return nil, fmt.Errorf("convertFileAIMessagePart expects 'file' type, got '%s'", part.Type)
	}

	if err := part.Validate(); err != nil {
		return nil, err
	}

	// Validate URL protocol if URL is provided - only allow data:, http:, https:
	if part.URL != "" {
		if !strings.HasPrefix(part.URL, "data:") &&
			!strings.HasPrefix(part.URL, "http://") &&
			!strings.HasPrefix(part.URL, "https://") {
			return nil, fmt.Errorf("unsupported URL protocol in file part: %s", part.URL)
		}
	}

	// Branch on mimetype to determine block type and constraints
	switch {
	case strings.HasPrefix(part.MimeType, "image/"):
		// image/* (jpeg, png, gif, webp) → Anthropic image block
		if hasInlineData(part) {
			// Data available → use base64 source
			base64Data, err := extractBase64Data(part)
			if err != nil {
				return nil, err
			}
			return &anthropicMessageContentBlock{
				Type: "image",
				Source: &anthropicSource{
					Type:      "base64",
					Data:      base64Data,
					MediaType: part.MimeType,
					FileName:  part.FileName,
				},
				SourcePreviewUrl: part.PreviewUrl,
			}, nil
		} else {
			// HTTP/HTTPS URL → url source (no media_type for image URLs)
			return &anthropicMessageContentBlock{
				Type: "image",
				Source: &anthropicSource{
					Type:     "url",
					URL:      part.URL,
					FileName: part.FileName,
				},
				SourcePreviewUrl: part.PreviewUrl,
			}, nil
		}

	case part.MimeType == "application/pdf":
		// application/pdf → Anthropic document block
		if hasInlineData(part) {
			// Data available → use base64 source
			base64Data, err := extractBase64Data(part)
			if err != nil {
				return nil, err
			}
			return &anthropicMessageContentBlock{
				Type: "document",
				Source: &anthropicSource{
					Type:      "base64",
					Data:      base64Data,
					MediaType: part.MimeType,
					FileName:  part.FileName,
				},
				SourcePreviewUrl: part.PreviewUrl,
			}, nil
		} else {
			// HTTP/HTTPS URL → url source (no media_type for URL sources)
			return &anthropicMessageContentBlock{
				Type: "document",
				Source: &anthropicSource{
					Type:     "url",
					URL:      part.URL,
					FileName: part.FileName,
				},
				SourcePreviewUrl: part.PreviewUrl,
			}, nil
		}

	case part.MimeType == "text/plain":
		// text/plain → Anthropic document block, but NO URL form supported
		if hasInlineData(part) {
			var textData string
			if len(part.Data) > 0 {
				// Raw data → convert to string directly
				textData = string(part.Data)
			} else {
				// Data URL → extract base64 data and decode back to string
				base64Data, err := extractBase64Data(part)
				if err != nil {
					return nil, err
				}
				decoded, err := base64.StdEncoding.DecodeString(base64Data)
				if err != nil {
					return nil, fmt.Errorf("failed to decode base64 data: %w", err)
				}
				textData = string(decoded)
			}
			return &anthropicMessageContentBlock{
				Type: "document",
				Source: &anthropicSource{
					Type:      "text",
					Data:      textData,
					MediaType: part.MimeType,
					FileName:  part.FileName,
				},
			}, nil
		} else {
			// HTTP/HTTPS URL → not supported inline, would need to fetch
			return nil, fmt.Errorf("text/plain file with URL not supported (must be fetched and converted to base64 or uploaded to Files API)")
		}

	default:
		// Other media types → not supported inline, must upload and use file_id
		return nil, fmt.Errorf("unsupported media type '%s' (must be uploaded to Files API and sent as file_id)", part.MimeType)
	}
}

// ConvertToUIMessage converts an anthropicChatMessage to a UIMessage
func (m *anthropicChatMessage) ConvertToUIMessage() *uctypes.UIMessage {
	var parts []uctypes.UIMessagePart

	// Iterate over all content blocks
	for _, block := range m.Content {
		switch block.Type {
		case "text":
			// Convert text blocks to UIMessagePart
			parts = append(parts, uctypes.UIMessagePart{
				Type: "text",
				Text: block.Text,
			})
		case "image":
			// Convert image blocks to data-userfile UIMessagePart (only for user role)
			if m.Role == "user" && block.Source != nil {
				parts = append(parts, uctypes.UIMessagePart{
					Type: "data-userfile",
					Data: uctypes.UIMessageDataUserFile{
						FileName:   block.Source.FileName,
						Size:       block.Source.Size,
						MimeType:   block.Source.MediaType,
						PreviewUrl: block.SourcePreviewUrl,
					},
				})
			}
		case "document":
			// Convert document blocks to data-userfile UIMessagePart (only for user role)
			if m.Role == "user" && block.Source != nil {
				parts = append(parts, uctypes.UIMessagePart{
					Type: "data-userfile",
					Data: uctypes.UIMessageDataUserFile{
						FileName:   block.Source.FileName,
						Size:       block.Source.Size,
						MimeType:   block.Source.MediaType,
						PreviewUrl: block.SourcePreviewUrl,
					},
				})
			}
		case "tool_use":
			// Convert tool_use blocks to tool UIMessagePart with input-available state
			if block.Name != "" && block.ID != "" {
				parts = append(parts, uctypes.UIMessagePart{
					Type:       "tool-" + block.Name,
					State:      "input-available",
					ToolCallID: block.ID,
					Input:      block.Input,
				})
			}
		default:
			// For now, skip all other types (will implement later)
			continue
		}
	}

	if len(parts) == 0 {
		return nil
	}

	return &uctypes.UIMessage{
		ID:    m.MessageId,
		Role:  m.Role,
		Parts: parts,
	}
}

// convertMessageForAPI creates a copy of the anthropicInputMessage with internal fields stripped from content blocks
func convertMessageForAPI(msg anthropicInputMessage) anthropicInputMessage {
	// Create a copy of the message
	converted := anthropicInputMessage{
		Role:    msg.Role,
		Content: make([]anthropicMessageContentBlock, len(msg.Content)),
	}

	// Copy each content block and clean it (strips internal fields)
	for i, block := range msg.Content {
		converted.Content[i] = *block.Clean()
	}

	return converted
}

// ConvertToolResultsToAnthropicChatMessage converts AIToolResult slice to anthropicChatMessage
func ConvertToolResultsToAnthropicChatMessage(toolResults []uctypes.AIToolResult) (*anthropicChatMessage, error) {
	if len(toolResults) == 0 {
		return nil, errors.New("toolResults cannot be empty")
	}

	var contentBlocks []anthropicMessageContentBlock

	for _, result := range toolResults {
		if result.ToolUseID == "" {
			return nil, fmt.Errorf("tool result missing ToolUseID")
		}

		var content interface{}
		var isError bool

		if result.ErrorText != "" {
			content = result.ErrorText
			isError = true
		} else {
			// Check if text looks like an image data URL
			if strings.HasPrefix(result.Text, "data:image/") {
				// Parse the data URL to extract media type and base64 data
				parts := strings.SplitN(result.Text, ",", 2)
				if len(parts) == 2 {
					// Extract media type from "data:image/png;base64"
					mediaTypePart := strings.TrimPrefix(parts[0], "data:")
					mediaType := strings.Split(mediaTypePart, ";")[0]

					// Create content as array with image block
					content = []anthropicMessageContentBlock{
						{
							Type: "image",
							Source: &anthropicSource{
								Type:      "base64",
								Data:      parts[1],
								MediaType: mediaType,
							},
						},
					}
					isError = false
				} else {
					// Failed to parse data URL
					content = "failed to parse image data URL"
					isError = true
				}
			} else {
				content = result.Text
				isError = false
			}
		}

		contentBlocks = append(contentBlocks, anthropicMessageContentBlock{
			Type:      "tool_result",
			ToolUseID: result.ToolUseID,
			Content:   content,
			IsError:   isError,
		})
	}

	return &anthropicChatMessage{
		MessageId: uuid.New().String(),
		Role:      "user",
		Content:   contentBlocks,
	}, nil
}

// ConvertAIChatToUIChat converts an AIChat to a UIChat for Anthropic
func ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	if aiChat.APIType != "anthropic" {
		return nil, fmt.Errorf("APIType must be 'anthropic', got '%s'", aiChat.APIType)
	}

	uiMessages := make([]uctypes.UIMessage, 0, len(aiChat.NativeMessages))

	for i, nativeMsg := range aiChat.NativeMessages {
		anthropicMsg, ok := nativeMsg.(*anthropicChatMessage)
		if !ok {
			return nil, fmt.Errorf("message %d: expected *anthropicChatMessage, got %T", i, nativeMsg)
		}

		uiMsg := anthropicMsg.ConvertToUIMessage()
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
