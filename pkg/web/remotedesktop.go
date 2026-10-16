// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"net/http"

	"github.com/wavetermdev/waveterm/pkg/remotedesktop"
)

func handleRemoteDesktop(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		json.NewEncoder(w).Encode(remotedesktop.Default.Sessions())
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Action   string                `json:"action"`
		Profile  remotedesktop.Profile `json:"profile"`
		Password string                `json:"password"`
		ID       string                `json:"id"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req) != nil {
		http.Error(w, "Invalid desktop request", 400)
		return
	}
	if req.Action == "stop" {
		if err := remotedesktop.Default.Stop(req.ID); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	}
	if req.Action != "connect" {
		http.Error(w, "Unknown desktop action", 400)
		return
	}
	s, err := remotedesktop.Default.Start(req.Profile, req.Password)
	req.Password = ""
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	json.NewEncoder(w).Encode(s)
}
