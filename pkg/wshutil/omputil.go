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
