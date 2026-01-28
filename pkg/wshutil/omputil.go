// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// OmpConfigFormat represents the format of an OMP config file
type OmpConfigFormat string

const (
	OmpFormatJSON    OmpConfigFormat = "json"
	OmpFormatTOML    OmpConfigFormat = "toml"
	OmpFormatYAML    OmpConfigFormat = "yaml"
	OmpFormatUnknown OmpConfigFormat = "unknown"
)

// OmpConfigInfo contains information about the user's OMP configuration
type OmpConfigInfo struct {
	ConfigPath     string            `json:"configpath"`
	Format         OmpConfigFormat   `json:"format"`
	Exists         bool              `json:"exists"`
	Readable       bool              `json:"readable"`
	Writable       bool              `json:"writable"`
	CurrentPalette map[string]string `json:"currentpalette,omitempty"`
	Error          string            `json:"error,omitempty"`
}

// getWindowsDocumentsFolder returns the user's Documents folder path on Windows.
// This handles OneDrive-redirected Documents folders that aren't covered by
// standard environment variables ($OneDrive, $OneDriveConsumer, etc.).
// Uses the Windows registry (Shell Folders) for the resolved path.
// Result is cached after first call.
var (
	windowsDocsFolderOnce sync.Once
	windowsDocsFolder     string
)

