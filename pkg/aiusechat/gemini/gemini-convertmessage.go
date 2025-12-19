// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gemini

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// cleanSchemaForGemini removes fields from JSON Schema that Gemini doesn't accept
// Gemini uses a strict subset of JSON Schema and rejects fields like $schema, units, title, etc.
func cleanSchemaForGemini(schema map[string]any) map[string]any {
	if schema == nil {
		return nil
	}

	cleaned := make(map[string]any)

	// Fields that Gemini accepts in the root schema
	allowedRootFields := map[string]bool{
		"type":        true,
		"properties":  true,
		"required":    true,
		"description": true,
		"items":       true,
		"enum":        true,
		"format":      true,
		"minimum":     true,
		"maximum":     true,
		"pattern":     true,
		"default":     true,
	}

	for key, value := range schema {
		if !allowedRootFields[key] {
			// Skip fields like $schema, title, units, definitions, $ref, etc.
			continue
		}

		// Recursively clean nested schemas
		switch key {
		case "properties":
			if props, ok := value.(map[string]any); ok {
				cleanedProps := make(map[string]any)
				for propName, propValue := range props {
					if propSchema, ok := propValue.(map[string]any); ok {
						cleanedProps[propName] = cleanSchemaForGemini(propSchema)
					} else {
						// Preserve non-map property values
						cleanedProps[propName] = propValue
					}
				}
				cleaned[key] = cleanedProps
			}
		case "items":
			if items, ok := value.(map[string]any); ok {
				cleaned[key] = cleanSchemaForGemini(items)
			} else {
				cleaned[key] = value
			}
		default:
			cleaned[key] = value
		}
	}

	return cleaned
}

// ConvertToolDefinitionToGemini converts a Wave ToolDefinition to Gemini format
func ConvertToolDefinitionToGemini(tool uctypes.ToolDefinition) GeminiFunctionDeclaration {
	// Clean the schema to remove fields that Gemini doesn't accept
	cleanedSchema := cleanSchemaForGemini(tool.InputSchema)

	return GeminiFunctionDeclaration{
		Name:        tool.Name,
		Description: tool.Description,
		Parameters:  cleanedSchema,
	}
}

// convertFileAIMessagePart converts a file AIMessagePart to Gemini format
func convertFileAIMessagePart(part uctypes.AIMessagePart) (*GeminiMessagePart, error) {
	if part.Type != uctypes.AIMessagePartTypeFile {
		return nil, fmt.Errorf("convertFileAIMessagePart expects 'file' type, got '%s'", part.Type)
	}
	if part.MimeType == "" {
		return nil, fmt.Errorf("file part missing mimetype")
	}

	// Handle different file types
	switch {
	case strings.HasPrefix(part.MimeType, "image/"):
		// For images, we need base64 data
		var base64Data string
		if len(part.Data) > 0 {
			base64Data = base64.StdEncoding.EncodeToString(part.Data)
		} else if part.URL != "" {
			// If URL is provided, it should be a data URL
			if strings.HasPrefix(part.URL, "data:") {
				// Extract base64 data from data URL
				parts := strings.SplitN(part.URL, ",", 2)
				if len(parts) == 2 {
					base64Data = parts[1]
				} else {
					return nil, fmt.Errorf("invalid data URL format")
				}
			} else {
				return nil, fmt.Errorf("dropping image with non-data URL (must be fetched and converted to base64)")
			}
		} else {
			return nil, fmt.Errorf("image file part missing data")
		}

		return &GeminiMessagePart{
			InlineData: &GeminiInlineData{
				MimeType: part.MimeType,
				Data:     base64Data,
			},
			FileName:   part.FileName,
			PreviewUrl: part.PreviewUrl,
		}, nil

	case part.MimeType == "application/pdf":
		// Handle PDFs - Gemini supports base64 data for PDFs
		if len(part.Data) == 0 {
			if part.URL != "" {
				return nil, fmt.Errorf("dropping PDF with URL (must be fetched and converted to base64 data)")
			}
			return nil, fmt.Errorf("PDF file part missing data")
		}

		// Convert raw data to base64
		base64Data := base64.StdEncoding.EncodeToString(part.Data)

		return &GeminiMessagePart{
			InlineData: &GeminiInlineData{
				MimeType: "application/pdf",
				Data:     base64Data,
			},
			FileName:   part.FileName,
			PreviewUrl: part.PreviewUrl,
		}, nil

	case part.MimeType == "text/plain":
		textData, err := aiutil.ExtractTextData(part.Data, part.URL)
		if err != nil {
			return nil, err
		}
		formattedText := aiutil.FormatAttachedTextFile(part.FileName, textData)
		return &GeminiMessagePart{
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
		return &GeminiMessagePart{
			Text: formattedText,
		}, nil

	default:
		return nil, fmt.Errorf("dropping file with unsupported mimetype '%s' (Gemini supports images, PDFs, text/plain, and directories)", part.MimeType)
	}
}

// ConvertAIMessageToGeminiChatMessage converts an AIMessage to GeminiChatMessage
// These messages are ALWAYS role "user"
func ConvertAIMessageToGeminiChatMessage(aiMsg uctypes.AIMessage) (*GeminiChatMessage, error) {
	if err := aiMsg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid AIMessage: %w", err)
	}

	var parts []GeminiMessagePart

	for i, part := range aiMsg.Parts {
		switch part.Type {
		case uctypes.AIMessagePartTypeText:
			if part.Text == "" {
				return nil, fmt.Errorf("part %d: text type requires non-empty text field", i)
			}
			parts = append(parts, GeminiMessagePart{
				Text: part.Text,
			})

		case uctypes.AIMessagePartTypeFile:
			geminiPart, err := convertFileAIMessagePart(part)
			if err != nil {
				log.Printf("gemini: %v", err)
				continue
			}
			parts = append(parts, *geminiPart)

		default:
			// Drop unknown part types
			log.Printf("gemini: dropping unknown part type '%s'", part.Type)
			continue
		}
	}

	return &GeminiChatMessage{
		MessageId: aiMsg.MessageId,
		Role:      "user",
		Parts:     parts,
	}, nil
}

