// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"strings"

	"github.com/sourcegraph/go-diff/diff"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

type patchOperation struct {
	Type string `json:"type"` // "create_file", "update_file", "delete_file"
	Path string `json:"path"`
	Diff string `json:"diff,omitempty"`
}

type patchCallParams struct {
	Operation patchOperation `json:"operation"`
}

type patchCallResult struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

func parseApplyPatchInput(input any) (*patchCallParams, error) {
	result := &patchCallParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	op := result.Operation
	if op.Type == "" {
		return nil, fmt.Errorf("operation type is required")
	}

	if op.Type != "create_file" && op.Type != "update_file" && op.Type != "delete_file" {
		return nil, fmt.Errorf("invalid operation type: %s (must be create_file, update_file, or delete_file)", op.Type)
	}

	if op.Path == "" {
		return nil, fmt.Errorf("operation path is required")
	}

	if (op.Type == "create_file" || op.Type == "update_file") && op.Diff == "" {
		return nil, fmt.Errorf("diff is required for %s operation", op.Type)
	}

	return result, nil
}

// applyUnifiedDiff applies a unified diff to content using go-diff library
func applyUnifiedDiff(currentContent string, diffStr string, operationType string) (string, error) {
	if operationType == "create_file" {
		// For create_file with no current content, parse the diff and extract additions
		fileDiffs, err := diff.ParseMultiFileDiff([]byte(diffStr))
		if err != nil {
			return "", fmt.Errorf("failed to parse diff: %w", err)
		}

		if len(fileDiffs) == 0 {
			return "", fmt.Errorf("no diffs found in patch")
		}

		fileDiff := fileDiffs[0]
		var result []string
		
		for _, hunk := range fileDiff.Hunks {
			for _, line := range strings.Split(string(hunk.Body), "\n") {
				if strings.HasPrefix(line, "+") {
					result = append(result, strings.TrimPrefix(line, "+"))
				} else if strings.HasPrefix(line, " ") {
					result = append(result, strings.TrimPrefix(line, " "))
				}
			}
		}
		
		return strings.Join(result, "\n"), nil
	}

	// For update_file, parse and apply the unified diff
	fileDiffs, err := diff.ParseMultiFileDiff([]byte(diffStr))
	if err != nil {
		return "", fmt.Errorf("failed to parse diff: %w", err)
	}

	if len(fileDiffs) == 0 {
		return "", fmt.Errorf("no diffs found in patch")
	}

	fileDiff := fileDiffs[0]
	currentLines := strings.Split(currentContent, "\n")
	var result []string
	currentIdx := 0

	for _, hunk := range fileDiff.Hunks {
		// Skip to the start line of this hunk
		hunkStartLine := int(hunk.OrigStartLine) - 1
		for currentIdx < hunkStartLine && currentIdx < len(currentLines) {
			result = append(result, currentLines[currentIdx])
			currentIdx++
		}

		// Apply hunk changes
		hunkLines := strings.Split(string(hunk.Body), "\n")
		for _, line := range hunkLines {
			if line == "" {
				continue
			}
			if strings.HasPrefix(line, "-") {
				// Skip this line from original
				if currentIdx < len(currentLines) {
					currentIdx++
				}
			} else if strings.HasPrefix(line, "+") {
				// Add this line
				result = append(result, strings.TrimPrefix(line, "+"))
			} else if strings.HasPrefix(line, " ") {
				// Context line (unchanged)
				if currentIdx < len(currentLines) {
					result = append(result, currentLines[currentIdx])
					currentIdx++
				}
			}
		}
	}

	// Append remaining lines
	for currentIdx < len(currentLines) {
		result = append(result, currentLines[currentIdx])
		currentIdx++
	}

	return strings.Join(result, "\n"), nil
}

