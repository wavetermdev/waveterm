// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionhistory

import "sync"

// chatTabRegistry maps chatId → tabId so we can save history per-tab at shutdown.
var (
	chatTabMap   = make(map[string]string)
	chatTabMapMu sync.Mutex
)

// RegisterChatTab records which tab a chat belongs to.
func RegisterChatTab(chatId string, tabId string) {
	if chatId == "" || tabId == "" {
		return
	}
	chatTabMapMu.Lock()
	defer chatTabMapMu.Unlock()
	chatTabMap[chatId] = tabId
}

// GetTabForChat returns the tabId for a chatId, or empty string if not found.
func GetTabForChat(chatId string) string {
	chatTabMapMu.Lock()
	defer chatTabMapMu.Unlock()
	return chatTabMap[chatId]
}

// GetAllMappings returns a copy of all chatId→tabId mappings.
func GetAllMappings() map[string]string {
	chatTabMapMu.Lock()
	defer chatTabMapMu.Unlock()
	result := make(map[string]string, len(chatTabMap))
	for k, v := range chatTabMap {
		result[k] = v
	}
	return result
}