// ConvertToolResultsToGeminiChatMessage converts AIToolResult slice to GeminiChatMessage
func ConvertToolResultsToGeminiChatMessage(toolResults []uctypes.AIToolResult) (*GeminiChatMessage, error) {
	if len(toolResults) == 0 {
		return nil, fmt.Errorf("toolResults cannot be empty")
	}

	var parts []GeminiMessagePart

	for _, result := range toolResults {
		if result.ToolUseID == "" {
			return nil, fmt.Errorf("tool result missing ToolUseID")
		}

		response := make(map[string]any)
		var nestedParts []GeminiMessagePart

		if result.ErrorText != "" {
			response["ok"] = false
			response["error"] = result.ErrorText
		} else if strings.HasPrefix(result.Text, "data:") {
			mimeType, base64Data, err := utilfn.DecodeDataURL(result.Text)
			if err != nil {
				log.Printf("gemini: failed to decode data URL in tool result: %v\n", err)
				response["ok"] = false
				response["error"] = fmt.Sprintf("failed to decode data URL: %v", err)
			} else if strings.HasPrefix(mimeType, "image/") {
				// For image data URLs, use multimodal function response (Gemini 3 Pro+)
				displayName := fmt.Sprintf("result_%s.%s", result.ToolUseID[:8], strings.TrimPrefix(mimeType, "image/"))
				response["ok"] = true
				response["image"] = map[string]string{"$ref": displayName}

				// Add the image data as a nested part
				nestedParts = append(nestedParts, GeminiMessagePart{
					InlineData: &GeminiInlineData{
						MimeType:    mimeType,
						Data:        base64.StdEncoding.EncodeToString(base64Data),
						DisplayName: displayName,
					},
				})
			} else {
				log.Printf("gemini: unsupported data URL mimetype in tool result: %s\n", mimeType)
				response["ok"] = false
				response["error"] = fmt.Sprintf("unsupported data URL mimetype: %s", mimeType)
			}
		} else {
			response["ok"] = true
			response["result"] = result.Text
		}

		parts = append(parts, GeminiMessagePart{
			FunctionResponse: &GeminiFunctionResponse{
				Name:     result.ToolName,
				Response: response,
				Parts:    nestedParts,
			},
		})
	}

	return &GeminiChatMessage{
		MessageId: uuid.New().String(),
		Role:      "user", // Function responses are sent as user messages
		Parts:     parts,
	}, nil
}

// convertContentPartToUIPart converts a Gemini content part to UIMessagePart
func convertContentPartToUIPart(part GeminiMessagePart, role string) []uctypes.UIMessagePart {
	var uiParts []uctypes.UIMessagePart

	if part.Text != "" {
		if found, dataPart := aiutil.ConvertDataUserFile(part.Text); found {
			if dataPart != nil {
				uiParts = append(uiParts, *dataPart)
			}
		} else {
			uiParts = append(uiParts, uctypes.UIMessagePart{
				Type: "text",
				Text: part.Text,
			})
		}
	}

	if part.InlineData != nil && role == "user" {
		// Show uploaded files in user messages
		var mimeType string
		if strings.HasPrefix(part.InlineData.MimeType, "image/") {
			mimeType = "image/*"
		} else {
			mimeType = part.InlineData.MimeType
		}

		uiParts = append(uiParts, uctypes.UIMessagePart{
			Type: "data-userfile",
			Data: uctypes.UIMessageDataUserFile{
				FileName:   part.FileName,
				MimeType:   mimeType,
				PreviewUrl: part.PreviewUrl,
			},
		})
	}

	// Tool use parts are handled separately by the backend
	if part.ToolUseData != nil {
		uiParts = append(uiParts, uctypes.UIMessagePart{
			Type: "data-tooluse",
			ID:   part.ToolUseData.ToolCallId,
			Data: *part.ToolUseData,
		})
	}

	return uiParts
}

