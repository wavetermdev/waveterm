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

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// these conversions are based off the anthropic spec
// and the aiprompts/aisdk-uimessage-type.md doc (v5)

// buildAnthropicHTTPRequest creates a complete HTTP request for the Anthropic API
func buildAnthropicHTTPRequest(ctx context.Context, opts *uctypes.AIOptsType, msgs []uctypes.UIMessage, tools []uctypes.ToolDefinition) (*http.Request, error) {
	if opts == nil {
		return nil, errors.New("opts is nil")
	}
	if opts.APIToken == "" {
		return nil, errors.New("Anthropic API token missing")
	}
	if opts.Model == "" {
		return nil, errors.New("opts.model is required")
	}

	// Set defaults
	baseURL := opts.BaseURL
	if baseURL == "" {
		baseURL = AnthropicDefaultBaseURL
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/messages"

	apiVersion := opts.APIVersion
	if apiVersion == "" {
		apiVersion = AnthropicDefaultAPIVersion
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = AnthropicDefaultMaxTokens
	}

	// Build request body
	reqBody := &anthropicStreamRequest{
		Model:     opts.Model,
		MaxTokens: maxTokens,
		Stream:    true,
	}
	if len(tools) > 0 {
		reqBody.Tools = tools
	}

	// Enable extended thinking based on level
	reqBody.Thinking = makeThinkingOpts(opts.ThinkingLevel, maxTokens)

	for _, m := range msgs {
		aim := anthropicInputMessage{Role: m.Role}
		blocks, err := convertPartsToAnthropicBlocks(m.Parts, m.Role)
		if err != nil {
			return nil, fmt.Errorf("invalid message parts: %w", err)
		}
		aim.Content = blocks
		reqBody.Messages = append(reqBody.Messages, aim)
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", opts.APIToken)
	req.Header.Set("anthropic-version", apiVersion)
	req.Header.Set("accept", "text/event-stream")

	return req, nil
}

// convertToolUsePart converts a tool-* type UIMessagePart to an Anthropic tool_use block
func convertToolUsePart(p uctypes.UIMessagePart, role string) (*anthropicMessageContentBlock, error) {
	if role != "assistant" {
		return nil, fmt.Errorf("dropping tool part in %s message (tool parts should be in assistant messages)", role)
	}
	
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
}

// convertPartToAnthropicBlocks converts a single UIMessagePart to one or more Anthropic content blocks
func convertPartToAnthropicBlocks(p uctypes.UIMessagePart, role string, blockIndex int) ([]anthropicMessageContentBlock, error) {
	if p.Type == "text" {
		return []anthropicMessageContentBlock{{
			Type: "text",
			Text: p.Text,
		}}, nil
	} else if p.Type == "reasoning" {
		return []anthropicMessageContentBlock{{
			Type: "text",
			Text: p.Text,
		}}, nil
	} else if p.Type == "source-url" || p.Type == "source-document" {
		return convertSourceToAnthropicBlocks(p, blockIndex)
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
		block, err := convertToolUsePart(p, role)
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
					Type: "text",
					Data: string(textData),
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

// convertToolResultPart converts a tool_result part to Anthropic tool_result block format
func convertToolResultPart(p uctypes.UIMessagePart) (map[string]interface{}, error) {
	if p.ToolUseID == "" {
		return nil, errors.New("tool_result part missing tool_use_id")
	}

	block := map[string]interface{}{
		"type":        "tool_result",
		"tool_use_id": p.ToolUseID,
	}

	// Handle content field - can be string or array of content blocks
	if len(p.Content) == 0 {
		// No content blocks, use empty string
		block["content"] = ""
	} else if len(p.Content) == 1 && p.Content[0].Type == "text" {
		// Single text block - use string format
		block["content"] = p.Content[0].Text
	} else {
		// Multiple blocks or non-text - convert to Anthropic content block array
		var contentBlocks []interface{}
		for _, cb := range p.Content {
			switch cb.Type {
			case "text":
				contentBlocks = append(contentBlocks, map[string]interface{}{
					"type": "text",
					"text": cb.Text,
				})
			default:
				// For now, convert non-text content to text representation
				// This handles cases like tool output data
				text := ""
				if cb.Text != "" {
					text = cb.Text
				} else if cb.Data != nil {
					// Convert data to JSON string
					if jsonBytes, err := json.Marshal(cb.Data); err == nil {
						text = string(jsonBytes)
					}
				}
				contentBlocks = append(contentBlocks, map[string]interface{}{
					"type": "text",
					"text": text,
				})
			}
		}
		block["content"] = contentBlocks
	}

	// Add is_error if specified
	if p.IsError != nil {
		block["is_error"] = *p.IsError
	}

	return block, nil
}

// convertSourceToAnthropicBlocks converts source-url or source-document parts to Anthropic blocks
func convertSourceToAnthropicBlocks(p uctypes.UIMessagePart, blockIndex int) ([]anthropicMessageContentBlock, error) {
	var sourceBlock anthropicMessageContentBlock
	
	if p.Type == "source-url" {
		// Convert source-url to web_search_result block
		sourceBlock = anthropicMessageContentBlock{
			Type:  "web_search_result",
			URL:   p.URL,
			Title: p.Title,
		}
	} else if p.Type == "source-document" {
		// Convert source-document to document block
		sourceBlock = anthropicMessageContentBlock{
			Type:  "document",
			Title: p.Title,
			Source: &anthropicSource{
				Type:      "text", // assuming text content for now
				MediaType: p.MediaType,
			},
		}
	} else {
		return nil, fmt.Errorf("convertSourceToAnthropicBlocks expects 'source-url' or 'source-document', got '%s'", p.Type)
	}
	
	// Create citation text block pointing to the source block
	citationBlock := anthropicMessageContentBlock{
		Type: "text",
		Text: "",
		Citations: []anthropicCitation{{
			Type:          "source",
			DocumentIndex: blockIndex,
			DocumentTitle: p.Title,
		}},
	}
	
	return []anthropicMessageContentBlock{sourceBlock, citationBlock}, nil
}
