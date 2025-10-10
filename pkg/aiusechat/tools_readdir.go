// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const ReadDirDefaultMaxEntries = 1000

type readDirParams struct {
	Path       string `json:"path"`
	MaxEntries *int   `json:"max_entries"`
}

func parseReadDirInput(input any) (*readDirParams, error) {
	result := &readDirParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Path == "" {
		return nil, fmt.Errorf("missing path parameter")
	}

	if result.MaxEntries == nil {
		maxEntries := ReadDirDefaultMaxEntries
		result.MaxEntries = &maxEntries
	}

	if *result.MaxEntries < 1 {
		return nil, fmt.Errorf("max_entries must be at least 1, got %d", *result.MaxEntries)
	}

	return result, nil
}

func readDirCallback(input any) (any, error) {
	params, err := parseReadDirInput(input)
	if err != nil {
		return nil, err
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Path)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat path: %w", err)
	}

	if !fileInfo.IsDir() {
		return nil, fmt.Errorf("path is not a directory, cannot be read with the read_dir tool. use the read_text_file tool to read files")
	}

	entries, err := os.ReadDir(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	// Keep track of the original total before truncation
	totalEntries := len(entries)

	// Sort entries: directories first, then files, alphabetically within each group
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() != entries[j].IsDir() {
			return entries[i].IsDir()
		}
		return entries[i].Name() < entries[j].Name()
	})

	// Truncate after sorting to ensure directories come first
	maxEntries := *params.MaxEntries
	var truncated bool
	if len(entries) > maxEntries {
		entries = entries[:maxEntries]
		truncated = true
	}

	var entryList []map[string]any
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			// Skip entries we can't stat
			continue
		}

		entryData := map[string]any{
			"name":     entry.Name(),
			"is_dir":   entry.IsDir(),
			"mode":     info.Mode().String(),
			"modified": utilfn.FormatRelativeTime(info.ModTime()),
		}

		if !entry.IsDir() {
			entryData["size"] = info.Size()
		}

		entryList = append(entryList, entryData)
	}

	// Create a formatted directory listing
	var listing strings.Builder
	for _, entry := range entryList {
		name := entry["name"].(string)
		isDir := entry["is_dir"].(bool)
		mode := entry["mode"].(string)
		modified := entry["modified"].(string)

		if isDir {
			listing.WriteString(fmt.Sprintf("[DIR]  %-40s  %s  %s\n", name, mode, modified))
		} else {
			size := entry["size"].(int64)
			listing.WriteString(fmt.Sprintf("[FILE] %-40s  %10d  %s  %s\n", name, size, mode, modified))
		}
	}

	result := map[string]any{
		"path":          params.Path,
		"absolute_path": expandedPath,
		"entry_count":   len(entryList),
		"total_entries": totalEntries,
		"entries":       entryList,
		"listing":       strings.TrimSuffix(listing.String(), "\n"),
	}

	if truncated {
		result["truncated"] = true
		result["truncated_message"] = fmt.Sprintf("Directory listing truncated to %d entries (out of %d total). Increase max_entries to see more.", len(entryList), totalEntries)
	}

	// Get absolute path of parent directory for context
	parentDir := filepath.Dir(expandedPath)
	if parentDir != expandedPath {
		result["parent_dir"] = parentDir
	}

	return result, nil
}

func GetReadDirToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "read_dir",
		DisplayName: "Read Directory",
		Description: "Read a directory from the filesystem and list its contents. Returns information about files and subdirectories including names, types, sizes, permissions, and modification times. Requires user approval.",
		ToolLogName: "gen:readdir",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{
					"type":        "string",
					"description": "Path to the directory to read",
				},
				"max_entries": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"default":     1000,
					"description": "Maximum number of entries to return. Defaults to 1000.",
				},
			},
			"required":             []string{"path"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			parsed, err := parseReadDirInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("reading directory %q", parsed.Path)
		},
		ToolAnyCallback: readDirCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
