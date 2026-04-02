// Package protocol provides ACP configuration management for ZeroAI
package protocol

import (
	"fmt"
	"strings"
	"sync"
)

var customConfigsMu sync.RWMutex
var customBackendConfigs = map[AcpBackend]AcpBackendConfig{}

func RegisterCustomBackend(id string, name string, cliCommand string, cliPath string, cliArgs []string, env map[string]string, supportsStreaming bool) {
	customConfigsMu.Lock()
	defer customConfigsMu.Unlock()

	backend := AcpBackend("custom:" + id)
	customBackendConfigs[backend] = AcpBackendConfig{
		ID:                backend,
		Name:              name,
		CliCommand:        cliCommand,
		DefaultCliPath:    cliPath,
		AuthRequired:      false,
		Enabled:           true,
		SupportsStreaming: supportsStreaming,
		AcpArgs:           cliArgs,
		Env:               env,
	}
}

func UnregisterCustomBackend(id string) {
	customConfigsMu.Lock()
	defer customConfigsMu.Unlock()
	delete(customBackendConfigs, AcpBackend("custom:"+id))
}

func GetCustomBackendConfigs() []AcpBackendConfig {
	customConfigsMu.RLock()
	defer customConfigsMu.RUnlock()
	configs := make([]AcpBackendConfig, 0, len(customBackendConfigs))
	for _, cfg := range customBackendConfigs {
		configs = append(configs, cfg)
	}
	return configs
}

func GetBackendConfig(backend AcpBackend) (*AcpBackendConfig, error) {
	if config, exists := backendConfigs[backend]; exists {
		return &config, nil
	}
	customConfigsMu.RLock()
	defer customConfigsMu.RUnlock()
	if config, exists := customBackendConfigs[backend]; exists {
		return &config, nil
	}
	return nil, fmt.Errorf("unknown backend: %s", backend)
}

// GetAllBackendConfigs returns all available backend configurations
func GetAllBackendConfigs() []AcpBackendConfig {
	configs := make([]AcpBackendConfig, 0)
	for _, cfg := range backendConfigs {
		configs = append(configs, cfg)
	}
	customConfigsMu.RLock()
	for _, cfg := range customBackendConfigs {
		configs = append(configs, cfg)
	}
	customConfigsMu.RUnlock()
	return configs
}

func GetEnabledBackends() []AcpBackendConfig {
	var enabled []AcpBackendConfig
	for _, cfg := range backendConfigs {
		if cfg.Enabled {
			enabled = append(enabled, cfg)
		}
	}
	customConfigsMu.RLock()
	for _, cfg := range customBackendConfigs {
		if cfg.Enabled {
			enabled = append(enabled, cfg)
		}
	}
	customConfigsMu.RUnlock()
	return enabled
}

var backendConfigs = map[AcpBackend]AcpBackendConfig{
	AcpBackendClaude: {
		ID:                AcpBackendClaude,
		Name:              "Claude",
		CliCommand:        "claude",
		DefaultCliPath:    "claude-code",
		AuthRequired:      true,
		Enabled:           true,
		SupportsStreaming: true,
		AcpArgs:           []string{"--stdio"},
		Env: map[string]string{
			"ANTHROPIC_COLOR": "auto",
		},
	},
	AcpBackendGemini: {
		ID:                AcpBackendGemini,
		Name:              "Gemini",
		CliCommand:        "gemini-chat",
		DefaultCliPath:    "gemini-chat-cli",
		AuthRequired:      true,
		Enabled:           false, // Not yet available
		SupportsStreaming: true,
		AcpArgs:           []string{"--stdio"},
	},
	AcpBackendQwen: {
		ID:                AcpBackendQwen,
		Name:              "Qwen",
		CliCommand:        "qwen",
		DefaultCliPath:    "qwen-cli",
		AuthRequired:      true,
		Enabled:           true,
		SupportsStreaming: true,
		AcpArgs:           []string{"--stdio"},
		Env: map[string]string{
			"QWEN_COLOR": "auto",
		},
	},
	AcpBackendCodex: {
		ID:                AcpBackendCodex,
		Name:              "Codex",
		CliCommand:        "codex",
		DefaultCliPath:    "codex-acp",
		AuthRequired:      true,
		Enabled:           true,
		SupportsStreaming: true,
		AcpArgs:           []string{"--stdio"},
	},
	AcpBackendOpenCode: {
		ID:                AcpBackendOpenCode,
		Name:              "OpenCode",
		CliCommand:        "opencode",
		DefaultCliPath:    "opencode-cli",
		AuthRequired:      true,
		Enabled:           false, // Not yet available
		SupportsStreaming: true,
		AcpArgs:           []string{"--stdio"},
	},
	AcpBackendCustom: {
		ID:                AcpBackendCustom,
		Name:              "Custom",
		CliCommand:        "",
		DefaultCliPath:    "",
		AuthRequired:      false,
		Enabled:           true,
		SupportsStreaming: false,
		AcpArgs:           []string{},
		Env:               nil,
	},
}

