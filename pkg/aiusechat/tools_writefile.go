// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func makeFileBackup(absFilePath string) error {
	fileData, err := os.ReadFile(absFilePath)
	if err != nil {
		return fmt.Errorf("failed to read file for backup: %w", err)
	}

	dir := filepath.Dir(absFilePath)
	basename := filepath.Base(absFilePath)

	hash := sha256.Sum256([]byte(dir))
	dirHash8 := hex.EncodeToString(hash[:])[:8]

	uuidV7, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("failed to generate UUID: %w", err)
	}
	uuidStr := uuidV7.String()

	now := time.Now()
	dateStr := now.Format("2006-01-02")

	backupDir := filepath.Join(wavebase.GetWaveCachesDir(), "waveai-backups", dateStr)
	err = os.MkdirAll(backupDir, 0700)
	if err != nil {
		return fmt.Errorf("failed to create backup directory: %w", err)
	}

	backupName := fmt.Sprintf("%s.%s.%s.bak", basename, dirHash8, uuidStr)
	backupPath := filepath.Join(backupDir, backupName)

	err = os.WriteFile(backupPath, fileData, 0600)
	if err != nil {
		return fmt.Errorf("failed to write backup file: %w", err)
	}

	return nil
}

const MaxEditFileSize = 100 * 1024 // 100KB

type writeTextFileParams struct {
	Filename string `json:"filename"`
	Contents string `json:"contents"`
}

func parseWriteTextFileInput(input any) (*writeTextFileParams, error) {
	result := &writeTextFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	if result.Contents == "" {
		return nil, fmt.Errorf("missing contents parameter")
	}

	return result, nil
}

func writeTextFileCallback(input any) (any, error) {
	params, err := parseWriteTextFileInput(input)
	if err != nil {
		return nil, err
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	if blocked, reason := isBlockedFile(expandedPath); blocked {
		return nil, fmt.Errorf("access denied: potentially sensitive file: %s", reason)
	}

	contentsBytes := []byte(params.Contents)
	if utilfn.HasBinaryData(contentsBytes) {
		return nil, fmt.Errorf("contents appear to contain binary data")
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}
	if err == nil {
		if fileInfo.IsDir() {
			return nil, fmt.Errorf("path is a directory, cannot write to it")
		}
		if fileInfo.Size() > MaxEditFileSize {
			return nil, fmt.Errorf("existing file is too large (%d bytes, max %d bytes)", fileInfo.Size(), MaxEditFileSize)
		}
		if fileInfo.Mode().Perm()&0222 == 0 {
			return nil, fmt.Errorf("file is not writable (no write permission)")
		}
	}

	dirPath := filepath.Dir(expandedPath)
	dirInfo, err := os.Stat(dirPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to stat directory: %w", err)
	}
	if err == nil && dirInfo.Mode().Perm()&0222 == 0 {
		return nil, fmt.Errorf("directory is not writable (no write permission)")
	}

	err = os.MkdirAll(dirPath, 0755)
	if err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	err = os.WriteFile(expandedPath, contentsBytes, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully wrote %s (%d bytes)", params.Filename, len(contentsBytes)),
	}, nil
}

func GetWriteTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "write_text_file",
		DisplayName: "Write Text File",
		Description: "Write a text file to the filesystem. Will create or overwrite the file. Maximum file size: 100KB.",
		ToolLogName: "gen:writefile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Path to the file to write. Supports '~' for the user's home directory.",
				},
				"contents": map[string]any{
					"type":        "string",
					"description": "The contents to write to the file",
				},
			},
			"required":             []string{"filename", "contents"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			params, err := parseWriteTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("writing %q", params.Filename)
		},
		ToolAnyCallback: writeTextFileCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}

type editTextFileParams struct {
	Filename string              `json:"filename"`
	Edits    []fileutil.EditSpec `json:"edits"`
}

func parseEditTextFileInput(input any) (*editTextFileParams, error) {
	result := &editTextFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	if len(result.Edits) == 0 {
		return nil, fmt.Errorf("missing edits parameter")
	}

	return result, nil
}

func editTextFileCallback(input any) (any, error) {
	params, err := parseEditTextFileInput(input)
	if err != nil {
		return nil, err
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	if blocked, reason := isBlockedFile(expandedPath); blocked {
		return nil, fmt.Errorf("access denied: potentially sensitive file: %s", reason)
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file does not exist and cannot be edited: %s", params.Filename)
		}
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.IsDir() {
		return nil, fmt.Errorf("path is a directory, cannot edit it")
	}

	if fileInfo.Size() > MaxEditFileSize {
		return nil, fmt.Errorf("file is too large (%d bytes, max %d bytes)", fileInfo.Size(), MaxEditFileSize)
	}

	if fileInfo.Mode().Perm()&0222 == 0 {
		return nil, fmt.Errorf("file is not writable (no write permission)")
	}

	fileData, err := os.ReadFile(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	if utilfn.HasBinaryData(fileData) {
		return nil, fmt.Errorf("file appears to contain binary data")
	}

	err = fileutil.ReplaceInFile(expandedPath, params.Edits)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully edited %s with %d changes", params.Filename, len(params.Edits)),
	}, nil
}

func GetEditTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "edit_text_file",
		DisplayName: "Edit Text File",
		Description: "Edit a text file using precise search and replace. " +
			"Each old_str must appear EXACTLY ONCE in the file or the edit will fail. " +
			"All edits are applied atomically - if any single edit fails, the entire operation fails and no changes are made. " +
			"Maximum file size: 100KB.",
		ToolLogName: "gen:editfile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Path to the file to edit. Supports '~' for the user's home directory.",
				},
				"edits": map[string]any{
					"type":        "array",
					"description": "Array of edit specifications. All edits are applied atomically - if any edit fails, none are applied.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"old_str": map[string]any{
								"type":        "string",
								"description": "The exact string to find and replace. MUST appear exactly once in the file - if it appears zero times or multiple times, the entire edit operation will fail.",
							},
							"new_str": map[string]any{
								"type":        "string",
								"description": "The string to replace with",
							},
							"desc": map[string]any{
								"type":        "string",
								"description": "Description of what this edit does",
							},
						},
						"required": []string{"old_str", "new_str"},
					},
				},
			},
			"required":             []string{"filename", "edits"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			params, err := parseEditTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("editing %q (%d edits)", params.Filename, len(params.Edits))
		},
		ToolAnyCallback: editTextFileCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
