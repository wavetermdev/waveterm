// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileutil

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

type DirEntryOut struct {
	Name         string `json:"name"`
	Dir          bool   `json:"dir,omitempty"`
	Symlink      bool   `json:"symlink,omitempty"`
	Size         int64  `json:"size,omitempty"`
	Mode         string `json:"mode"`
	Modified     string `json:"modified"`
	ModifiedTime string `json:"modified_time"`
}

type ReadDirResult struct {
	Path         string        `json:"path"`
	AbsolutePath string        `json:"absolute_path"`
	ParentDir    string        `json:"parent_dir,omitempty"`
	Entries      []DirEntryOut `json:"entries"`
	EntryCount   int           `json:"entry_count"`
	TotalEntries int           `json:"total_entries"`
	Truncated    bool          `json:"truncated,omitempty"`
}

func ReadDir(path string, maxEntries int) (*ReadDirResult, error) {
	expandedPath, err := wavebase.ExpandHomeDir(path)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat path: %w", err)
	}

	if !fileInfo.IsDir() {
		return nil, fmt.Errorf("path is not a directory")
	}

	entries, err := os.ReadDir(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	totalEntries := len(entries)

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

	sort.Slice(entries, func(i, j int) bool {
		iIsDir := isDirMap[entries[i].Name()]
		jIsDir := isDirMap[entries[j].Name()]
		if iIsDir != jIsDir {
			return iIsDir
		}
		return entries[i].Name() < entries[j].Name()
	})

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

	result := &ReadDirResult{
		Path:         path,
		AbsolutePath: expandedPath,
		Entries:      entryList,
		EntryCount:   len(entryList),
		TotalEntries: totalEntries,
		Truncated:    truncated,
	}

	parentDir := filepath.Dir(expandedPath)
	if parentDir != expandedPath {
		result.ParentDir = parentDir
	}

	return result, nil
}