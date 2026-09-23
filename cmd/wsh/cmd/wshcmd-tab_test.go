// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestResolveTabRefFromList(t *testing.T) {
	idA := "11111111-1111-1111-1111-111111111111"
	idB := "22222222-2222-2222-2222-222222222222"
	idC := "33333333-3333-3333-3333-333333333333"
	tabs := []tabListEntry{
		{TabId: idA, Name: "Dev", Index: 0},
		{TabId: idB, Name: "Production", Index: 1},
		{TabId: idC, Name: "dev-scratch", Index: 2},
	}

	tests := []struct {
		name    string
		tabs    []tabListEntry
		ref     string
		want    string
		wantErr string
	}{
		{
			name: "exact uuid",
			tabs: tabs,
			ref:  idB,
			want: idB,
		},
		{
			name: "uuid case insensitive",
			tabs: tabs,
			ref:  strings.ToUpper(idA),
			want: idA,
		},
		{
			name:    "uuid not found",
			tabs:    tabs,
			ref:     "44444444-4444-4444-4444-444444444444",
			wantErr: "not found",
		},
		{
			name: "tab oref",
			tabs: tabs,
			ref:  "tab:" + idC,
			want: idC,
		},
		{
			name: "tab:1 is first tab",
			tabs: tabs,
			ref:  "tab:1",
			want: idA,
		},
		{
			name: "tab:2 is second tab",
			tabs: tabs,
			ref:  "tab:2",
			want: idB,
		},
		{
			name: "tab:3 is third tab",
			tabs: tabs,
			ref:  "tab:3",
			want: idC,
		},
		{
			name:    "tab:0 out of range",
			tabs:    tabs,
			ref:     "tab:0",
			wantErr: "out of range",
		},
		{
			name:    "tab:99 out of range",
			tabs:    tabs,
			ref:     "tab:99",
			wantErr: "out of range",
		},
		{
			name: "unique name substring",
			tabs: tabs,
			ref:  "prod",
			want: idB,
		},
		{
			name: "name case insensitive",
			tabs: tabs,
			ref:  "PRODUCTION",
			want: idB,
		},
		{
			name:    "ambiguous name lists matches",
			tabs:    tabs,
			ref:     "dev",
			wantErr: "ambiguous",
		},
		{
			name:    "empty name never matches",
			tabs:    []tabListEntry{{TabId: idA, Name: "", Index: 0}},
			ref:     "dev",
			wantErr: "no tab found",
		},
		{
			name:    "empty ref",
			tabs:    tabs,
			ref:     "  ",
			wantErr: "empty",
		},
		{
			name: "uuid wins over name",
			tabs: []tabListEntry{
				{TabId: idA, Name: idB, Index: 0},
				{TabId: idB, Name: "other", Index: 1},
			},
			ref:  idB,
			want: idB,
		},
		{
			name: "tab:N wins over matching name",
			tabs: []tabListEntry{
				{TabId: idA, Name: "tab:2", Index: 0},
				{TabId: idB, Name: "other", Index: 1},
			},
			ref:  "tab:2",
			want: idB,
		},
		{
			name:    "no match",
			tabs:    tabs,
			ref:     "staging",
			wantErr: "no tab found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveTabRefFromList(tt.tabs, tt.ref)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("resolveTabRefFromList(%q) expected error containing %q, got nil (id %s)", tt.ref, tt.wantErr, got)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("resolveTabRefFromList(%q) error = %q, want substring %q", tt.ref, err.Error(), tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolveTabRefFromList(%q) unexpected error: %v", tt.ref, err)
			}
			if got != tt.want {
				t.Fatalf("resolveTabRefFromList(%q) = %q, want %q", tt.ref, got, tt.want)
			}
		})
	}
}

