// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package process provides process spawning utilities for ZeroAI agents
package process

import (
	"runtime"

	"github.com/wavetermdev/waveterm/pkg/zeroai/protocol"
)

// DefaultProcessManager returns the default process manager for the current platform
func DefaultProcessManager() ProcessManager {
	return NewWSHProcessManager()
}

// buildAcpCommand builds the ACP command line arguments for a given backend
func buildAcpCommand(backend protocol.AcpBackend, sessionID string, forkSession bool, yoloMode bool) (string, []string) {
	var cmd string
	var args []string

	switch backend {
	case protocol.AcpBackendClaude:
		// claude acp --json-rpc [session-id] [--fork-session-id X]
		cmd = "claude"
		args = []string{"acp", "--json-rpc"}

		if sessionID != "" {
			args = append(args, sessionID)
		}

		if forkSession {
			// Not implemented in claude-code yet, placeholder
		}

	case protocol.AcpBackendQwen:
		// qwen acp [session-id] [--fork-session-id X]? [yolo-mode?]?
		// Note: This depends on qwen CLI implementation
		cmd = "qwen"
		args = []string{"acp"}

		if sessionID != "" {
			args = append(args, sessionID)
		}

		if yoloMode {
			args = append(args, protocol.QwenYoloSessionMode)
		}

	case protocol.AcpBackendCodex:
		// codex acp [session-id] [--fork-session-id X]?
		cmd = "codex"
		args = []string{"acp"}

		if sessionID != "" {
			args = append(args, sessionID)
		}

	case protocol.AcpBackendOpenCode:
		// opencode acp [session-id] [--fork-session-id X]?
		cmd = "opencode"
		args = []string{"acp"}

		if sessionID != "" {
			args = append(args, sessionID)
		}

	case protocol.AcpBackendCustom:
		// Custom backends use configurable command
		cmd = ""
		args = nil

	default:
		return "", nil
	}

	return cmd, args
}

// buildAgentEnv builds the environment variables for an agent process
func buildAgentEnv(backend protocol.AcpBackend, yoloMode bool, model string, customEnv map[string]string) map[string]string {
	env := make(map[string]string)

	// Add backend-specific environment variables
	switch backend {
	case protocol.AcpBackendClaude:
		if yoloMode {
			env["ANTHROPIC_YOLO"] = protocol.ClaudeYoloSessionMode
		}
		// Note: CLAUDE_MODEL should be set via session/new RPC

	case protocol.AcpBackendQwen:
		// Qwen yolo mode is passed via command line, not env
		// But we may need other env vars in the future

	case protocol.AcpBackendCodex:
		if yoloMode {
			env["GOOSE_MODE"] = protocol.GooseYoloEnvValue
		}

	case protocol.AcpBackendOpenCode:
		// No special env vars for opencode
	}

	// Add custom environment variables
	if customEnv != nil {
		for k, v := range customEnv {
			env[k] = v
		}
	}

	return env
}

// BuildProcessSpec builds a ProcessSpec from ACP configuration
func BuildProcessSpec(backend protocol.AcpBackend, cliPath string, sessionID string, forkSession bool, yoloMode bool, model string, cwd string, env map[string]string) ProcessSpec {
	var cmd string
	var args []string

	// Use explicit cliPath if provided, otherwise build default command
	if cliPath != "" {
		cmd = cliPath
	} else {
		cmd, args = buildAcpCommand(backend, sessionID, forkSession, yoloMode)
	}

	// Build environment
	agentEnv := buildAgentEnv(backend, yoloMode, model, env)

	return ProcessSpec{
		Command:     cmd,
		Args:        args,
		Cwd:         cwd,
		Env:         agentEnv,
		Backend:     backend,
		SessionID:   sessionID,
		ForkSession: forkSession,
		YoloMode:    yoloMode,
		Model:       model,
	}
}

// IsWindows returns true if running on Windows
func IsWindows() bool {
	return runtime.GOOS == "windows"
}

// IsUnix returns true if running on Unix-like systems
func IsUnix() bool {
	return runtime.GOOS == "linux" || runtime.GOOS == "darwin"
}
