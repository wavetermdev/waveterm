// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestResolveAgentSplitRelativeTo(t *testing.T) {
	tests := []struct {
		name           string
		split          string
		relativeTo     string
		focusedBlockId string
		want           string
		wantErr        bool
	}{
		{name: "no split no relative-to", split: "", relativeTo: "", want: ""},
		{name: "split with relative-to", split: "right", relativeTo: "block:abc", want: "block:abc"},
		{name: "split defaults to focused block", split: "right", relativeTo: "", focusedBlockId: "block:focused", want: "block:focused"},
		{name: "relative-to without split errors", split: "", relativeTo: "block:abc", wantErr: true},
		{name: "split without relative-to and no focused block errors", split: "right", relativeTo: "", wantErr: true},
		{name: "explicit relative-to wins over focused block", split: "below", relativeTo: "block:explicit", focusedBlockId: "block:focused", want: "block:explicit"},
		{name: "empty relative-to treated as unset even with focused block", split: "left", relativeTo: "", focusedBlockId: "block:focused", want: "block:focused"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveAgentSplitRelativeTo(tt.split, tt.relativeTo, tt.focusedBlockId)
			if (err != nil) != tt.wantErr {
				t.Errorf("resolveAgentSplitRelativeTo(%q, %q, %q) error = %v, wantErr %v",
					tt.split, tt.relativeTo, tt.focusedBlockId, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if got != tt.want {
				t.Errorf("resolveAgentSplitRelativeTo(%q, %q, %q) = %q, want %q",
					tt.split, tt.relativeTo, tt.focusedBlockId, got, tt.want)
			}
		})
	}
}

func TestAssemblePromptInput(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		want   string
	}{
		{name: "plain prompt appends enter", prompt: "Fix the build error", want: "Fix the build error\r"},
		{name: "empty prompt is just enter", prompt: "", want: "\r"},
		{name: "prompt with trailing newline still appends enter", prompt: "hello\n", want: "hello\n\r"},
		{name: "multi-line prompt", prompt: "line1\nline2", want: "line1\nline2\r"},
		{name: "prompt already ending in CR gets another", prompt: "done\r", want: "done\r\r"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := assemblePromptInput(tt.prompt)
			if got != tt.want {
				t.Errorf("assemblePromptInput(%q) = %q, want %q", tt.prompt, got, tt.want)
			}
		})
	}
}

func TestAgentHelpTextIncludesWeb(t *testing.T) {
	for _, needle := range []string{"wsh web open", "wsh web snapshot", "wsh web run", "agent:allowbrowsercontrol"} {
		if !strings.Contains(agentHelpText, needle) {
			t.Errorf("agentHelpText missing %q", needle)
		}
	}
}

func TestAgentHelpTextUsesWAVETERM(t *testing.T) {
	if !strings.Contains(agentHelpText, "WAVETERM=1") {
		t.Errorf("agentHelpText missing WAVETERM=1")
	}
	if strings.Contains(agentHelpText, "WAVE_TERMINAL") {
		t.Errorf("agentHelpText still mentions WAVE_TERMINAL")
	}
	for _, env := range []string{"WAVETERM_BLOCKID", "WAVETERM_TABID", "WAVETERM_CONN", "WAVETERM_VERSION"} {
		if !strings.Contains(agentHelpText, env) {
			t.Errorf("agentHelpText missing %s", env)
		}
	}
}

func TestAgentHelpJSONUnmarshalsAndListsCommands(t *testing.T) {
	data, err := json.Marshal(buildAgentHelpDoc())
	if err != nil {
		t.Fatalf("marshal help doc: %v", err)
	}
	var doc agentHelpDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("unmarshal help doc: %v", err)
	}
	if doc.Version != agentHelpDocVersion {
		t.Errorf("version = %d, want %d", doc.Version, agentHelpDocVersion)
	}
	foundEnv := false
	for _, e := range doc.EnvVars {
		if e.Name == "WAVETERM" {
			foundEnv = true
			if !strings.Contains(e.Description, "WAVETERM=1") {
				t.Errorf("WAVETERM env description = %q, want to mention WAVETERM=1", e.Description)
			}
		}
	}
	if !foundEnv {
		t.Errorf("envvars missing WAVETERM")
	}
	needles := []string{
		"wsh file",
		"wsh view",
		"wsh edit",
		"wsh notify",
		"wsh run",
		"wsh agent spawn",
		"wsh agent context",
		"wsh block capture",
		"wsh block wait",
		"wsh config",
		"wsh prompt",
		"wsh connection",
		"wsh tab",
		"screenshot",
		"wsh web open",
		"wsh web snapshot",
		"wsh web run",
	}
	joined := ""
	for _, c := range doc.Commands {
		if c.Command == "" || c.Summary == "" || c.Example == "" {
			t.Errorf("command entry incomplete: %+v", c)
		}
		joined += c.Command + "\n"
	}
	for _, n := range needles {
		if !strings.Contains(joined, n) {
			t.Errorf("help --json commands missing %q", n)
		}
	}
}

