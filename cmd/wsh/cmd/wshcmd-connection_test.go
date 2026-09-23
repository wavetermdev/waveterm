// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestConnectionEntryFromStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   wshrpc.ConnStatus
		wantName string
		wantConn bool
		wantWsh  bool
		wantErr  string
	}{
		{
			name: "connected with wsh",
			status: wshrpc.ConnStatus{
				Connection: "ssh://host",
				Connected:  true,
				Status:     "connected",
				WshEnabled: true,
				Error:      "",
			},
			wantName: "ssh://host",
			wantConn: true,
			wantWsh:  true,
			wantErr:  "",
		},
		{
			name: "disconnected with error",
			status: wshrpc.ConnStatus{
				Connection: "ssh://broken",
				Connected:  false,
				Status:     "disconnected",
				WshEnabled: false,
				Error:      "timeout",
			},
			wantName: "ssh://broken",
			wantConn: false,
			wantWsh:  false,
			wantErr:  "timeout",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			entry := connectionEntryFromStatus(tt.status)
			if entry.Name != tt.wantName {
				t.Errorf("Name = %q, want %q", entry.Name, tt.wantName)
			}
			if entry.Connected != tt.wantConn {
				t.Errorf("Connected = %v, want %v", entry.Connected, tt.wantConn)
			}
			if entry.Status != tt.status.Status {
				t.Errorf("Status = %q, want %q", entry.Status, tt.status.Status)
			}
			if entry.WshEnabled != tt.wantWsh {
				t.Errorf("WshEnabled = %v, want %v", entry.WshEnabled, tt.wantWsh)
			}
			if entry.Error != tt.wantErr {
				t.Errorf("Error = %q, want %q", entry.Error, tt.wantErr)
			}
		})
	}
}

func TestConnectionListEntryJSONShape(t *testing.T) {
	entry := connectionListEntry{
		Name:       "ssh://host",
		Connected:  true,
		Status:     "connected",
		WshEnabled: true,
	}
	barr, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(barr, &m); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	for _, key := range []string{"name", "connected", "status", "wshenabled"} {
		if _, ok := m[key]; !ok {
			t.Errorf("JSON missing key %q: %s", key, string(barr))
		}
	}
	if _, ok := m["error"]; ok {
		t.Errorf("JSON should omit %q when empty: %s", "error", string(barr))
	}

	entry.Error = "boom"
	barr, err = json.Marshal(entry)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if !strings.Contains(string(barr), `"error":"boom"`) {
		t.Errorf("JSON missing error field when set: %s", string(barr))
	}
}
