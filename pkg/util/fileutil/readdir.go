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

func ReadDirRecursive(path string, maxEntries int) (*ReadDirResult, error) {
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

	var allEntries []DirEntryOut
	isDirMap := make(map[string]bool)
	var truncated bool

	err = filepath.WalkDir(expandedPath, func(fullPath string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if fullPath == expandedPath {
			return nil
		}

		if len(allEntries) >= maxEntries {
			truncated = true
			return fs.SkipAll
		}

		relativePath, _ := filepath.Rel(expandedPath, fullPath)

		isSymlink := d.Type()&fs.ModeSymlink != 0

		info, infoErr := d.Info()
		if infoErr != nil {
			return nil
		}

		isDir := d.IsDir()
		isDirMap[relativePath] = isDir

		entryData := DirEntryOut{
			Name:         relativePath,
			Dir:          isDir,
			Symlink:      isSymlink,
			Mode:         info.Mode().String(),
			Modified:     utilfn.FormatRelativeTime(info.ModTime()),
			ModifiedTime: info.ModTime().UTC().Format(time.RFC3339),
		}

		if !isDir {
			entryData.Size = info.Size()
		}

		allEntries = append(allEntries, entryData)

		if isSymlink && isDir {
			return fs.SkipDir
		}

		return nil
	})

	if err != nil && err != fs.SkipAll {
		return nil, fmt.Errorf("failed to walk directory: %w", err)
	}

	sort.Slice(allEntries, func(i, j int) bool {
		iIsDir := isDirMap[allEntries[i].Name]
		jIsDir := isDirMap[allEntries[j].Name]
		if iIsDir != jIsDir {
			return iIsDir
		}
		return allEntries[i].Name < allEntries[j].Name
	})

	result := &ReadDirResult{
		Path:         path,
		AbsolutePath: expandedPath,
		Entries:      allEntries,
		EntryCount:   len(allEntries),
		TotalEntries: 0,
		Truncated:    truncated,
	}

	parentDir := filepath.Dir(expandedPath)
	if parentDir != expandedPath {
		result.ParentDir = parentDir
	}

	return result, nil
}