// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/filebackup"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const MaxEditFileSize = 100 * 1024 // 100KB

func validateTextFile(expandedPath string, verb string, mustExist bool) (os.FileInfo, error) {
	if blocked, reason := isBlockedFile(expandedPath); blocked {
		return nil, fmt.Errorf("access denied: potentially sensitive file: %s", reason)
	}

	fileInfo, err := os.Lstat(expandedPath)
	if err != nil {
		if os.IsNotExist(err) {
			if mustExist {
				return nil, fmt.Errorf("file does not exist: %s", expandedPath)
			}
			return nil, nil
		}
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.Mode()&os.ModeSymlink != 0 {
		target, _ := os.Readlink(expandedPath)
		if target == "" {
			target = "(unknown)"
		}
		return nil, fmt.Errorf("cannot %s symlinks (target: %s). %s the target file directly if needed", verb, utilfn.MarshalJSONString(target), verb)
	}

	if fileInfo.IsDir() {
		return nil, fmt.Errorf("path is a directory, cannot %s it", verb)
	}

	if !fileInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("path is not a regular file (devices, pipes, sockets not supported)")
	}

	if fileInfo.Size() > MaxEditFileSize {
		return nil, fmt.Errorf("file is too large (%d bytes, max %d bytes)", fileInfo.Size(), MaxEditFileSize)
	}

	fileData, err := os.ReadFile(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	if utilfn.HasBinaryData(fileData) {
		return nil, fmt.Errorf("file appears to contain binary data")
	}

	dirPath := filepath.Dir(expandedPath)
	dirInfo, err := os.Stat(dirPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to stat directory: %w", err)
	}
	if err == nil && dirInfo.Mode().Perm()&0222 == 0 {
		return nil, fmt.Errorf("directory is not writable (no write permission)")
	}

	return fileInfo, nil
}

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

	contentsBytes := []byte(params.Contents)
	if utilfn.HasBinaryData(contentsBytes) {
		return nil, fmt.Errorf("contents appear to contain binary data")
	}

	fileInfo, err := validateTextFile(expandedPath, "write to", false)
	if err != nil {
		return nil, err
	}

	dirPath := filepath.Dir(expandedPath)
	err = os.MkdirAll(dirPath, 0755)
	if err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	if fileInfo != nil {
		err = filebackup.MakeFileBackup(expandedPath)
		if err != nil {
			return nil, fmt.Errorf("failed to create backup: %w", err)
		}
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

	_, err = validateTextFile(expandedPath, "edit", true)
	if err != nil {
		return nil, err
	}

	err = filebackup.MakeFileBackup(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create backup: %w", err)
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

type deleteTextFileParams struct {
	Filename string `json:"filename"`
}

func parseDeleteTextFileInput(input any) (*deleteTextFileParams, error) {
	result := &deleteTextFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	return result, nil
}

func deleteTextFileCallback(input any) (any, error) {
	params, err := parseDeleteTextFileInput(input)
	if err != nil {
		return nil, err
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	_, err = validateTextFile(expandedPath, "delete", true)
	if err != nil {
		return nil, err
	}

	err = filebackup.MakeFileBackup(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create backup: %w", err)
	}

	err = os.Remove(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to delete file: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully deleted %s", params.Filename),
	}, nil
}

func GetDeleteTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "delete_text_file",
		DisplayName: "Delete Text File",
		Description: "Delete a text file from the filesystem. A backup is created before deletion. Maximum file size: 100KB.",
		ToolLogName: "gen:deletefile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Path to the file to delete. Supports '~' for the user's home directory.",
				},
			},
			"required":             []string{"filename"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			params, err := parseDeleteTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("deleting %q", params.Filename)
		},
		ToolAnyCallback: deleteTextFileCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