func getWindowsDocumentsFolder() string {
	if runtime.GOOS != "windows" {
		return ""
	}
	windowsDocsFolderOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "reg", "query",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders`,
			"/v", "Personal")
		output, err := cmd.Output()
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(output), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "Personal") {
				if idx := strings.Index(trimmed, "REG_SZ"); idx != -1 {
					p := strings.TrimSpace(trimmed[idx+len("REG_SZ"):])
					if p != "" {
						windowsDocsFolder = p
					}
				}
				break
			}
		}
	})
	return windowsDocsFolder
}

// ValidateOmpConfigPath checks if the path is safe for OMP config operations
func ValidateOmpConfigPath(path string) error {
	// Check for path traversal sequences
	if strings.Contains(path, "..") {
		return fmt.Errorf("path contains traversal sequence")
	}

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(path))
	validExts := map[string]bool{".json": true, ".yaml": true, ".yml": true, ".toml": true}

	// Also accept .omp.json pattern
	isOmpJson := strings.HasSuffix(strings.ToLower(path), ".omp.json")

	if !validExts[ext] && !isOmpJson {
		return fmt.Errorf("invalid config extension: %s", ext)
	}

	// Get absolute path to resolve any relative components
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("cannot resolve path: %w", err)
	}

	// Ensure the path is within user directories (home, appdata, etc.)
	homeDir := os.Getenv("HOME")
	if homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
	}

	localAppData := os.Getenv("LOCALAPPDATA")
	appData := os.Getenv("APPDATA")
	oneDrive := os.Getenv("OneDrive")
	oneDriveConsumer := os.Getenv("OneDriveConsumer")
	oneDriveCommercial := os.Getenv("OneDriveCommercial")

	// Path must be under one of these directories
	validPrefixes := []string{homeDir}
	if localAppData != "" {
		validPrefixes = append(validPrefixes, localAppData)
	}
	if appData != "" {
		validPrefixes = append(validPrefixes, appData)
	}
	if oneDrive != "" {
		validPrefixes = append(validPrefixes, oneDrive)
	}
	if oneDriveConsumer != "" {
		validPrefixes = append(validPrefixes, oneDriveConsumer)
	}
	if oneDriveCommercial != "" {
		validPrefixes = append(validPrefixes, oneDriveCommercial)
	}

	// On Windows, also check the Documents folder. It may be on a OneDrive
	// that isn't represented by any standard env var (e.g. personal OneDrive
	// when $OneDriveConsumer is empty). The Documents folder is where
	// PowerShell profiles and OMP configs often live.
	if runtime.GOOS == "windows" {
		docsFolder := getWindowsDocumentsFolder()
		if docsFolder != "" {
			validPrefixes = append(validPrefixes, docsFolder)
			// Also add the parent dir (the OneDrive root)
			if parent := filepath.Dir(docsFolder); parent != "" && parent != docsFolder {
				validPrefixes = append(validPrefixes, parent)
			}
		}
	}

	isUnderValidDir := false
	for _, prefix := range validPrefixes {
		if prefix != "" {
			absPrefix, _ := filepath.Abs(prefix)
			if strings.HasPrefix(absPath, absPrefix) {
				isUnderValidDir = true
				break
			}
		}
	}

	if !isUnderValidDir {
		return fmt.Errorf("path must be within user directories")
	}

	return nil
}

// GetOmpConfigPath finds the OMP config path from $POSH_THEME, shell profiles, or default locations
func GetOmpConfigPath() (string, error) {
	// Priority 1: $POSH_THEME environment variable
	poshTheme := os.Getenv("POSH_THEME")
	if poshTheme != "" {
		if _, err := os.Stat(poshTheme); err == nil {
			if err := ValidateOmpConfigPath(poshTheme); err != nil {
				return "", fmt.Errorf("invalid POSH_THEME path: %w", err)
			}
			return poshTheme, nil
		}
	}

	// Priority 2: Ask the user's shell for $POSH_THEME (loads their profile)
	if configPath := getOmpConfigFromShell(); configPath != "" {
		if err := ValidateOmpConfigPath(configPath); err == nil {
			return configPath, nil
		}
	}

	// Priority 3: Parse shell profiles for oh-my-posh --config patterns
	if configPath := findOmpConfigFromShellProfiles(); configPath != "" {
		if err := ValidateOmpConfigPath(configPath); err == nil {
			return configPath, nil
		}
	}

	// Priority 4: Platform-specific defaults
	var defaultPaths []string

	if runtime.GOOS == "windows" {
		userProfile := os.Getenv("USERPROFILE")
		localAppData := os.Getenv("LOCALAPPDATA")
		appData := os.Getenv("APPDATA")
		poshThemesPath := os.Getenv("POSH_THEMES_PATH")

		defaultPaths = []string{
			filepath.Join(userProfile, ".config", "oh-my-posh", "config.json"),
			filepath.Join(userProfile, ".config", "oh-my-posh", "config.yaml"),
			filepath.Join(userProfile, ".config", "oh-my-posh", "config.toml"),
			filepath.Join(appData, "oh-my-posh", "config.json"),
			filepath.Join(localAppData, "Programs", "oh-my-posh", "themes", "custom.omp.json"),
		}

		// Also check POSH_THEMES_PATH if set (OMP installer sets this)
		if poshThemesPath != "" {
			defaultPaths = append(defaultPaths, filepath.Join(poshThemesPath, "custom.omp.json"))
		}
	} else {
		homeDir := os.Getenv("HOME")
		defaultPaths = []string{
			filepath.Join(homeDir, ".config", "oh-my-posh", "config.json"),
			filepath.Join(homeDir, ".config", "oh-my-posh", "config.yaml"),
			filepath.Join(homeDir, ".config", "oh-my-posh", "config.toml"),
			filepath.Join(homeDir, ".oh-my-posh", "config.json"),
		}
	}

	for _, path := range defaultPaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("OMP config not found")
}

// getOmpConfigFromShell asks the user's shell to load its profile and return $POSH_THEME.
// On Windows, this runs PowerShell with the user's profile to get the actual value
// of $env:POSH_THEME after all profile scripts have executed.
// This handles any profile setup (OneDrive paths, variable expansion, conditional logic).
func getOmpConfigFromShell() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if runtime.GOOS == "windows" {
		// Load the user's PowerShell profile and check multiple sources for the OMP config path:
		// 1. $env:POSH_THEME - set by modern OMP init (oh-my-posh init pwsh)
		// 2. $themePath - common variable name in OMP profile scripts
		// 3. $OhMyPoshTheme joined with theme directory - another common pattern
		psCommand := `. $PROFILE *>$null; ` +
			`if ($env:POSH_THEME) { $env:POSH_THEME } ` +
			`elseif ($themePath -and (Test-Path $themePath)) { $themePath } ` +
			`elseif ($OhMyPoshTheme) { ` +
			`  $p = if ($env:POSH_THEMES_PATH) { Join-Path $env:POSH_THEMES_PATH $OhMyPoshTheme } ` +
			`  else { Join-Path "$env:LOCALAPPDATA" "Programs\oh-my-posh\themes\$OhMyPoshTheme" }; ` +
			`  if (Test-Path $p) { $p } ` +
			`}`

		// Try pwsh first (PowerShell 7+), then fall back to powershell.exe (5.x)
		for _, shell := range []string{"pwsh.exe", "powershell.exe"} {
			cmd := exec.CommandContext(ctx, shell, "-NoLogo", "-NonInteractive", "-Command", psCommand)
			output, err := cmd.Output()
			if err != nil {
				continue
			}
			// PowerShell may output extra lines (e.g., "Active code page: 65001")
			// and ANSI escape codes. Extract the last non-empty line as the path.
			configPath := extractLastLine(stripAnsiCodes(string(output)))
			if configPath != "" {
				if _, err := os.Stat(configPath); err == nil {
					return configPath
				}
			}
		}
	} else {
		// On Unix, try sourcing common shell profiles
		for _, shellCmd := range []struct {
			shell string
			args  []string
		}{
			{"bash", []string{"-l", "-c", "echo $POSH_THEME"}},
			{"zsh", []string{"-l", "-c", "echo $POSH_THEME"}},
		} {
			cmd := exec.CommandContext(ctx, shellCmd.shell, shellCmd.args...)
			output, err := cmd.Output()
			if err != nil {
				continue
			}
			configPath := strings.TrimSpace(string(output))
			if configPath != "" {
				if _, err := os.Stat(configPath); err == nil {
					return configPath
				}
			}
		}
	}

	return ""
}

// stripAnsiCodes removes ANSI escape sequences from a string.
// PowerShell may produce these in its output even with -NoLogo.
var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

func stripAnsiCodes(s string) string {
	return ansiRegex.ReplaceAllString(s, "")
}

// extractLastLine returns the last non-empty line from multi-line output.
// This handles PowerShell outputting extra lines like "Active code page: 65001"
// before the actual result.
func extractLastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line != "" {
			return line
		}
	}
	return ""
}

// findOmpConfigFromShellProfiles parses shell profile files to extract
// the OMP config path from init commands like:
//
//	oh-my-posh init pwsh --config 'C:\path\to\theme.omp.json'
//	oh-my-posh init bash --config ~/.config/oh-my-posh/theme.json
func findOmpConfigFromShellProfiles() string {
	var profilePaths []string

	if runtime.GOOS == "windows" {
		// Ask PowerShell where its profile actually is (handles OneDrive, custom paths, etc.)
		profilePaths = getWindowsShellProfilePaths()
	} else {
		homeDir := os.Getenv("HOME")
		profilePaths = []string{
			filepath.Join(homeDir, ".bashrc"),
			filepath.Join(homeDir, ".zshrc"),
			filepath.Join(homeDir, ".profile"),
			filepath.Join(homeDir, ".bash_profile"),
		}
	}

	for _, profilePath := range profilePaths {
		if configPath := parseOmpConfigFromProfile(profilePath); configPath != "" {
			return configPath
		}
	}

	return ""
}

// getWindowsShellProfilePaths asks PowerShell for its actual $PROFILE path
// rather than guessing. This correctly handles OneDrive, custom Documents
// locations, and any other non-standard configuration.
func getWindowsShellProfilePaths() []string {
	var paths []string

	// Try pwsh (PowerShell 7+) first, then powershell.exe (Windows PowerShell 5.x)
	for _, shell := range []string{"pwsh.exe", "powershell.exe"} {
		cmd := exec.Command(shell, "-NoProfile", "-NoLogo", "-NonInteractive", "-Command", "Write-Output $PROFILE")
		output, err := cmd.Output()
		if err == nil {
			profilePath := strings.TrimSpace(string(output))
			if profilePath != "" {
				paths = append(paths, profilePath)

				// Also check the directory for other profile variants
				profileDir := filepath.Dir(profilePath)
				parentDir := filepath.Dir(profileDir)

				// If this is WindowsPowerShell, also check PowerShell (and vice versa)
				dirName := filepath.Base(profileDir)
				if dirName == "WindowsPowerShell" {
					paths = append(paths, filepath.Join(parentDir, "PowerShell", "Microsoft.PowerShell_profile.ps1"))
				} else if dirName == "PowerShell" {
					paths = append(paths, filepath.Join(parentDir, "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"))
				}
			}
		}
	}

	// Fallback: also check standard locations in case PowerShell isn't available
	userProfile := os.Getenv("USERPROFILE")
	documentsDir := filepath.Join(userProfile, "Documents")
	paths = append(paths,
		filepath.Join(documentsDir, "PowerShell", "Microsoft.PowerShell_profile.ps1"),
		filepath.Join(documentsDir, "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
	)

	return paths
}

// ompConfigRegex matches oh-my-posh commands with --config flag.
// Handles both subcommand and flag-based invocations:
//
//	oh-my-posh init pwsh --config 'path'
//	oh-my-posh --init --shell pwsh --config $path
var ompConfigRegex = regexp.MustCompile(`oh-my-posh\s+.*--config\s+['"]?([^'")\s]+)['"]?`)

// parseOmpConfigFromProfile reads a shell profile and extracts the OMP config path
func parseOmpConfigFromProfile(profilePath string) string {
	f, err := os.Open(profilePath)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip comments
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}

		matches := ompConfigRegex.FindStringSubmatch(line)
		if len(matches) >= 2 {
			configPath := matches[1]
			configPath = expandEnvVars(configPath)

			if _, err := os.Stat(configPath); err == nil {
				return configPath
			}
		}
	}

	return ""
}

// expandEnvVars expands environment variables in a path.
// Handles $env:VAR (PowerShell), $VAR, and %VAR% (Windows) syntax.
func expandEnvVars(path string) string {
	// Handle PowerShell $env:VAR syntax
	psEnvRegex := regexp.MustCompile(`\$env:(\w+)`)
	path = psEnvRegex.ReplaceAllStringFunc(path, func(match string) string {
		varName := strings.TrimPrefix(match, "$env:")
		return os.Getenv(varName)
	})

	// Handle Unix $VAR and ${VAR} syntax
	path = os.ExpandEnv(path)

	// Handle Windows %VAR% syntax
	if runtime.GOOS == "windows" {
		winEnvRegex := regexp.MustCompile(`%(\w+)%`)
		path = winEnvRegex.ReplaceAllStringFunc(path, func(match string) string {
			varName := strings.Trim(match, "%")
			return os.Getenv(varName)
		})
	}

	// Handle ~ as home directory
	if strings.HasPrefix(path, "~") {
		homeDir := os.Getenv("HOME")
		if homeDir == "" {
			homeDir = os.Getenv("USERPROFILE")
		}
		path = filepath.Join(homeDir, path[1:])
	}

	return path
}

// DetectConfigFormat detects the format from file extension
func DetectConfigFormat(path string) OmpConfigFormat {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".json":
		return OmpFormatJSON
	case ".toml":
		return OmpFormatTOML
	case ".yaml", ".yml":
		return OmpFormatYAML
	default:
		if strings.Contains(strings.ToLower(path), ".omp.json") {
			return OmpFormatJSON
		}
		return OmpFormatUnknown
	}
}

// ExtractPaletteFromConfig extracts the palette section from OMP config
func ExtractPaletteFromConfig(content []byte, format string) (map[string]string, error) {
	if format == string(OmpFormatJSON) || format == "json" {
		var config map[string]interface{}
		if err := json.Unmarshal(content, &config); err != nil {
			return nil, err
		}
		if palette, ok := config["palette"].(map[string]interface{}); ok {
			result := make(map[string]string)
			for k, v := range palette {
				if str, ok := v.(string); ok {
					result[k] = str
				}
			}
			return result, nil
		}
	}
	return nil, nil
}

// MergePaletteIntoConfig merges a palette into an OMP config
func MergePaletteIntoConfig(configPath string, palette map[string]string) ([]byte, error) {
	format := DetectConfigFormat(configPath)

	content, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	switch format {
	case OmpFormatJSON:
		return mergeJSONPalette(content, palette)
	default:
		return nil, fmt.Errorf("unsupported config format: %s", format)
	}
}

func mergeJSONPalette(content []byte, palette map[string]string) ([]byte, error) {
	var config map[string]interface{}
	if err := json.Unmarshal(content, &config); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	config["palette"] = palette

	return json.MarshalIndent(config, "", "  ")
}

// ============================================
// High Contrast Mode - Transparent Segment Detection
// ============================================

// High contrast background colors
const (
	HighContrastDarkBg  = "#1a1a1a"
	HighContrastLightBg = "#f5f5f5"
)

// TransparentSegmentInfo contains information about a segment with transparent background
type TransparentSegmentInfo struct {
	BlockIndex   int    `json:"blockindex"`
	SegmentIndex int    `json:"segmentindex"`
	SegmentType  string `json:"segmenttype"`
	Foreground   string `json:"foreground"`
}

// OmpSegment represents an Oh-My-Posh segment
type OmpSegment struct {
	Type       string                 `json:"type"`
	Style      string                 `json:"style"`
	Foreground string                 `json:"foreground"`
	Background string                 `json:"background"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Templates  []string               `json:"templates,omitempty"`
	Template   string                 `json:"template,omitempty"`
}

