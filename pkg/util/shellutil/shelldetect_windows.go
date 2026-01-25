//go:build windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wsl"
)

// InvalidWslDistroNames are WSL distros that should be filtered out
var InvalidWslDistroNames = []string{"docker-desktop", "docker-desktop-data", "rancher-desktop"}

// detectPlatformShells detects all available shells on Windows
func detectPlatformShells(config *wconfig.FullConfigType, rescan bool) ([]DetectedShell, error) {
	var shells []DetectedShell

	// 1. Command Prompt (static path)
	if shell := detectCommandPrompt(); shell != nil {
		shells = append(shells, *shell)
	}

	// 2. Windows PowerShell 5.1 (static path)
	if shell := detectWindowsPowerShell(); shell != nil {
		shells = append(shells, *shell)
	}

	// 3. PowerShell Core (multiple locations)
	shells = append(shells, detectPowerShellCore()...)

	// 4. Git Bash
	if shell := detectGitBash(config, rescan); shell != nil {
		shells = append(shells, *shell)
	}

	// 5. WSL Distributions
	shells = append(shells, detectWslDistros()...)

	// 6. Cygwin
	if shell := detectCygwin(); shell != nil {
		shells = append(shells, *shell)
	}

	return shells, nil
}

// detectCommandPrompt detects the Windows Command Prompt
func detectCommandPrompt() *DetectedShell {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}

	cmdPath := filepath.Join(systemRoot, "System32", "cmd.exe")
	if !fileExists(cmdPath) {
		log.Printf("debug: cmd.exe not found at %s", cmdPath)
		return nil
	}

	return &DetectedShell{
		ID:        GenerateShellID(ShellType_cmd, cmdPath),
		Name:      "Command Prompt",
		ShellPath: cmdPath,
		ShellType: ShellType_cmd,
		Source:    ShellSource_Static,
		Icon:      ShellIcon_Cmd,
	}
}

// detectWindowsPowerShell detects Windows PowerShell 5.1
func detectWindowsPowerShell() *DetectedShell {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}

	psPath := filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	if !fileExists(psPath) {
		log.Printf("debug: Windows PowerShell not found at %s", psPath)
		return nil
	}

	return &DetectedShell{
		ID:        GenerateShellID(ShellType_pwsh, psPath),
		Name:      "Windows PowerShell",
		ShellPath: psPath,
		ShellType: ShellType_pwsh,
		Source:    ShellSource_Static,
		Icon:      ShellIcon_Powershell,
	}
}

// detectPowerShellCore detects PowerShell 7+ installations
func detectPowerShellCore() []DetectedShell {
	var shells []DetectedShell

	// Paths to check
	pathsToCheck := getPowerShellCorePaths()

	for _, checkPath := range pathsToCheck {
		if !fileExists(checkPath) {
			continue
		}

		// Detect version
		version := getShellVersionSafe(checkPath, ShellType_pwsh)
		name := "PowerShell"
		if version != "" {
			name = fmt.Sprintf("PowerShell %s", version)
		}

		shell := DetectedShell{
			ID:        GenerateShellID(ShellType_pwsh, checkPath),
			Name:      name,
			ShellPath: checkPath,
			ShellType: ShellType_pwsh,
			Version:   version,
			Source:    ShellSource_File,
			Icon:      ShellIcon_Powershell,
		}
		shells = append(shells, shell)
	}

	return shells
}

