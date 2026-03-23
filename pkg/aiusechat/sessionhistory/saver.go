// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionhistory

import (
	"log"
	"strings"

	"github.com/woveterm/wove/pkg/aiusechat/uctypes"
)

// ExtractSimpleMessages converts UIMessages to SimpleChatMessages for history storage.
func ExtractSimpleMessages(messages []uctypes.UIMessage) []SimpleChatMessage {
	var result []SimpleChatMessage
	for _, msg := range messages {
		role := msg.Role
		if role != "user" && role != "assistant" {
			continue
		}

		var text string
		var toolUse string
		for _, part := range msg.Parts {
			if part.Type == uctypes.AIMessagePartTypeText {
				if text == "" {
					text = part.Text
				}
			} else if strings.HasPrefix(part.Type, "tool-") {
				toolUse = strings.TrimPrefix(part.Type, "tool-")
			}
		}

		if text == "" && toolUse == "" {
			continue
		}

		result = append(result, SimpleChatMessage{
			Role:    role,
			Text:    text,
			ToolUse: toolUse,
		})
	}
	return result
}

// SaveChatAsHistory saves the given UIChat as session history for a tab.
func SaveChatAsHistory(tabId string, uiChat *uctypes.UIChat) {
	if uiChat == nil || len(uiChat.Messages) == 0 {
		return
	}
	messages := ExtractSimpleMessages(uiChat.Messages)
	if len(messages) == 0 {
		return
	}
	if err := SaveSessionHistory(tabId, uiChat.Model, messages); err != nil {
		log.Printf("[sessionhistory] error saving history for tab %s: %v\n", tabId, err)
	}
}

// SaveAllCallback is set by usechat package to avoid circular imports.
// It should convert all chats in chatstore to UIChat and save them.
var SaveAllCallback func()

// SaveAll calls the registered callback to save all active chats.
func SaveAll() {
	if SaveAllCallback != nil {
		SaveAllCallback()
	}
}