// OmpBlock represents a block in the OMP config
type OmpBlock struct {
	Type      string       `json:"type"`
	Alignment string       `json:"alignment"`
	Segments  []OmpSegment `json:"segments"`
}

// OmpConfig represents the full OMP configuration structure
type OmpConfig struct {
	FinalSpace           bool              `json:"final_space,omitempty"`
	ConsoleTitleTemplate string            `json:"console_title_template,omitempty"`
	Blocks               []OmpBlock        `json:"blocks"`
	Palette              map[string]string `json:"palette,omitempty"`
	Version              int               `json:"version,omitempty"`
}

// ParseOmpConfig parses OMP config from JSON content
func ParseOmpConfig(content []byte) (*OmpConfig, error) {
	var config OmpConfig
	if err := json.Unmarshal(content, &config); err != nil {
		return nil, fmt.Errorf("failed to parse OMP config: %w", err)
	}
	return &config, nil
}

// isTransparent checks if a background value represents a transparent background
func isTransparent(bg string) bool {
	bg = strings.TrimSpace(strings.ToLower(bg))
	return bg == "" || bg == "transparent"
}

// DetectTransparentSegments finds all segments with transparent/empty backgrounds
func DetectTransparentSegments(config *OmpConfig) []TransparentSegmentInfo {
	var results []TransparentSegmentInfo

	for blockIdx, block := range config.Blocks {
		for segIdx, segment := range block.Segments {
			if isTransparent(segment.Background) {
				results = append(results, TransparentSegmentInfo{
					BlockIndex:   blockIdx,
					SegmentIndex: segIdx,
					SegmentType:  segment.Type,
					Foreground:   segment.Foreground,
				})
			}
		}
	}

	return results
}

