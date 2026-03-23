// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiplan

import (
	"encoding/json"
	"net/http"
)

// HandlePlanStatus handles GET /wave/plan/status?tabid=...
func HandlePlanStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tabId := r.URL.Query().Get("tabid")
	if tabId == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"plan": nil})
		return
	}

	plan := GetPlan(tabId)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"plan": plan})
}

// HandlePlanDelete handles GET /wave/plan/delete?tabid=...
func HandlePlanDelete(w http.ResponseWriter, r *http.Request) {
	tabId := r.URL.Query().Get("tabid")
	if tabId != "" {
		DeletePlan(tabId)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