func executePatchOperation(appId string, op patchOperation) patchCallResult {
	switch op.Type {
	case "create_file":
		content, err := applyUnifiedDiff("", op.Diff, "create_file")
		if err != nil {
			return patchCallResult{
				Success: false,
				Error:   fmt.Sprintf("failed to parse diff for create_file: %v", err),
			}
		}

		err = waveappstore.WriteAppFile(appId, op.Path, []byte(content))
		if err != nil {
			return patchCallResult{
				Success: false,
				Error:   fmt.Sprintf("failed to create file %s: %v", op.Path, err),
			}
		}

		return patchCallResult{
			Success: true,
			Message: fmt.Sprintf("created file %s", op.Path),
		}

	case "update_file":
		fileData, err := waveappstore.ReadAppFile(appId, op.Path)
		if err != nil {
			return patchCallResult{
				Success: false,
				Error:   fmt.Sprintf("failed to read file %s: %v", op.Path, err),
			}
		}

		newContent, err := applyUnifiedDiff(string(fileData.Contents), op.Diff, "update_file")
		if err != nil {
			return patchCallResult{
				Success: false,
				Error:   fmt.Sprintf("failed to apply diff to %s: %v", op.Path, err),
			}
		}

		err = waveappstore.WriteAppFile(appId, op.Path, []byte(newContent))
		if err != nil {
			return patchCallResult{
				Success: false,
				Error:   fmt.Sprintf("failed to write updated file %s: %v", op.Path, err),
			}
		}

		return patchCallResult{
			Success: true,
			Message: fmt.Sprintf("updated file %s", op.Path),
		}

	case "delete_file":
		err := waveappstore.DeleteAppFile(appId, op.Path)
		if err != nil {
			return patchCallResult{
				Success: false,
				Error:   fmt.Sprintf("failed to delete file %s: %v", op.Path, err),
			}
		}

		return patchCallResult{
			Success: true,
			Message: fmt.Sprintf("deleted file %s", op.Path),
		}

	default:
		return patchCallResult{
			Success: false,
			Error:   fmt.Sprintf("unknown operation type: %s", op.Type),
		}
	}
}

func GetApplyPatchCallToolDefinition(appId string, builderId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "apply_patch_call",
		DisplayName: "Apply Patch",
		Description: "Apply structured diffs to create, update, or delete files in the app",
		ToolLogName: "apply_patch",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"operation": map[string]any{
					"type":        "object",
					"description": "The patch operation to perform",
					"properties": map[string]any{
						"type": map[string]any{
							"type":        "string",
							"description": "Type of operation: create_file, update_file, or delete_file",
							"enum":        []string{"create_file", "update_file", "delete_file"},
						},
						"path": map[string]any{
							"type":        "string",
							"description": "Path to the file relative to the app directory",
						},
						"diff": map[string]any{
							"type":        "string",
							"description": "V4A unified diff format. Required for create_file and update_file operations",
						},
					},
					"required": []string{"type", "path"},
				},
			},
			"required":             []string{"operation"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseApplyPatchInput(input)
			if err != nil {
				if output != nil {
					return fmt.Sprintf("patch failed: %v", err)
				}
				return "applying patch"
			}

			op := params.Operation
			if output != nil {
				result, ok := output.(map[string]any)
				if ok && result["success"] == true {
					switch op.Type {
					case "create_file":
						return fmt.Sprintf("created %s", op.Path)
					case "update_file":
						return fmt.Sprintf("updated %s", op.Path)
					case "delete_file":
						return fmt.Sprintf("deleted %s", op.Path)
					}
				}
				if ok && result["error"] != nil {
					return fmt.Sprintf("patch failed: %v", result["error"])
				}
			}

			switch op.Type {
			case "create_file":
				return fmt.Sprintf("creating %s", op.Path)
			case "update_file":
				return fmt.Sprintf("updating %s", op.Path)
			case "delete_file":
				return fmt.Sprintf("deleting %s", op.Path)
			default:
				return "applying patch"
			}
		},
		ToolProgressDesc: func(input any) ([]string, error) {
			params, err := parseApplyPatchInput(input)
			if err != nil {
				return nil, err
			}

			op := params.Operation
			switch op.Type {
			case "create_file":
				return []string{fmt.Sprintf("creating %s", op.Path)}, nil
			case "update_file":
				return []string{fmt.Sprintf("updating %s", op.Path)}, nil
			case "delete_file":
				return []string{fmt.Sprintf("deleting %s", op.Path)}, nil
			default:
				return []string{"applying patch"}, nil
			}
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			params, err := parseApplyPatchInput(input)
			if err != nil {
				return nil, err
			}

			result := executePatchOperation(appId, params.Operation)

			if result.Success && params.Operation.Path == BuilderAppFileName {
				wps.Broker.Publish(wps.WaveEvent{
					Event:  wps.Event_WaveAppAppGoUpdated,
					Scopes: []string{appId},
				})
			}

			if !result.Success {
				return result, fmt.Errorf("%s", result.Error)
			}

			response := map[string]any{
				"success": result.Success,
				"message": result.Message,
			}

			if builderId != "" && params.Operation.Path == BuilderAppFileName {
				buildResult := triggerBuildAndWait(builderId, appId)
				response["build_success"] = buildResult["build_success"]
				response["build_error"] = buildResult["build_error"]
				response["build_output"] = buildResult["build_output"]
			}

			return response, nil
		},
	}
}