// Note: CalculateLuminance, linearize, and IsLightColor are defined in colorutil.go

// ============================================
// High Contrast Mode Application
// ============================================

// resolveColor resolves a color that might be a palette reference
func resolveColor(color string, palette map[string]string) string {
	// Check if it's a palette reference (e.g., "p:blue")
	if strings.HasPrefix(color, "p:") {
		paletteName := strings.TrimPrefix(color, "p:")
		if resolved, ok := palette[paletteName]; ok {
			return resolved
		}
	}
	return color
}

// ApplyHighContrastMode modifies the config to add contrasting backgrounds
// to transparent segments based on foreground luminance
func ApplyHighContrastMode(config *OmpConfig) *OmpConfig {
	// Deep copy the config to avoid modifying the original
	modified := deepCopyOmpConfig(config)
	if modified == nil {
		return nil
	}

	for blockIdx := range modified.Blocks {
		for segIdx := range modified.Blocks[blockIdx].Segments {
			segment := &modified.Blocks[blockIdx].Segments[segIdx]

			if isTransparent(segment.Background) && segment.Foreground != "" {
				// Resolve foreground color (might be palette reference)
				fgColor := resolveColor(segment.Foreground, modified.Palette)

				// Skip if we still don't have a valid color after resolution
				if fgColor == "" || strings.HasPrefix(fgColor, "p:") {
					// Use dark background as default if color can't be resolved
					segment.Background = HighContrastDarkBg
					continue
				}

				if IsLightColor(fgColor) {
					// Light foreground needs dark background
					segment.Background = HighContrastDarkBg
				} else {
					// Dark foreground needs light background
					segment.Background = HighContrastLightBg
				}
			}
		}
	}

	return modified
}

