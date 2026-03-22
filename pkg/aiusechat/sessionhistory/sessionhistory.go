// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionhistory

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/woveterm/wove/pkg/wavebase"
)

const (
	historyDirName    = "session-history"
	maxMessageLen     = 500
	maxMessagesPerLog = 30
)

// SessionEntry represents a single message in the session history.
type SessionEntry struct {
	Role    string `json:"role"`    // "user" or "assistant"
	Text    string `json:"text"`    // truncated message content
	ToolUse string `json:"tool,omitempty"` // tool name if this was a tool call
}

// SessionLog represents the saved history for one tab's last session.
type SessionLog struct {
	TabId     string         `json:"tabId"`
	Timestamp string         `json:"timestamp"`
	Model     string         `json:"model,omitempty"`
	Entries   []SessionEntry `json:"entries"`
}

func getHistoryDir() string {
	return filepath.Join(wavebase.GetWaveDataDir(), historyDirName)
}

func getHistoryFilePath(tabId string) string {
	return filepath.Join(getHistoryDir(), tabId+".json")
}

// SaveSessionHistory saves a condensed version of the chat for the given tab.
// Call this when a chat is cleared or when Wave shuts down.
func SaveSessionHistory(tabId string, model string, messages []SimpleChatMessage) error {
	if len(messages) == 0 {
		return nil
	}

	dir := getHistoryDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating history dir: %w", err)
	}

	entries := make([]SessionEntry, 0, maxMessagesPerLog)
	for _, msg := range messages {
		if len(entries) >= maxMessagesPerLog {
			break
		}
		entry := SessionEntry{
			Role:    msg.Role,
			Text:    truncate(msg.Text, maxMessageLen),
			ToolUse: msg.ToolUse,
		}
		if entry.Text == "" && entry.ToolUse == "" {
			continue
		}
		entries = append(entries, entry)
	}

	if len(entries) == 0 {
		return nil
	}

	sessionLog := SessionLog{
		TabId:     tabId,
		Timestamp: time.Now().Format(time.RFC3339),
		Model:     model,
		Entries:   entries,
	}

	data, err := json.MarshalIndent(sessionLog, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling session history: %w", err)
	}

	if err := os.WriteFile(getHistoryFilePath(tabId), data, 0644); err != nil {
		return fmt.Errorf("writing session history: %w", err)
	}

	log.Printf("[sessionhistory] saved %d entries for tab %s\n", len(entries), tabId[:8])
	return nil
}

// LoadSessionHistory loads the previous session's history for the given tab.
// Returns empty string if no history exists.
func LoadSessionHistory(tabId string) string {
	data, err := os.ReadFile(getHistoryFilePath(tabId))
	if err != nil {
		return ""
	}

	var sessionLog SessionLog
	if err := json.Unmarshal(data, &sessionLog); err != nil {
		return ""
	}

	if len(sessionLog.Entries) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("<previous_session>\n")
	sb.WriteString(fmt.Sprintf("Last session: %s\n", sessionLog.Timestamp))
	if sessionLog.Model != "" {
		sb.WriteString(fmt.Sprintf("Model: %s\n", sessionLog.Model))
	}
	sb.WriteString("\n")

	for _, entry := range sessionLog.Entries {
		switch entry.Role {
		case "user":
			sb.WriteString(fmt.Sprintf("User: %s\n", entry.Text))
		case "assistant":
			if entry.ToolUse != "" {
				sb.WriteString(fmt.Sprintf("AI [tool: %s]: %s\n", entry.ToolUse, entry.Text))
			} else {
				sb.WriteString(fmt.Sprintf("AI: %s\n", entry.Text))
			}
		}
	}

	sb.WriteString("</previous_session>")
	return sb.String()
}

// DeleteSessionHistory removes the history file for the given tab.
func DeleteSessionHistory(tabId string) {
	os.Remove(getHistoryFilePath(tabId))
}

// SimpleChatMessage is a simplified message for saving to history.
type SimpleChatMessage struct {
	Role    string
	Text    string
	ToolUse string
}

func truncate(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
