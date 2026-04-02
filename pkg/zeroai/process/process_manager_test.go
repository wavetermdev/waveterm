// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package process

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/zeroai/protocol"
)

func TestNewWSHProcessManager(t *testing.T) {
	pm := NewWSHProcessManager()
	if pm == nil {
		t.Fatal("NewWSHProcessManager returned nil")
	}
}

func TestBuildProcessSpec(t *testing.T) {
	tests := []struct {
		name       string
		backend    protocol.AcpBackend
		cliPath    string
		sessionID  string
		yoloMode   bool
		model      string
		wantCmd    string
		wantArgs   int
	}{
		{
			name:      "Claude default",
			backend:   protocol.AcpBackendClaude,
			cliPath:   "",
			sessionID: "",
			yoloMode:  false,
			wantCmd:   "claude",
			wantArgs:  2, // ["acp", "--json-rpc"]
		},
		{
			name:      "Claude with session ID",
			backend:   protocol.AcpBackendClaude,
			cliPath:   "",
			sessionID: "test-session-id",
			yoloMode:  false,
			wantCmd:   "claude",
			wantArgs:  3, // ["acp", "--json-rpc", "test-session-id"]
		},
		{
			name:      "Qwen with yolo mode",
			backend:   protocol.AcpBackendQwen,
			cliPath:   "",
			sessionID: "",
			yoloMode:  true,
			wantCmd:   "qwen",
			wantArgs:  2, // ["acp", "yolo"]
		},
		{
			name:      "Custom CLI path",
			backend:   protocol.AcpBackendClaude,
			cliPath:   "/usr/local/bin/claude-code",
			sessionID: "",
			yoloMode:  false,
			wantCmd:   "/usr/local/bin/claude-code",
			wantArgs:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := BuildProcessSpec(tt.backend, tt.cliPath, tt.sessionID, false, tt.yoloMode, tt.model, "", nil)
			if spec.Command != tt.wantCmd {
				t.Errorf("Command = %v, want %v", spec.Command, tt.wantCmd)
			}
			if len(spec.Args) != tt.wantArgs {
				t.Errorf("Args length = %v, want %v", len(spec.Args), tt.wantArgs)
			}
		})
	}
}

func TestBuildAgentEnv(t *testing.T) {
	tests := []struct {
		name      string
		backend   protocol.AcpBackend
		yoloMode  bool
		wantKeys  []string
	}{
		{
			name:     "Claude normal mode",
			backend:  protocol.AcpBackendClaude,
			yoloMode: false,
			wantKeys: []string{},
		},
		{
			name:     "Claude yolo mode",
			backend:  protocol.AcpBackendClaude,
			yoloMode: true,
			wantKeys: []string{"ANTHROPIC_YOLO"},
		},
		{
			name:     "Codex yolo mode",
			backend:  protocol.AcpBackendCodex,
			yoloMode: true,
			wantKeys: []string{"GOOSE_MODE"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := buildAgentEnv(tt.backend, tt.yoloMode, "", nil)
			for _, key := range tt.wantKeys {
				if _, ok := env[key]; !ok {
					t.Errorf("Env missing key %s", key)
				}
			}
		})
	}
}

func TestAgentProcess(t *testing.T) {
	// Skip if home dir is not accessible
	homeDir := wavebase.GetHomeDir()
	if homeDir == "" {
		t.Skip("Home dir not accessible")
	}

	pm := NewWSHProcessManager()
	ctx := context.Background()

	// Use a simple echo command to test basic functionality
	spec := ProcessSpec{
		Command: "echo",
		Args:    []string{"hello"},
		Cwd:     homeDir,
	}

	proc, err := pm.SpawnProcess(ctx, spec)
	if err != nil {
		t.Fatalf("SpawnProcess failed: %v", err)
	}

	// Get process info
	info := pm.GetProcessInfo(proc)
	if info.State != ProcessStateRunning {
		t.Errorf("Expected state ProcessStateRunning, got %v", info.State)
	}
	if info.PID == 0 {
		t.Errorf("Expected non-zero PID")
	}

	// Wait for process to complete
	err = proc.Wait()
	if err != nil {
		t.Errorf("Wait failed: %v", err)
	}

	// Get process info after completion
	info = pm.GetProcessInfo(proc)
	if info.State != ProcessStateDone {
		t.Errorf("Expected state ProcessStateDone, got %v", info.State)
	}
	if info.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", info.ExitCode)
	}

	if info.StartedAt.IsZero() {
		t.Error("Expected non-zero StartedAt")
	}
	if info.EndedAt.IsZero() {
		t.Error("Expected non-zero EndedAt")
	}
}

func TestAgentProcessKill(t *testing.T) {
	// Use a long-running sleep command (1 second)
	pm := NewWSHProcessManager()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Use a simple sleep command that we can kill
	spec := ProcessSpec{
		Command: "sleep",
		Args:    []string{"100"},
		Cwd:     wavebase.GetHomeDir(),
	}

	proc, err := pm.SpawnProcess(ctx, spec)
	if err != nil {
		t.Fatalf("SpawnProcess failed: %v", err)
	}

	// Give it a moment to start
	time.Sleep(100 * time.Millisecond)

	// Kill the process
	err = pm.KillProcess(proc)
	if err != nil {
		t.Fatalf("KillProcess failed: %v", err)
	}

	// Wait for process to exit
	err = proc.Wait()
	if err == nil {
		t.Error("Expected non-nil error from killed process")
	}

	// Verify process is done
	info := pm.GetProcessInfo(proc)
	if info.State != ProcessStateDone {
		t.Errorf("Expected state ProcessStateDone, got %v", info.State)
	}
}

func TestAgentProcessWaitNB(t *testing.T) {
	pm := NewWSHProcessManager()
	ctx := context.Background()

	spec := ProcessSpec{
		Command: "sleep",
		Args:    []string{"0.1"},
		Cwd:     wavebase.GetHomeDir(),
	}

	proc, err := pm.SpawnProcess(ctx, spec)
	if err != nil {
		t.Fatalf("SpawnProcess failed: %v", err)
	}

	// Non-blocking wait should return false immediately (still running)
	done, err := proc.WaitNB()
	if done {
		t.Error("Expected done=false for running process")
	}
	if err != nil {
		t.Errorf("Expected nil error, got: %v", err)
	}

	// Wait for process to complete
	proc.Wait()

	// Now non-blocking wait should return true
	done, err = proc.WaitNB()
	if !done {
		t.Error("Expected done=true for completed process")
	}
	if err != nil {
		t.Errorf("Expected nil error, got: %v", err)
	}
}

func TestPlatformHelpers(t *testing.T) {
	// Just make sure these functions don't panic
	_ = IsWindows()
	_ = IsUnix()
}