// convertToUIMessage converts a GeminiChatMessage to a UIMessage
func (m *GeminiChatMessage) convertToUIMessage() *uctypes.UIMessage {
	var parts []uctypes.UIMessagePart

	for _, part := range m.Parts {
		// Skip function responses - they're not shown in UI
		if part.FunctionResponse != nil {
			continue
		}

		partUIParts := convertContentPartToUIPart(part, m.Role)
		parts = append(parts, partUIParts...)
	}

	if len(parts) == 0 {
		return nil
	}

	// Convert Gemini role to standard role
	role := m.Role
	if role == "model" {
		role = "assistant"
	}

	return &uctypes.UIMessage{
		ID:    m.MessageId,
		Role:  role,
		Parts: parts,
	}
}

// ConvertAIChatToUIChat converts an AIChat to a UIChat for Gemini
func ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	if aiChat.APIType != uctypes.APIType_GoogleGemini {
		return nil, fmt.Errorf("APIType must be '%s', got '%s'", uctypes.APIType_GoogleGemini, aiChat.APIType)
	}

	uiMessages := make([]uctypes.UIMessage, 0, len(aiChat.NativeMessages))
	for i, nativeMsg := range aiChat.NativeMessages {
		geminiMsg, ok := nativeMsg.(*GeminiChatMessage)
		if !ok {
			return nil, fmt.Errorf("message %d: expected *GeminiChatMessage, got %T", i, nativeMsg)
		}
		uiMsg := geminiMsg.convertToUIMessage()
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

// GetFunctionCallInputByToolCallId returns the function call input associated with the given tool call ID
func GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	for _, nativeMsg := range aiChat.NativeMessages {
		geminiMsg, ok := nativeMsg.(*GeminiChatMessage)
		if !ok {
			continue
		}
		for _, part := range geminiMsg.Parts {
			if part.FunctionCall != nil && part.ToolUseData != nil && part.ToolUseData.ToolCallId == toolCallId {
				// Convert args map to JSON string
				argsBytes, err := json.Marshal(part.FunctionCall.Args)
				if err != nil {
					log.Printf("gemini: error marshaling function call args: %v", err)
					continue
				}
				return &uctypes.AIFunctionCallInput{
					CallId:      toolCallId,
					Name:        part.FunctionCall.Name,
					Arguments:   string(argsBytes),
					ToolUseData: part.ToolUseData,
				}
			}
		}
	}
	return nil
}

// UpdateToolUseData updates the tool use data for a specific tool call in the chat
func UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return fmt.Errorf("chat not found: %s", chatId)
	}

	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*GeminiChatMessage)
		if !ok {
			continue
		}

		for i, part := range chatMsg.Parts {
			if part.FunctionCall != nil && part.ToolUseData != nil && part.ToolUseData.ToolCallId == toolCallId {
				// Update the message with new tool use data
				updatedMsg := &GeminiChatMessage{
					MessageId: chatMsg.MessageId,
					Role:      chatMsg.Role,
					Parts:     make([]GeminiMessagePart, len(chatMsg.Parts)),
					Usage:     chatMsg.Usage,
				}
				copy(updatedMsg.Parts, chatMsg.Parts)
				updatedMsg.Parts[i].ToolUseData = &toolUseData

				aiOpts := &uctypes.AIOptsType{
					APIType:    chat.APIType,
					Model:      chat.Model,
					APIVersion: chat.APIVersion,
				}

				return chatstore.DefaultChatStore.PostMessage(chatId, aiOpts, updatedMsg)
			}
		}
	}

	return fmt.Errorf("tool call with ID %s not found in chat %s", toolCallId, chatId)
}

func RemoveToolUseCall(chatId string, toolCallId string) error {
	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return fmt.Errorf("chat not found: %s", chatId)
	}

	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*GeminiChatMessage)
		if !ok {
			continue
		}

		partIndex := -1
		for i, part := range chatMsg.Parts {
			if part.FunctionCall != nil && part.ToolUseData != nil && part.ToolUseData.ToolCallId == toolCallId {
				partIndex = i
				break
			}
		}

		if partIndex == -1 {
			continue
		}

		updatedMsg := &GeminiChatMessage{
			MessageId: chatMsg.MessageId,
			Role:      chatMsg.Role,
			Parts:     slices.Delete(slices.Clone(chatMsg.Parts), partIndex, partIndex+1),
			Usage:     chatMsg.Usage,
		}

		if len(updatedMsg.Parts) == 0 {
			chatstore.DefaultChatStore.RemoveMessage(chatId, chatMsg.MessageId)
		} else {
			aiOpts := &uctypes.AIOptsType{
				APIType:    chat.APIType,
				Model:      chat.Model,
				APIVersion: chat.APIVersion,
			}
			chatstore.DefaultChatStore.PostMessage(chatId, aiOpts, updatedMsg)
		}
		return nil
	}

	return nil
}