// deepCopyOmpConfig creates a deep copy of an OmpConfig
func deepCopyOmpConfig(config *OmpConfig) *OmpConfig {
	if config == nil {
		return nil
	}

	// Serialize and deserialize to create a deep copy
	data, err := json.Marshal(config)
	if err != nil {
		return nil
	}

	var copy OmpConfig
	if err := json.Unmarshal(data, &copy); err != nil {
		return nil
	}

	return &copy
}

// SerializeOmpConfig converts an OmpConfig back to JSON
func SerializeOmpConfig(config *OmpConfig) ([]byte, error) {
	return json.MarshalIndent(config, "", "  ")
}

// GetBackupPath returns the backup path for an OMP config
func GetBackupPath(configPath string) string {
	return configPath + ".wave-backup"
}

// CreateOmpBackup creates a backup of the OMP config file
func CreateOmpBackup(configPath string) (string, error) {
	backupPath := GetBackupPath(configPath)

	content, err := os.ReadFile(configPath)
	if err != nil {
		return "", fmt.Errorf("failed to read config for backup: %w", err)
	}

	// Preserve original file permissions
	origInfo, err := os.Stat(configPath)
	mode := os.FileMode(0600)
	if err == nil {
		mode = origInfo.Mode()
	}

	if err := os.WriteFile(backupPath, content, mode); err != nil {
		return "", fmt.Errorf("failed to write backup: %w", err)
	}

	return backupPath, nil
}

// RestoreOmpBackup restores the OMP config from backup
func RestoreOmpBackup(configPath string) error {
	backupPath := GetBackupPath(configPath)

	// Check if backup exists
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		return fmt.Errorf("no backup found at %s", backupPath)
	}

	content, err := os.ReadFile(backupPath)
	if err != nil {
		return fmt.Errorf("failed to read backup: %w", err)
	}

	// Get original config permissions or use default
	origInfo, err := os.Stat(configPath)
	mode := os.FileMode(0644)
	if err == nil {
		mode = origInfo.Mode()
	}

	if err := os.WriteFile(configPath, content, mode); err != nil {
		return fmt.Errorf("failed to restore config: %w", err)
	}

	return nil
}
