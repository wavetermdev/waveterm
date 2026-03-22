// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"github.com/wavetermdev/waveterm/pkg/aiusechat/sessionhistory"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func GetSessionHistoryToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "session_history",
		DisplayName:      "Previous Session History",
		Description:      "Read previous session's chat history (messages, tool calls, topics). Use when user references prior work.",
		ShortDescription: "Read previous session history",
		ToolLogName:      "session:history",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			return "reading previous session history"
		},
		ToolTextCallback: func(input any) (string, error) {
			history := sessionhistory.LoadSessionHistory(tabId)
			if history == "" {
				return "No previous session history found for this tab.", nil
			}
			return history, nil
		},
	}
}
