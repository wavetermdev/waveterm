// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// DetectedShell represents a shell found on the system
type DetectedShell struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ShellPath string `json:"shellpath"`
	ShellType string `json:"shelltype"`
	Version   string `json:"version,omitempty"`
	Source    string `json:"source"`
	Icon      string `json:"icon,omitempty"`
	IsDefault bool   `json:"isdefault,omitempty"`
}

// Shell source constants
const (
	ShellSource_File      = "file"
	ShellSource_Wsl       = "wsl"
	ShellSource_Homebrew  = "homebrew"
	ShellSource_EtcShells = "etc-shells"
	ShellSource_Static    = "static"
	ShellSource_Path      = "path"
)

// Icon constants
const (
	ShellIcon_Powershell = "powershell"
	ShellIcon_Terminal   = "terminal"
	ShellIcon_Linux      = "linux"
	ShellIcon_Cmd        = "cmd"
)

var (
	shellDetectCache     []DetectedShell
	shellDetectCacheLock sync.Mutex
	shellDetectCacheTime time.Time
	shellDetectCacheTTL  = 5 * time.Minute
)

// GenerateShellID creates a deterministic ID from shell type and path
func GenerateShellID(shellType, shellPath string) string {
	hash := sha256.Sum256([]byte(shellPath))
	return fmt.Sprintf("%s-%x", shellType, hash[:4])
}

// DetectAllShells returns all detected shells on the system
func DetectAllShells(config *wconfig.FullConfigType, rescan bool) ([]DetectedShell, error) {
	shellDetectCacheLock.Lock()
	defer shellDetectCacheLock.Unlock()

	// Check cache unless rescan is requested
	if !rescan && len(shellDetectCache) > 0 && time.Since(shellDetectCacheTime) < shellDetectCacheTTL {
		return shellDetectCache, nil
	}

	shells, err := detectPlatformShells(config, rescan)
	if err != nil {
		log.Printf("error detecting platform shells: %v", err)
		// Return empty slice instead of error - partial results are acceptable
		shells = []DetectedShell{}
	}

	// Deduplicate and sort
	shells = deduplicateShells(shells)
	sortShells(shells)

	// Mark default shell
	markDefaultShell(shells)

	// Update cache
	shellDetectCache = shells
	shellDetectCacheTime = time.Now()

	return shells, nil
}

// deduplicateShells removes duplicate shells based on path
func deduplicateShells(shells []DetectedShell) []DetectedShell {
	seen := make(map[string]bool)
	result := make([]DetectedShell, 0, len(shells))

	for _, shell := range shells {
		// Normalize path for comparison
		normalizedPath := strings.ToLower(filepath.Clean(shell.ShellPath))
		if seen[normalizedPath] {
			continue
		}
		seen[normalizedPath] = true
		result = append(result, shell)
	}

	return result
}

// sortShells sorts shells by type priority, then by name
func sortShells(shells []DetectedShell) {
	// Priority order for shell types
	typePriority := map[string]int{
		ShellType_pwsh: 1,
		ShellType_bash: 2,
		ShellType_zsh:  3,
		ShellType_fish: 4,
		ShellType_cmd:  5,
	}

	sort.Slice(shells, func(i, j int) bool {
		// First sort by source (WSL shells at the end)
		if shells[i].Source == ShellSource_Wsl && shells[j].Source != ShellSource_Wsl {
			return false
		}
		if shells[i].Source != ShellSource_Wsl && shells[j].Source == ShellSource_Wsl {
			return true
		}

		// Then by type priority
		pi := typePriority[shells[i].ShellType]
		pj := typePriority[shells[j].ShellType]
		if pi == 0 {
			pi = 99
		}
		if pj == 0 {
			pj = 99
		}
		if pi != pj {
			return pi < pj
		}

		// Finally by name
		return shells[i].Name < shells[j].Name
	})
}

// markDefaultShell marks the system default shell
func markDefaultShell(shells []DetectedShell) {
	defaultShellPath := DetectLocalShellPath()
	normalizedDefault := strings.ToLower(filepath.Clean(defaultShellPath))

	for i := range shells {
		normalizedShell := strings.ToLower(filepath.Clean(shells[i].ShellPath))
		if normalizedShell == normalizedDefault {
			shells[i].IsDefault = true
			return
		}
	}
}

// getShellVersionSafe gets shell version without failing
func getShellVersionSafe(shellPath string, shellType string) string {
	// Skip version detection for cmd
	if shellType == ShellType_cmd {
		return ""
	}

	_, version, err := DetectShellTypeAndVersionFromPath(shellPath)
	if err != nil {
		log.Printf("debug: could not get version for %s: %v", shellPath, err)
		return ""
	}
	return version
}

// fileExists checks if a file exists and is not a directory
func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

// lookupExecutable tries to find an executable in PATH
func lookupExecutable(name string) string {
	path, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return path
}

// getIconForShellType returns the appropriate icon for a shell type
func getIconForShellType(shellType string) string {
	switch shellType {
	case ShellType_pwsh:
		return ShellIcon_Powershell
	case ShellType_cmd:
		return ShellIcon_Cmd
	default:
		return ShellIcon_Terminal
	}
}

// createShell is a helper to create a DetectedShell with all fields populated
func createShell(name, shellPath, shellType, source string, detectVersion bool) DetectedShell {
	shell := DetectedShell{
		ID:        GenerateShellID(shellType, shellPath),
		Name:      name,
		ShellPath: shellPath,
		ShellType: shellType,
		Source:    source,
		Icon:      getIconForShellType(shellType),
	}

	if detectVersion {
		shell.Version = getShellVersionSafe(shellPath, shellType)
		// Update name with version if available
		if shell.Version != "" && !strings.Contains(name, shell.Version) {
			shell.Name = fmt.Sprintf("%s %s", name, shell.Version)
		}
	}

	return shell
}
