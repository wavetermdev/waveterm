//go:build !windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"bufio"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// detectPlatformShells detects all available shells on Unix-like systems (macOS/Linux)
func detectPlatformShells(config *wconfig.FullConfigType, rescan bool) ([]DetectedShell, error) {
	var shells []DetectedShell

	// 1. Parse /etc/shells
	shells = append(shells, parseEtcShells()...)

	// 2. Check Homebrew shells (macOS)
	if runtime.GOOS == "darwin" {
		shells = append(shells, detectHomebrewShells()...)
	}

	// 3. PowerShell Core (cross-platform)
	if shell := detectPowerShellCoreUnix(); shell != nil {
		shells = append(shells, *shell)
	}

	// 4. Additional shells via PATH lookup
	shells = append(shells, detectAdditionalShells()...)

	return shells, nil
}

// parseEtcShells reads and parses /etc/shells
func parseEtcShells() []DetectedShell {
	var shells []DetectedShell

	file, err := os.Open("/etc/shells")
	if err != nil {
		log.Printf("debug: could not open /etc/shells: %v", err)
		return shells
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip comments and empty lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Verify the shell exists
		if !fileExists(line) {
			continue
		}

		shellType := GetShellTypeFromShellPath(line)
		if shellType == ShellType_unknown {
			continue
		}

		name := getShellNameFromPath(line)
		shell := createShell(name, line, shellType, ShellSource_EtcShells, true)
		shells = append(shells, shell)
	}

	if err := scanner.Err(); err != nil {
		log.Printf("debug: error reading /etc/shells: %v", err)
	}

	return shells
}

// detectHomebrewShells detects shells installed via Homebrew
func detectHomebrewShells() []DetectedShell {
	var shells []DetectedShell

	// Homebrew paths (Intel and Apple Silicon)
	homebrewPaths := []string{
		"/opt/homebrew/bin", // Apple Silicon
		"/usr/local/bin",    // Intel
	}

	shellNames := []string{"bash", "zsh", "fish"}

	for _, brewPath := range homebrewPaths {
		for _, shellName := range shellNames {
			shellPath := filepath.Join(brewPath, shellName)
			if !fileExists(shellPath) {
				continue
			}

			// Check if this is actually a Homebrew-installed shell
			// (not a symlink to system shell)
			realPath, err := filepath.EvalSymlinks(shellPath)
			if err == nil && strings.HasPrefix(realPath, "/opt/homebrew") || strings.HasPrefix(realPath, "/usr/local/Cellar") {
				shellType := GetShellTypeFromShellPath(shellPath)
				name := "Homebrew " + strings.Title(shellName)
				shell := createShell(name, shellPath, shellType, ShellSource_Homebrew, true)
				shells = append(shells, shell)
			}
		}
	}

	return shells
}

// detectPowerShellCoreUnix detects PowerShell Core on Unix systems
func detectPowerShellCoreUnix() *DetectedShell {
	// First try PATH lookup
	pwshPath := lookupExecutable("pwsh")
	if pwshPath != "" {
		shell := createShell("PowerShell Core", pwshPath, ShellType_pwsh, ShellSource_Path, true)
		shell.Icon = ShellIcon_Powershell
		return &shell
	}

	// Known installation paths
	knownPaths := []string{
		"/usr/local/bin/pwsh",
		"/opt/microsoft/powershell/7/pwsh",
		"/opt/microsoft/powershell/pwsh",
	}

	// Add Homebrew paths on macOS
	if runtime.GOOS == "darwin" {
		knownPaths = append(knownPaths,
			"/opt/homebrew/bin/pwsh",
			"/usr/local/microsoft/powershell/7/pwsh",
		)
	}

	for _, path := range knownPaths {
		if fileExists(path) {
			shell := createShell("PowerShell Core", path, ShellType_pwsh, ShellSource_File, true)
			shell.Icon = ShellIcon_Powershell
			return &shell
		}
	}

	return nil
}

// detectAdditionalShells detects additional shells via PATH
func detectAdditionalShells() []DetectedShell {
	var shells []DetectedShell

	// Additional shells to look for
	additionalShells := map[string]string{
		"nu":     "nushell", // Nushell
		"elvish": "elvish",  // Elvish
		"xonsh":  "xonsh",   // Xonsh
		"ion":    "ion",     // Ion shell
		"tcsh":   "tcsh",    // TENEX C Shell
		"ksh":    "ksh",     // Korn Shell
	}

	for execName, displayName := range additionalShells {
		shellPath := lookupExecutable(execName)
		if shellPath == "" {
			continue
		}

		// These are all treated as unknown type since we don't have
		// special integration for them
		shell := DetectedShell{
			ID:        GenerateShellID(ShellType_unknown, shellPath),
			Name:      strings.Title(displayName),
			ShellPath: shellPath,
			ShellType: ShellType_unknown,
			Source:    ShellSource_Path,
			Icon:      ShellIcon_Terminal,
		}
		shells = append(shells, shell)
	}

	return shells
}

// getShellNameFromPath returns a display name for a shell based on its path
func getShellNameFromPath(shellPath string) string {
	base := filepath.Base(shellPath)

	// Remove common extensions
	base = strings.TrimSuffix(base, ".exe")

	// Capitalize common shell names
	switch base {
	case "bash":
		return "Bash"
	case "zsh":
		return "Zsh"
	case "fish":
		return "Fish"
	case "sh":
		return "Bourne Shell"
	case "dash":
		return "Dash"
	case "tcsh":
		return "TCSH"
	case "csh":
		return "C Shell"
	case "ksh":
		return "Korn Shell"
	default:
		return strings.Title(base)
	}
}
