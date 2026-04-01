// Package protocol implements ACP (Agent Control Protocol) configuration
//
// This file provides ACP backend configuration management.
package protocol

import (
	"fmt"
)

// Backend configurations for each supported ACP backend
var backendConfigs = map[AcpBackend]AcpBackendConfig{
	AcpBackendClaude: {
		ID:               AcpBackendClaude,
		Name:             "Claude",
		CliCommand:       "claude",
		DefaultCliPath:   "claude-code",
		AuthRequired:     true,
		Enabled:          true,
		SupportsStreaming: true,
		AcpArgs:          []string{"acp"},
	},
	AcpBackendGemini: {
		ID:               AcpBackendGemini,
		Name:             "Gemini",
		CliCommand:       "gemini",
		DefaultCliPath:   "gemini-acp",
		AuthRequired:     true,
		Enabled:          false, // TODO: enable when available
		SupportsStreaming: true,
		AcpArgs:          []string{"acp"},
	},
	AcpBackendQwen: {
		ID:               AcpBackendQwen,
		Name:             "Qwen",
		CliCommand:       "qwen",
		DefaultCliPath:   "qwen",
		AuthRequired:     false,
		Enabled:          true,
		SupportsStreaming: true,
		AcpArgs:          []string{"acp"},
	},
	AcpBackendCodex: {
		ID:               AcpBackendCodex,
		Name:             "Codex",
		CliCommand:       "codex",
		DefaultCliPath:   "codex-acp",
		AuthRequired:     false,
		Enabled:          false, // TODO: enable when available
		SupportsStreaming: true,
		AcpArgs:          []string{"acp"},
	},
	AcpBackendOpenCode: {
		ID:               AcpBackendOpenCode,
		Name:             "OpenCode",
		CliCommand:       "opencode",
		DefaultCliPath:   "opencode-acp",
		AuthRequired:     false,
		Enabled:          false, // TODO: enable when available
		SupportsStreaming: true,
		AcpArgs:          []string{"acp"},
	},
	AcpBackendCustom: {
		ID:               AcpBackendCustom,
		Name:             "Custom",
		CliCommand:       "",
		DefaultCliPath:   "",
		AuthRequired:     false,
		Enabled:          false,
		SupportsStreaming: false,
		AcpArgs:          []string{},
	},
}

// GetBackendConfig returns the configuration for a given backend
func GetBackendConfig(backend AcpBackend) AcpBackendConfig {
	cfg, ok := backendConfigs[backend]
	if !ok {
		// Return custom config for unknown backends
		return AcpBackendConfig{
			ID:               AcpBackendCustom,
			Name:             string(backend),
			CliCommand:       "",
			DefaultCliPath:   "",
			AuthRequired:     false,
			Enabled:          false,
			SupportsStreaming: false,
			AcpArgs:          []string{},
		}
	}
	return cfg
}

// GetEnabledBackends returns a list of all enabled backends
func GetEnabledBackends() []AcpBackend {
	var enabled []AcpBackend
	for _, cfg := range backendConfigs {
		if cfg.Enabled {
			enabled = append(enabled, cfg.ID)
		}
	}
	return enabled
}

// IsBackendEnabled checks if a backend is enabled
func IsBackendEnabled(backend AcpBackend) bool {
	cfg := GetBackendConfig(backend)
	return cfg.Enabled
}

// ValidateConfig validates an ACP session configuration
func ValidateConfig(config AcpSessionConfig) error {
	// Check backend is valid
	if config.Backend == "" {
		return &AcpError{
			Type:    ErrorConnection,
			Message: "backend is required",
		}
	}

	// Check backend is enabled
	if !IsBackendEnabled(config.Backend) {
		// For custom backends, allow them even if not in config
		if config.Backend != AcpBackendCustom {
			return &AcpError{
				Type:    ErrorConnection,
				Message: fmt.Sprintf("backend %s is not enabled", config.Backend),
			}
		}
	}

	// Validate resume/fork session mutual exclusivity
	if config.ResumeSession && config.ForkSession {
		return &AcpError{
			Type:    ErrorSession,
			Message: "cannot specify both resumeSession and forkSession",
		}
	}

	// If resume or fork, session ID is required
	if (config.ResumeSession || config.ForkSession) && config.SessionID == "" {
		return &AcpError{
			Type:    ErrorSession,
			Message: "session ID is required for resume/fork",
		}
	}

	// Working directory is always required
	if config.Cwd == "" {
		return &AcpError{
			Type:    ErrorSession,
			Message: "working directory (cwd) is required",
		}
	}

	return nil
}

// SetBackendEnabled enables or disables a backend
func SetBackendEnabled(backend AcpBackend, enabled bool) {
	cfg, ok := backendConfigs[backend]
	if ok {
		cfg.Enabled = enabled
		backendConfigs[backend] = cfg
	}
}

// RegisterCustomBackend registers a custom backend configuration
func RegisterCustomBackend(cfg AcpBackendConfig) error {
	if cfg.ID == "" {
		return &AcpError{
			Type:    ErrorConnection,
			Message: "backend ID is required",
		}
	}
	if cfg.Name == "" {
		return &AcpError{
			Type:    ErrorConnection,
			Message: "backend name is required",
		}
	}

	backendConfigs[cfg.ID] = cfg
	return nil
}
