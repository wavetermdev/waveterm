// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"net/http"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatgpt"
)

func handleChatGPT(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		if r.URL.Query().Get("models") == "true" {
			models, err := aiusechat.ListCodexModels(r.Context())
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			json.NewEncoder(w).Encode(models)
			return
		}
		status, err := chatgpt.Default.Status()
		if err != nil {
			http.Error(w, err.Error(), 503)
			return
		}
		json.NewEncoder(w).Encode(status)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Action  string `json:"action"`
		Account string `json:"account"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil {
		http.Error(w, "Invalid request", 400)
		return
	}
	var err error
	switch req.Action {
	case "signin":
		err = chatgpt.Default.SignIn(req.Account)
	case "select":
		err = chatgpt.Default.Select(req.Account)
	case "signout":
		err = chatgpt.Default.SignOut(r.Context(), req.Account)
	case "cancel":
		chatgpt.Default.CancelLogin()
	default:
		http.Error(w, "Unknown account action", 400)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
