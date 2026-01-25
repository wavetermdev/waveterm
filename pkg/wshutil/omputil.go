// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

	// Path must be under one of these directories
	validPrefixes := []string{homeDir}
	if localAppData != "" {
		validPrefixes = append(validPrefixes, localAppData)
	}
	if appData != "" {
		validPrefixes = append(validPrefixes, appData)
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

// GetOmpConfigPath finds the OMP config path from $POSH_THEME or default locations
func GetOmpConfigPath() (string, error) {
	// Priority 1: $POSH_THEME environment variable
	poshTheme := os.Getenv("POSH_THEME")
	if poshTheme != "" {
		if _, err := os.Stat(poshTheme); err == nil {
			// Validate the path before returning
			if err := ValidateOmpConfigPath(poshTheme); err != nil {
				return "", fmt.Errorf("invalid POSH_THEME path: %w", err)
			}
			return poshTheme, nil
		}
	}

	// Priority 2: Platform-specific defaults
	var defaultPaths []string

	if runtime.GOOS == "windows" {
		userProfile := os.Getenv("USERPROFILE")
		localAppData := os.Getenv("LOCALAPPDATA")
		appData := os.Getenv("APPDATA")

		defaultPaths = []string{
			filepath.Join(userProfile, ".config", "oh-my-posh", "config.json"),
			filepath.Join(userProfile, ".config", "oh-my-posh", "config.yaml"),
			filepath.Join(userProfile, ".config", "oh-my-posh", "config.toml"),
			filepath.Join(appData, "oh-my-posh", "config.json"),
			filepath.Join(localAppData, "Programs", "oh-my-posh", "themes", "custom.omp.json"),
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