// getPowerShellCorePaths returns all possible PowerShell Core installation paths
func getPowerShellCorePaths() []string {
	var paths []string

	programFiles := os.Getenv("ProgramFiles")
	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	localAppData := os.Getenv("LOCALAPPDATA")
	userProfile := os.Getenv("USERPROFILE")

	// Traditional installs - scan for version directories
	if programFiles != "" {
		psDir := filepath.Join(programFiles, "PowerShell")
		if entries, err := os.ReadDir(psDir); err == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					pwshPath := filepath.Join(psDir, entry.Name(), "pwsh.exe")
					paths = append(paths, pwshPath)
				}
			}
		}
	}

	if programFilesX86 != "" {
		psDir := filepath.Join(programFilesX86, "PowerShell")
		if entries, err := os.ReadDir(psDir); err == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					pwshPath := filepath.Join(psDir, entry.Name(), "pwsh.exe")
					paths = append(paths, pwshPath)
				}
			}
		}
	}

	// Microsoft Store / MSIX
	if localAppData != "" {
		paths = append(paths, filepath.Join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe"))
	}

	// Dotnet global tools
	if userProfile != "" {
		paths = append(paths, filepath.Join(userProfile, ".dotnet", "tools", "pwsh.exe"))
	}

	// Scoop
	if userProfile != "" {
		paths = append(paths, filepath.Join(userProfile, "scoop", "shims", "pwsh.exe"))
	}

	return paths
}

// detectGitBash detects Git Bash installation using existing FindGitBash function
func detectGitBash(config *wconfig.FullConfigType, rescan bool) *DetectedShell {
	gitBashPath := FindGitBash(config, rescan)
	if gitBashPath == "" {
		return nil
	}

	return &DetectedShell{
		ID:        GenerateShellID(ShellType_bash, gitBashPath),
		Name:      "Git Bash",
		ShellPath: gitBashPath,
		ShellType: ShellType_bash,
		Source:    ShellSource_File,
		Icon:      ShellIcon_Terminal,
	}
}

// detectWslDistros detects installed WSL distributions
func detectWslDistros() []DetectedShell {
	var shells []DetectedShell

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	distros, err := wsl.RegisteredDistros(ctx)
	if err != nil {
		log.Printf("debug: error getting WSL distros: %v", err)
		return shells
	}

	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}
	wslExePath := filepath.Join(systemRoot, "System32", "wsl.exe")

	for _, distro := range distros {
		distroName := distro.Name()

		// Filter out utility distros
		if isInvalidWslDistro(distroName) {
			continue
		}

		// WSL shells use wsl.exe with -d flag
		// The path format is: wsl.exe -d <distroname>
		// We store just the distro name in the path for identification
		shellPath := fmt.Sprintf("wsl://%s", distroName)

		shell := DetectedShell{
			ID:        GenerateShellID("wsl", shellPath),
			Name:      fmt.Sprintf("WSL: %s", distroName),
			ShellPath: shellPath,
			ShellType: ShellType_bash, // Default to bash for WSL
			Source:    ShellSource_Wsl,
			Icon:      ShellIcon_Linux,
		}

		// Check if this is the default distro
		defaultDistro, ok, _ := wsl.DefaultDistro(ctx)
		if ok && defaultDistro.Name() == distroName {
			// Mark the actual wsl.exe path for the default
			shell.ShellPath = wslExePath
			shell.Name = fmt.Sprintf("WSL: %s (default)", distroName)
		}

		shells = append(shells, shell)
	}

	return shells
}

// isInvalidWslDistro checks if a distro name should be filtered out
func isInvalidWslDistro(name string) bool {
	nameLower := strings.ToLower(name)
	for _, invalid := range InvalidWslDistroNames {
		if strings.HasPrefix(nameLower, strings.ToLower(invalid)) {
			return true
		}
	}
	return false
}

// detectCygwin detects Cygwin bash installation
func detectCygwin() *DetectedShell {
	cygwinPaths := []string{
		`C:\cygwin64\bin\bash.exe`,
		`C:\cygwin\bin\bash.exe`,
	}

	for _, path := range cygwinPaths {
		if fileExists(path) {
			return &DetectedShell{
				ID:        GenerateShellID(ShellType_bash, path),
				Name:      "Cygwin Bash",
				ShellPath: path,
				ShellType: ShellType_bash,
				Source:    ShellSource_File,
				Icon:      ShellIcon_Terminal,
			}
		}
	}

	return nil
}