func TestBuildAgentSpawnExtraMeta(t *testing.T) {
	tests := []struct {
		name           string
		cmdStr         string
		blockName      string
		parentBlockId  string
		idempotencyKey string
		wantKeys       map[string]any
		absentKeys     []string
	}{
		{
			name:   "owned and cmd always set",
			cmdStr: "claude",
			wantKeys: map[string]any{
				waveobj.MetaKey_AgentOwned: true,
				waveobj.MetaKey_AgentCmd:   "claude",
			},
			absentKeys: []string{
				waveobj.MetaKey_AgentParent,
				waveobj.MetaKey_AgentIdempotencyKey,
				waveobj.MetaKey_FrameTitle,
			},
		},
		{
			name:           "name parent and key",
			cmdStr:         "pi",
			blockName:      "pi-prod",
			parentBlockId:  "parent-block",
			idempotencyKey: "pi-1",
			wantKeys: map[string]any{
				waveobj.MetaKey_AgentOwned:          true,
				waveobj.MetaKey_AgentCmd:            "pi",
				waveobj.MetaKey_AgentParent:         "parent-block",
				waveobj.MetaKey_AgentIdempotencyKey: "pi-1",
				waveobj.MetaKey_FrameTitle:          "pi-prod",
			},
		},
		{
			name:          "empty parent omitted",
			cmdStr:        "claude",
			parentBlockId: "",
			wantKeys: map[string]any{
				waveobj.MetaKey_AgentOwned: true,
				waveobj.MetaKey_AgentCmd:   "claude",
			},
			absentKeys: []string{waveobj.MetaKey_AgentParent},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildAgentSpawnExtraMeta(tt.cmdStr, tt.blockName, tt.parentBlockId, tt.idempotencyKey)
			for k, want := range tt.wantKeys {
				if got[k] != want {
					t.Errorf("meta[%q] = %#v, want %#v", k, got[k], want)
				}
			}
			for _, k := range tt.absentKeys {
				if _, ok := got[k]; ok {
					t.Errorf("meta unexpectedly has %q = %#v", k, got[k])
				}
			}
		})
	}
}

func TestFindRunningBlockWithIdempotencyKey(t *testing.T) {
	entries := []agentIdempotencyEntry{
		{BlockId: "done-block", Key: "same", StillRunning: false},
		{BlockId: "running-block", Key: "same", StillRunning: true},
		{BlockId: "other-running", Key: "other", StillRunning: true},
	}
	tests := []struct {
		name string
		key  string
		want string
	}{
		{name: "running match", key: "same", want: "running-block"},
		{name: "different key", key: "missing", want: ""},
		{name: "empty key never matches", key: "", want: ""},
		{name: "other key", key: "other", want: "other-running"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := findRunningBlockWithIdempotencyKey(entries, tt.key)
			if got != tt.want {
				t.Errorf("findRunningBlockWithIdempotencyKey(%q) = %q, want %q", tt.key, got, tt.want)
			}
		})
	}
}

func TestIsControllerStillRunning(t *testing.T) {
	tests := []struct {
		name   string
		status *wshrpc.BlockControllerStatusData
		err    error
		want   bool
	}{
		{name: "running", status: &wshrpc.BlockControllerStatusData{ShellProcStatus: "running"}, want: true},
		{name: "done", status: &wshrpc.BlockControllerStatusData{ShellProcStatus: "done"}, want: false},
		{name: "empty status object counts as not done", status: &wshrpc.BlockControllerStatusData{}, want: true},
		{name: "nil status", status: nil, want: false},
		{name: "error", status: &wshrpc.BlockControllerStatusData{ShellProcStatus: "running"}, err: errSentinel("no controller"), want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isControllerStillRunning(tt.status, tt.err)
			if got != tt.want {
				t.Errorf("isControllerStillRunning(...) = %v, want %v", got, tt.want)
			}
		})
	}
}

type errSentinel string

func (e errSentinel) Error() string { return string(e) }