// DefaultSessionConfigs provides default session configurations per backend
var DefaultSessionConfigs = map[AcpBackend]map[string]string{
	AcpBackendClaude: {
		"model":         "claude-sonnet-4-20250514",
		"thinkingLevel": "medium",
	},
	AcpBackendQwen: {
		"model":         "qwen-coder-plus",
		"thinkingLevel": "normal",
	},
}

// ValidSessionModes returns valid session mode values for each backend
var ValidSessionModes = map[AcpBackend][]string{
	AcpBackendClaude:   {"chat", "code", "bypassPermissions"},
	AcpBackendQwen:     {"chat", "code", "yolo"},
	AcpBackendCodex:    {"code", "bypassPermissions"},
	AcpBackendOpenCode: {"code", "bypassPermissions"},
	AcpBackendGemini:   {"chat"},
}

// ValidateSessionConfig validates a session configuration
func ValidateSessionConfig(config *AcpSessionConfig) error {
	if config == nil {
		return fmt.Errorf("session config is nil")
	}

	// Check backend is valid
	if !IsBackendAvailable(string(config.Backend)) {
		return fmt.Errorf("invalid backend: %s", config.Backend)
	}

	// Check CLI path for non-custom backends
	if config.Backend != AcpBackendCustom && config.CliPath == "" {
		backendCfg, err := GetBackendConfig(config.Backend)
		if err != nil {
			return err
		}
		if backendCfg.DefaultCliPath == "" {
			return fmt.Errorf("no CLI path specified for backend %s", config.Backend)
		}
	}

	// If resume session, must have session ID
	if config.ResumeSession && config.SessionID == "" {
		return fmt.Errorf("resumeSession requires sessionId")
	}

	return nil
}

// BuildCliCommand builds the full CLI command for a backend
func BuildCliCommand(config *AcpBackendConfig, cliPath string, extraArgs []string) []string {
	command := []string{cliPath}

	// Add ACP args
	command = append(command, config.AcpArgs...)

	// Add any extra args
	if len(extraArgs) > 0 {
		command = append(command, extraArgs...)
	}

	return command
}

// GetBackendEnvVars returns default environment variables for a backend
func GetBackendEnvVars(backend AcpBackend) map[string]string {
	config, exists := backendConfigs[backend]
	if !exists {
		return nil
	}

	env := make(map[string]string)
	for k, v := range config.Env {
		env[k] = v
	}
	return env
}

// MergeEnvVars merges user-provided env vars with backend defaults
func MergeEnvVars(backend AcpBackend, userEnv map[string]string) map[string]string {
	defaultEnv := GetBackendEnvVars(backend)
	if defaultEnv == nil {
		defaultEnv = make(map[string]string)
	}

	merged := make(map[string]string)
	for k, v := range defaultEnv {
		merged[k] = v
	}
	for k, v := range userEnv {
		merged[k] = v
	}

	return merged
}

// IsStreamingSupported checks if a backend supports streaming
func IsStreamingSupported(backend AcpBackend) bool {
	config, exists := backendConfigs[backend]
	if !exists {
		return false
	}
	return config.SupportsStreaming
}

// GetDefaultModel returns the default model for a backend
func GetDefaultModel(backend AcpBackend) string {
	if _, exists := backendConfigs[backend]; exists {
		defaults, hasDefaults := DefaultSessionConfigs[backend]
		if hasDefaults {
			if model, ok := defaults["model"]; ok {
				return model
			}
		}
	}
	return ""
}

