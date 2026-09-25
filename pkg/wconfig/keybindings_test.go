// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"io/fs"
	"testing"
	"testing/fstest"
)

func TestKeybindingKey(t *testing.T) {
	tests := []struct {
		input    KeybindingConfigType
		expected string
	}{
		{KeybindingConfigType{Command: "tab:new"}, "tab:new"},
		{KeybindingConfigType{Command: "block:focus", CommandStr: "up"}, "block:focus\x00up"},
		{KeybindingConfigType{Command: "block:focus", CommandStr: ""}, "block:focus"},
	}
	for _, tt := range tests {
		result := keybindingKey(tt.input)
		if result != tt.expected {
			t.Errorf("keybindingKey(%+v) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestMergeKeybindings_NoUserOverrides(t *testing.T) {
	defaults := []KeybindingConfigType{
		{Command: "tab:new", Keys: []string{"Cmd:t"}},
		{Command: "tab:close", Keys: []string{"Cmd:w"}},
	}
	result := mergeKeybindings(defaults, nil)
	if len(result) != 2 {
		t.Fatalf("expected 2 keybindings, got %d", len(result))
	}
	if result[0].Keys[0] != "Cmd:t" {
		t.Errorf("expected Cmd:t, got %s", result[0].Keys[0])
	}
}

func TestMergeKeybindings_OverrideExisting(t *testing.T) {
	defaults := []KeybindingConfigType{
		{Command: "tab:new", Keys: []string{"Cmd:t"}},
		{Command: "block:focus", Keys: []string{"Ctrl:Shift:ArrowUp"}, CommandStr: "up"},
	}
	user := []KeybindingConfigType{
		{Command: "block:focus", Keys: []string{"Cmd:Shift:ArrowUp"}, CommandStr: "up"},
	}
	result := mergeKeybindings(defaults, user)
	if len(result) != 2 {
		t.Fatalf("expected 2 keybindings, got %d", len(result))
	}
	if result[0].Keys[0] != "Cmd:t" {
		t.Errorf("tab:new should be unchanged, got %s", result[0].Keys[0])
	}
	if result[1].Keys[0] != "Cmd:Shift:ArrowUp" {
		t.Errorf("block:focus:up should be overridden, got %s", result[1].Keys[0])
	}
}

func TestMergeKeybindings_AddNew(t *testing.T) {
	defaults := []KeybindingConfigType{
		{Command: "tab:new", Keys: []string{"Cmd:t"}},
	}
	user := []KeybindingConfigType{
		{Command: "custom:action", Keys: []string{"Cmd:Shift:x"}},
	}
	result := mergeKeybindings(defaults, user)
	if len(result) != 2 {
		t.Fatalf("expected 2 keybindings, got %d", len(result))
	}
	if result[1].Command != "custom:action" {
		t.Errorf("expected custom:action appended, got %s", result[1].Command)
	}
}

func TestMergeKeybindings_DisableWithEmptyKeys(t *testing.T) {
	defaults := []KeybindingConfigType{
		{Command: "tab:new", Keys: []string{"Cmd:t"}},
		{Command: "block:rename", Keys: []string{"F2"}},
	}
	user := []KeybindingConfigType{
		{Command: "block:rename", Keys: []string{}},
	}
	result := mergeKeybindings(defaults, user)
	if len(result) != 2 {
		t.Fatalf("expected 2 keybindings, got %d", len(result))
	}
	if len(result[1].Keys) != 0 {
		t.Errorf("block:rename should have empty keys, got %v", result[1].Keys)
	}
}

func TestMergeKeybindings_CommandStrDistinction(t *testing.T) {
	defaults := []KeybindingConfigType{
		{Command: "block:focus", Keys: []string{"Ctrl:Shift:ArrowUp"}, CommandStr: "up"},
		{Command: "block:focus", Keys: []string{"Ctrl:Shift:ArrowDown"}, CommandStr: "down"},
	}
	user := []KeybindingConfigType{
		{Command: "block:focus", Keys: []string{"Alt:ArrowUp"}, CommandStr: "up"},
	}
	result := mergeKeybindings(defaults, user)
	if len(result) != 2 {
		t.Fatalf("expected 2 keybindings, got %d", len(result))
	}
	if result[0].Keys[0] != "Alt:ArrowUp" {
		t.Errorf("block:focus:up should be overridden, got %s", result[0].Keys[0])
	}
	if result[1].Keys[0] != "Ctrl:Shift:ArrowDown" {
		t.Errorf("block:focus:down should be unchanged, got %s", result[1].Keys[0])
	}
}

func TestMergeKeybindings_DoesNotMutateDefaults(t *testing.T) {
	defaults := []KeybindingConfigType{
		{Command: "tab:new", Keys: []string{"Cmd:t"}},
	}
	user := []KeybindingConfigType{
		{Command: "tab:new", Keys: []string{"Cmd:n"}},
	}
	mergeKeybindings(defaults, user)
	if defaults[0].Keys[0] != "Cmd:t" {
		t.Errorf("original defaults should not be mutated, got %s", defaults[0].Keys[0])
	}
}

func TestMergeKeybindings_NilKeysIgnored(t *testing.T) {
	defaults := []KeybindingConfigType{
		{Command: "tab:new", Keys: []string{"Cmd:t"}},
	}
	user := []KeybindingConfigType{
		{Command: "tab:new"},
	}
	result := mergeKeybindings(defaults, user)
	if len(result) != 1 {
		t.Fatalf("expected 1 keybinding, got %d", len(result))
	}
	if len(result[0].Keys) != 1 || result[0].Keys[0] != "Cmd:t" {
		t.Errorf("expected default keys preserved, got %v", result[0].Keys)
	}
}

func TestReadKeybindingsFile_ValidJSON(t *testing.T) {
	fsys := fstest.MapFS{
		"keybindings.json": &fstest.MapFile{
			Data: []byte(`[{"command":"tab:new","keys":["Cmd:t"]}]`),
		},
	}
	kbs, errs := readKeybindingsFile(fsys, "keybindings.json", "")
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(kbs) != 1 || kbs[0].Command != "tab:new" {
		t.Errorf("unexpected result: %+v", kbs)
	}
}

func TestReadKeybindingsFile_InvalidJSON(t *testing.T) {
	fsys := fstest.MapFS{
		"keybindings.json": &fstest.MapFile{
			Data: []byte(`[{broken`),
		},
	}
	kbs, errs := readKeybindingsFile(fsys, "keybindings.json", "")
	if len(errs) != 1 {
		t.Fatalf("expected 1 error, got %d", len(errs))
	}
	if kbs != nil {
		t.Errorf("expected nil keybindings on error, got %+v", kbs)
	}
}

func TestReadKeybindingsFile_MissingFile(t *testing.T) {
	fsys := fstest.MapFS{}
	kbs, errs := readKeybindingsFile(fs.FS(fsys), "keybindings.json", "")
	if len(errs) != 0 {
		t.Fatalf("missing file should not produce errors, got %v", errs)
	}
	if kbs != nil {
		t.Errorf("expected nil keybindings for missing file, got %+v", kbs)
	}
}
