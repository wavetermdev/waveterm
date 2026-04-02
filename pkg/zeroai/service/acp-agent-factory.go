// Package service provides high-level service interfaces for ZeroAI
//
// AcpAgentFactory creates ACP-based agent instances.
package service

import (
	"fmt"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/zeroai/agent"
	"github.com/wavetermdev/waveterm/pkg/zeroai/protocol"
)

// AcpAgentFactory creates ACP-backed agents
type AcpAgentFactory struct {
	detectedCLIs map[protocol.AcpBackend]protocol.CLIInfo
	cliInfoMu    sync.RWMutex
}

// NewAcpAgentFactory creates a new AcpAgentFactory
func NewAcpAgentFactory() *AcpAgentFactory {
	return &AcpAgentFactory{
		detectedCLIs: make(map[protocol.AcpBackend]protocol.CLIInfo),
	}
}

// CreateAgent creates a new agent with the specified configuration
func (f *AcpAgentFactory) CreateAgent(config agent.AgentConfig) (agent.Agent, error) {
	// If cliPath not specified, auto-detect the CLI path
	if config.CliPath == "" {
		backend, err := protocol.GetBackendFromString(config.Backend)
		if err != nil {
			return nil, err
		}

		cliInfo := f.detectCLI(backend)
		if !cliInfo.IsAvailable || cliInfo.Path == "" {
			return nil, &CliNotFoundError{
				Backend: config.Backend,
			}
		}

		config.CliPath = cliInfo.Path
	}

	return agent.NewAcpAgent(config)
}

// GetSupportedBackends returns a list of supported backend names
func (f *AcpAgentFactory) GetSupportedBackends() []string {
	return []string{
		string(protocol.AcpBackendClaude),
		string(protocol.AcpBackendQwen),
		string(protocol.AcpBackendCodex),
		string(protocol.AcpBackendGemini),
		string(protocol.AcpBackendOpenCode),
	}
}

// detectCLI detects the CLI for the specified backend, with caching
func (f *AcpAgentFactory) detectCLI(backend protocol.AcpBackend) protocol.CLIInfo {
	f.cliInfoMu.RLock()
	if info, exists := f.detectedCLIs[backend]; exists {
		f.cliInfoMu.RUnlock()
		return info
	}
	f.cliInfoMu.RUnlock()

	// Detect CLI if not in cache
	f.cliInfoMu.Lock()
	defer f.cliInfoMu.Unlock()

	// Double-check after acquiring write lock
	if info, exists := f.detectedCLIs[backend]; exists {
		return info
	}

	// Get backend config
	_, err := protocol.GetBackendConfig(backend)
	if err != nil {
		return protocol.CLIInfo{
			Backend:      backend,
			IsAvailable:  false,
			AuthRequired: true,
		}
	}

	// Get CLI info from detector
	cfg := protocol.DefaultDetectionConfig()
	cfg.SkipVersionCheck = true // Skip slow version check for cache
	cliInfos := protocol.DetectCLIs(cfg)
	info := cliInfos[backend]

	// Cache the result
	f.detectedCLIs[backend] = info

	return info
}

// RefreshDetection forces re-detection of all CLIs
func (f *AcpAgentFactory) RefreshDetection() {
	f.cliInfoMu.Lock()
	defer f.cliInfoMu.Unlock()

	// Clear cache
	f.detectedCLIs = make(map[protocol.AcpBackend]protocol.CLIInfo)

	// Re-detect
	cfg := protocol.DefaultDetectionConfig()
	cliInfos := protocol.DetectCLIs(cfg)
	for backend, info := range cliInfos {
		f.detectedCLIs[backend] = info
	}
}

// GetDetectedCLIs returns the cached CLI detection results
func (f *AcpAgentFactory) GetDetectedCLIs() map[protocol.AcpBackend]protocol.CLIInfo {
	f.cliInfoMu.RLock()
	defer f.cliInfoMu.RUnlock()

	// Return a copy to prevent external modification
	result := make(map[protocol.AcpBackend]protocol.CLIInfo)
	for backend, info := range f.detectedCLIs {
		result[backend] = info
	}

	return result
}

// CliNotFoundError is returned when a CLI is not found for a backend
type CliNotFoundError struct {
	Backend string
}

func (e *CliNotFoundError) Error() string {
	return fmt.Sprintf("CLI not found for backend: %s", e.Backend)
}