func TestResolveTabRefFromListAmbiguousListsNames(t *testing.T) {
	idA := "11111111-1111-1111-1111-111111111111"
	idC := "33333333-3333-3333-3333-333333333333"
	tabs := []tabListEntry{
		{TabId: idA, Name: "Dev", Index: 0},
		{TabId: idC, Name: "dev-scratch", Index: 1},
	}
	_, err := resolveTabRefFromList(tabs, "dev")
	if err == nil {
		t.Fatal("expected ambiguous error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "Dev") || !strings.Contains(msg, "dev-scratch") {
		t.Fatalf("ambiguous error should list matching names, got %q", msg)
	}
	if !strings.Contains(msg, idA) || !strings.Contains(msg, idC) {
		t.Fatalf("ambiguous error should list matching ids, got %q", msg)
	}
}

func TestReorderTabIds(t *testing.T) {
	tests := []struct {
		name      string
		tabIds    []string
		oldIdx    int
		targetIdx int
		tabId     string
		expected  []string
	}{
		{
			name:      "move first to last",
			tabIds:    []string{"a", "b", "c", "d", "e"},
			oldIdx:    0,
			targetIdx: 4,
			tabId:     "a",
			expected:  []string{"b", "c", "d", "e", "a"},
		},
		{
			name:      "move last to first",
			tabIds:    []string{"a", "b", "c", "d", "e"},
			oldIdx:    4,
			targetIdx: 0,
			tabId:     "e",
			expected:  []string{"e", "a", "b", "c", "d"},
		},
		{
			name:      "move second to fourth (right)",
			tabIds:    []string{"a", "b", "c", "d", "e"},
			oldIdx:    1,
			targetIdx: 3,
			tabId:     "b",
			expected:  []string{"a", "c", "d", "b", "e"},
		},
		{
			name:      "move fourth to second (left)",
			tabIds:    []string{"a", "b", "c", "d", "e"},
			oldIdx:    3,
			targetIdx: 1,
			tabId:     "d",
			expected:  []string{"a", "d", "b", "c", "e"},
		},
		{
			name:      "move second to third (right by one)",
			tabIds:    []string{"a", "b", "c", "d", "e"},
			oldIdx:    1,
			targetIdx: 2,
			tabId:     "b",
			expected:  []string{"a", "c", "b", "d", "e"},
		},
		{
			name:      "move third to second (left by one)",
			tabIds:    []string{"a", "b", "c", "d", "e"},
			oldIdx:    2,
			targetIdx: 1,
			tabId:     "c",
			expected:  []string{"a", "c", "b", "d", "e"},
		},
		{
			name:      "two elements swap",
			tabIds:    []string{"x", "y"},
			oldIdx:    0,
			targetIdx: 1,
			tabId:     "x",
			expected:  []string{"y", "x"},
		},
		{
			name:      "move middle to end",
			tabIds:    []string{"a", "b", "c", "d", "e"},
			oldIdx:    2,
			targetIdx: 4,
			tabId:     "c",
			expected:  []string{"a", "b", "d", "e", "c"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Make a copy to avoid mutating the test input
			input := make([]string, len(tt.tabIds))
			copy(input, tt.tabIds)
			result := reorderTabIds(input, tt.oldIdx, tt.targetIdx, tt.tabId)
			if !reflect.DeepEqual(result, tt.expected) {
				t.Errorf("reorderTabIds(%v, %d, %d, %q) = %v, want %v",
					tt.tabIds, tt.oldIdx, tt.targetIdx, tt.tabId, result, tt.expected)
			}
			if len(result) != len(tt.tabIds) {
				t.Errorf("length changed: got %d, want %d", len(result), len(tt.tabIds))
			}
		})
	}
}

func TestCreateTabActivateJSONIncludesFalse(t *testing.T) {
	data, err := json.Marshal(wshrpc.CommandCreateTabData{
		WorkspaceId: "ws",
		Activate:    false,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	activate, ok := decoded["activate"].(bool)
	if !ok {
		t.Fatalf("activate missing or not bool in %s", string(data))
	}
	if activate {
		t.Errorf("activate = true, want false (omitempty would drop --activate=false)")
	}
}
