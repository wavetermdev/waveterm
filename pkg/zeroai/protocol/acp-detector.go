// Package protocol implements ACP (Agent Control Protocol) CLI detection
//
// This file provides CLI detection functionality for available ACP backends.
package protocol

import (
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

// CliInfo represents information about a detected CLI
type CliInfo struct {
	Backend    AcpBackend `json:"backend"`
	Path       string     `json:"path"`
	Available  bool       `json:"available"`
	Version    string     `json:"version,omitempty"`
}

// DetectCLIs detects all available ACP CLIs on the system
func DetectCLIs() []CliInfo {
	backends := []AcpBackend{AcpBackendClaude, AcpBackendQwen, AcpBackendGemini, AcpBackendCodex, AcpBackendOpenCode}

	var wg sync.WaitGroup
	results := make(chan CliInfo, len(backends))

	for _, backend := range backends {
		wg.Add(1)
		go func(b AcpBackend) {
			defer wg.Done()
			cfg := GetBackendConfig(b)
			info := CliInfo{
				Backend: b,
				Path:    cfg.DefaultCliPath,
			}

			if cfg.DefaultCliPath == "" {
				results <- info
				return
			}

			available, version := detectCLI(cfg.DefaultCliPath)
			info.Available = available
			if available && version != "" {
				info.Version = version
			}
			results <- info
		}(backend)
	}

	wg.Wait()
	close(results)

	var cliInfos []CliInfo
	for info := range results {
		cliInfos = append(cliInfos, info)
	}

	return cliInfos
}

// detectCLI checks if a CLI is available and returns its version
func detectCLI(cliPath string) (bool, string) {
	// Check if command exists
	cmd := exec.Command(checkCommand(), cliPath, "--version")
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Try --version flag might not work, try other options
		cmd = exec.Command(checkCommand(), cliPath, "version")
		output, err = cmd.CombinedOutput()
		if err != nil {
			// Just check if command exists
			cmd = exec.Command(checkCommand(), cliPath)
			err = cmd.Run()
			if err != nil {
				return false, ""
			}
			return true, ""
		}
	}

	// Parse version from output
	version := parseVersion(string(output))
	return true, version
}

// checkCommand returns the command to check for executable
// On Unix it's "which", on Windows it's "Get-Command" (PowerShell) or "where"
func checkCommand() string {
	if runtime.GOOS == "windows" {
		// PowerShell is available in all recent Windows versions
		if _, err := exec.LookPath("powershell"); err == nil {
			return "powershell"
		}
		// Fallback to where.exe
		return "where"
	}
	return "which"
}

// parseVersion extracts version string from command output
func parseVersion(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "version") ||
			strings.HasPrefix(line, "Version") ||
			strings.Contains(line, "v") ||
			strings.Contains(line, "VER") {
			return line
		}
	}
	return ""
}

// IsCLIAvailable checks if a specific CLI is available
func IsCLIAvailable(backend AcpBackend) bool {
	cfg := GetBackendConfig(backend)
	if cfg.DefaultCliPath == "" {
		return false
	}

	available, _ := detectCLI(cfg.DefaultCliPath)
	return available
}

// GetCLIAvailable returns a list of all available CLIs
func GetCLIAvailable() []AcpBackend {
	cliInfos := DetectCLIs()
	var available []AcpBackend
	for _, info := range cliInfos {
		if info.Available {
			available = append(available, info.Backend)
		}
	}
	return available
}
