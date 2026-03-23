// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionhistory

import (
	"encoding/json"
	"net/http"
	"os"
)

// HandleSessionHistory handles GET /wave/session-history?tabid=...
func HandleSessionHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tabId := r.URL.Query().Get("tabid")
	if tabId == "" {
		writeEmptyResponse(w)
		return
	}

	fileData, err := os.ReadFile(getHistoryFilePath(tabId))
	if err != nil {
		writeEmptyResponse(w)
		return
	}

	var sessionLog SessionLog
	if err := json.Unmarshal(fileData, &sessionLog); err != nil {
		writeEmptyResponse(w)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessionLog)
}

func writeEmptyResponse(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"entries": nil})
}
