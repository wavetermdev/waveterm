// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package mcpclient

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const MCPConfigFileName = ".mcp.json"

// NormalizeMCPDir ensures the path is a directory, not a file path.
// If a file path is given (e.g. /path/to/.mcp.json), it returns the parent directory.
func NormalizeMCPDir(dir string) string {
	info, err := os.Stat(dir)
	if err == nil && !info.IsDir() {
		return filepath.Dir(dir)
	}
	return dir
}

// LoadMCPConfig searches for .mcp.json in the given directory and returns parsed server configs.
func LoadMCPConfig(dir string) (map[string]MCPServerConfig, error) {
	dir = NormalizeMCPDir(dir)
	configPath := filepath.Join(dir, MCPConfigFileName)
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading %s: %w", configPath, err)
	}
	var config MCPConfigFile
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", configPath, err)
	}
	// Set default CWD to the directory containing the config file
	for name, sc := range config.McpServers {
		if sc.Cwd == "" {
			sc.Cwd = dir
		}
		if sc.Type == "" {
			sc.Type = "stdio"
		}
		config.McpServers[name] = sc
	}
	return config.McpServers, nil
}