// GetAvailableModels returns available models for a backend
func GetAvailableModels(backend AcpBackend) []string {
	// Models are discovered through session/models RPC
	// This returns static defaults available in config
	models := make([]string, 0)

	switch backend {
	case AcpBackendClaude:
		models = []string{
			"claude-sonnet-4-20250514",
			"claude-sonnet-4-20250514-thinking-level-0",
			"claude-sonnet-4-20250514-thinking-level-1",
			"claude-sonnet-4-20250514-thinking-level-2",
			"claude-sonnet-4-20250514-thinking-level-3",
			"claude-opus-20250514",
			"claude-opus-20250514-thinking-level-0",
			"claude-opus-20250514-thinking-level-1",
			"claude-opus-20250514-thinking-level-2",
			"claude-opus-20250514-thinking-level-3",
		}
	case AcpBackendQwen:
		models = []string{
			"qwen-coder-plus",
			"qwen-plus",
			"qwen-max",
		}
	case AcpBackendCodex:
		models = []string{
			"gpt-4",
			"gpt-4-turbo",
		}
	}

	return models
}

// GetSessionTimeout returns the default session timeout for a backend
func GetSessionTimeout(backend AcpBackend) int {
	// Default to 30 minutes for most backends
	return 30
}

// ValidateMode validates a session mode for a backend
func ValidateMode(backend AcpBackend, mode string) error {
	validModes, exists := ValidSessionModes[backend]
	if !exists {
		return fmt.Errorf("unknown backend: %s", backend)
	}

	for _, validMode := range validModes {
		if validMode == mode {
			return nil
		}
	}

	return fmt.Errorf("invalid mode '%s' for backend %s. Valid modes: %s",
		mode, backend, strings.Join(validModes, ", "))
}

// GetYoloMode returns the yolo/bypass mode string for a backend
func GetYoloMode(backend AcpBackend) string {
	switch backend {
	case AcpBackendClaude:
		return ClaudeYoloSessionMode
	case AcpBackendQwen:
		return QwenYoloSessionMode
	case AcpBackendCodex:
		return CodebuddyYoloSessionMode
	default:
		return ""
	}
}

// DetectBackendFromCLI attempts to detect the backend from a CLI command path
func DetectBackendFromCLI(cliPath string) (AcpBackend, error) {
	cliPath = strings.ToLower(cliPath)

	for _, config := range backendConfigs {
		if config.CliCommand == "" {
			continue
		}
		if strings.Contains(cliPath, config.CliCommand) {
			return config.ID, nil
		}
	}

	return "", fmt.Errorf("cannot detect backend from CLI path: %s", cliPath)
}

// GetWorkspaceSafeBackends returns backends that can be used safely in workspace
func GetWorkspaceSafeBackends() []AcpBackend {
	return []AcpBackend{
		AcpBackendClaude,
		AcpBackendQwen,
		AcpBackendCodex,
	}
}

// ParseSessionConfigFromWsh parses session config from WSH settings
func ParseSessionConfigFromWsh(settings map[string]interface{}) (*AcpSessionConfig, error) {
	config := &AcpSessionConfig{}

	if backendStr, ok := settings["backend"].(string); ok {
		backend, err := GetBackendFromString(backendStr)
		if err != nil {
			return nil, err
		}
		config.Backend = backend
	}

	if cliPath, ok := settings["cliPath"].(string); ok {
		config.CliPath = cliPath
	}

	if cwd, ok := settings["cwd"].(string); ok {
		config.Cwd = cwd
	}

	if resume, ok := settings["resumeSession"].(bool); ok {
		config.ResumeSession = resume
	}

	if sid, ok := settings["sessionId"].(string); ok {
		config.SessionID = sid
	}

	if yolo, ok := settings["yoloMode"].(bool); ok {
		config.YoloMode = yolo
	}

	if model, ok := settings["model"].(string); ok {
		config.Model = model
	}

	if envMap, ok := settings["env"].(map[string]interface{}); ok {
		config.Env = make(map[string]string)
		for k, v := range envMap {
			if str, ok := v.(string); ok {
				config.Env[k] = str
			}
		}
	}

	return config, nil
}
