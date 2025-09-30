// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/anthropic"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// CombineConsecutiveSameRoleMessages combines consecutive UIMessages with the same role
// by appending their Parts together. This is useful for APIs like OpenAI that may split
// assistant messages into separate messages (e.g., one for text and one for tool calls).
func CombineConsecutiveSameRoleMessages(uiChat *uctypes.UIChat) *uctypes.UIChat {
	if uiChat == nil || len(uiChat.Messages) == 0 {
		return uiChat
	}

	combined := make([]uctypes.UIMessage, 0, len(uiChat.Messages))
	var current *uctypes.UIMessage

	for i := range uiChat.Messages {
		msg := &uiChat.Messages[i]

		if current == nil {
			// First message - start a new combined message
			current = &uctypes.UIMessage{
				ID:       msg.ID,
				Role:     msg.Role,
				Metadata: msg.Metadata,
				Parts:    make([]uctypes.UIMessagePart, len(msg.Parts)),
			}
			copy(current.Parts, msg.Parts)
			continue
		}

		if current.Role == msg.Role {
			// Same role - append parts to current message
			current.Parts = append(current.Parts, msg.Parts...)
		} else {
			// Different role - save current and start new
			combined = append(combined, *current)
			current = &uctypes.UIMessage{
				ID:       msg.ID,
				Role:     msg.Role,
				Metadata: msg.Metadata,
				Parts:    make([]uctypes.UIMessagePart, len(msg.Parts)),
			}
			copy(current.Parts, msg.Parts)
		}
	}

	// Don't forget the last message
	if current != nil {
		combined = append(combined, *current)
	}

	return &uctypes.UIChat{
		ChatId:     uiChat.ChatId,
		APIType:    uiChat.APIType,
		Model:      uiChat.Model,
		APIVersion: uiChat.APIVersion,
		Messages:   combined,
	}
}


// ConvertAIChatToUIChat converts an AIChat to a UIChat by routing to the appropriate
// provider-specific converter based on APIType, then combining consecutive same-role messages.
func ConvertAIChatToUIChat(aiChat *uctypes.AIChat) (*uctypes.UIChat, error) {
	if aiChat == nil {
		return nil, nil
	}

	var uiChat *uctypes.UIChat
	var err error

	switch aiChat.APIType {
	case "openai":
		uiChat, err = openai.ConvertAIChatToUIChat(*aiChat)
	case "anthropic":
		uiChat, err = anthropic.ConvertAIChatToUIChat(*aiChat)
	default:
		return nil, fmt.Errorf("unsupported APIType: %s", aiChat.APIType)
	}

	if err != nil {
		return nil, err
	}

	return CombineConsecutiveSameRoleMessages(uiChat), nil
}
