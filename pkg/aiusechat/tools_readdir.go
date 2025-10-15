// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const ReadDirDefaultMaxEntries = 500
const ReadDirHardMaxEntries = 10000

type readDirParams struct {
	Path       string `json:"path"`
	MaxEntries *int   `json:"max_entries"`
}

type DirEntryOut struct {
	Name         string `json:"name"`
	Dir          bool   `json:"dir,omitempty"`
	Symlink      bool   `json:"symlink,omitempty"`
	Size         int64  `json:"size,omitempty"`
	Mode         string `json:"mode"`
	Modified     string `json:"modified"`
	ModifiedTime string `json:"modified_time"`
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

	if *result.MaxEntries > ReadDirHardMaxEntries {
		return nil, fmt.Errorf("max_entries cannot exceed %d, got %d", ReadDirHardMaxEntries, *result.MaxEntries)
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

	// Build a map of actual directory status, checking symlink targets
	isDirMap := make(map[string]bool)
	symlinkCount := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.Type()&fs.ModeSymlink != 0 {
			if symlinkCount < 1000 {
				symlinkCount++
				fullPath := filepath.Join(expandedPath, name)
				if info, err := os.Stat(fullPath); err == nil {
					isDirMap[name] = info.IsDir()
				} else {
					isDirMap[name] = entry.IsDir()
				}
			} else {
				isDirMap[name] = entry.IsDir()
			}
		} else {
			isDirMap[name] = entry.IsDir()
		}
	}

	// Sort entries: directories first, then files, alphabetically within each group
	sort.Slice(entries, func(i, j int) bool {
		iIsDir := isDirMap[entries[i].Name()]
		jIsDir := isDirMap[entries[j].Name()]
		if iIsDir != jIsDir {
			return iIsDir
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

	var entryList []DirEntryOut
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		isDir := isDirMap[entry.Name()]
		isSymlink := entry.Type()&fs.ModeSymlink != 0

		entryData := DirEntryOut{
			Name:         entry.Name(),
			Dir:          isDir,
			Symlink:      isSymlink,
			Mode:         info.Mode().String(),
			Modified:     utilfn.FormatRelativeTime(info.ModTime()),
			ModifiedTime: info.ModTime().UTC().Format(time.RFC3339),
		}

		if !isDir {
			entryData.Size = info.Size()
		}

		entryList = append(entryList, entryData)
	}

	result := map[string]any{
		"path":          params.Path,
		"absolute_path": expandedPath,
		"entry_count":   len(entryList),
		"total_entries": totalEntries,
		"entries":       entryList,
	}

	if truncated {
		result["truncated"] = true
		result["truncated_message"] = fmt.Sprintf("Directory listing truncated to %d entries (out of %d total). Increase max_entries to see more.", len(entryList), totalEntries)
	}

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
		Description: "Read a directory from the filesystem and list its contents. Returns information about files and subdirectories including names, types, sizes, permissions, and modification times.",
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
					"maximum":     10000,
					"default":     500,
					"description": "Maximum number of entries to return. Defaults to 500, max 10000.",
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
			return fmt.Sprintf("reading directory %q (max_entries: %d)", parsed.Path, *parsed.MaxEntries)
		},
		ToolAnyCallback: readDirCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
