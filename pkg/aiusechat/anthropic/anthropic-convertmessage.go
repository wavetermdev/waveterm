// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package anthropic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

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
		bs, _ := json.Marshal(blocks)
		aim.Content = bs
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

// convertPartsToAnthropicBlocks converts UseChatMessagePart array to Anthropic content blocks with role-based validation
func convertPartsToAnthropicBlocks(parts []uctypes.UIMessagePart, role string) ([]interface{}, error) {
	var blocks []interface{}

	for _, p := range parts {
		pType := strings.ToLower(p.Type)

		if pType == "text" {
			blocks = append(blocks, map[string]interface{}{
				"type": "text",
				"text": p.Text,
			})
		} else if pType == "image" {
			// Anthropic expects images in user messages
			if role != "user" {
				log.Printf("anthropic: dropping image part in %s message (images should be in user messages)", role)
				continue
			}
			if p.Source == nil {
				return nil, errors.New("image part missing source")
			}
			block, err := convertSourcePart(p)
			if err != nil {
				return nil, err
			}
			blocks = append(blocks, block)
		} else if strings.HasPrefix(pType, "tool-") {
			// Handle Vercel spec tool types: "tool-{name}"
			if role != "assistant" {
				log.Printf("anthropic: dropping tool part in %s message (tool parts should be in assistant messages)", role)
				continue
			}
			// Extract tool name from type field (format: "tool-{name}")
			toolName := strings.TrimPrefix(pType, "tool-")
			block := map[string]interface{}{
				"type": "tool_use",
				"id":   p.ToolCallID,
				"name": toolName,
			}
			if p.Input != nil {
				block["input"] = p.Input
			}
			blocks = append(blocks, block)
		} else {
			// Log and skip unknown part types
			log.Printf("anthropic: dropping unknown part type '%s'", p.Type)
		}
	}

	return blocks, nil
}

// convertSourcePart converts an image or document part to Anthropic block format
func convertSourcePart(p uctypes.UIMessagePart) (map[string]interface{}, error) {
	if p.Source == nil {
		return nil, fmt.Errorf("%s part missing source", p.Type)
	}

	source := map[string]interface{}{
		"type": p.Source.Type,
	}

	switch p.Source.Type {
	case "url":
		if p.Source.URL == "" {
			return nil, fmt.Errorf("%s source type 'url' requires url field", p.Type)
		}
		source["url"] = p.Source.URL

	case "base64":
		if p.Source.Data == "" {
			return nil, fmt.Errorf("%s source type 'base64' requires data field", p.Type)
		}
		if p.Source.MediaType == "" {
			return nil, fmt.Errorf("%s source type 'base64' requires media_type field", p.Type)
		}
		source["data"] = p.Source.Data
		source["media_type"] = p.Source.MediaType

	case "file":
		if p.Source.FileID == "" {
			return nil, fmt.Errorf("%s source type 'file' requires file_id field", p.Type)
		}
		source["file_id"] = p.Source.FileID

	default:
		return nil, fmt.Errorf("unsupported %s source type: %s", p.Type, p.Source.Type)
	}

	return map[string]interface{}{
		"type":   p.Type,
		"source": source,
	}, nil
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
