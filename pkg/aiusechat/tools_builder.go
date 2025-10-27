// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

const BuilderAppFileName = "app.go"

type builderWriteAppFileParams struct {
	Contents string `json:"contents"`
}

func parseBuilderWriteAppFileInput(input any) (*builderWriteAppFileParams, error) {
	result := &builderWriteAppFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Contents == "" {
		return nil, fmt.Errorf("missing contents parameter")
	}

	return result, nil
}

func GetBuilderWriteAppFileToolDefinition(appId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "builder_write_app_file",
		DisplayName: "Write App File",
		Description: fmt.Sprintf("Write the app.go file for app %s", appId),
		ToolLogName: "builder:write_app",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"contents": map[string]any{
					"type":        "string",
					"description": "The contents to write to app.go",
				},
			},
			"required":             []string{"contents"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			return fmt.Sprintf("writing app.go for %s", appId)
		},
		ToolAnyCallback: func(input any) (any, error) {
			params, err := parseBuilderWriteAppFileInput(input)
			if err != nil {
				return nil, err
			}

			err = waveappstore.WriteAppFile(appId, BuilderAppFileName, []byte(params.Contents))
			if err != nil {
				return nil, err
			}

			wps.Broker.Publish(wps.WaveEvent{
				Event:  wps.Event_WaveAppAppGoUpdated,
				Scopes: []string{appId},
			})

			return map[string]any{
				"success": true,
				"message": fmt.Sprintf("Successfully wrote %s", BuilderAppFileName),
			}, nil
		},
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}

type builderEditAppFileParams struct {
	Edits []fileutil.EditSpec `json:"edits"`
}

func parseBuilderEditAppFileInput(input any) (*builderEditAppFileParams, error) {
	result := &builderEditAppFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if len(result.Edits) == 0 {
		return nil, fmt.Errorf("missing edits parameter")
	}

	return result, nil
}

func GetBuilderEditAppFileToolDefinition(appId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "builder_edit_app_file",
		DisplayName: "Edit App File",
		Description: "Edit the app.go file for this app using precise search and replace. " +
			"Each old_str must appear EXACTLY ONCE in the file or the edit will fail. " +
			"All edits are applied atomically - if any single edit fails, the entire operation fails and no changes are made.",
		ToolLogName: "builder:edit_app",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
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
			"required":             []string{"edits"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			params, err := parseBuilderEditAppFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("editing app.go for %s (%d edits)", appId, len(params.Edits))
		},
		ToolAnyCallback: func(input any) (any, error) {
			params, err := parseBuilderEditAppFileInput(input)
			if err != nil {
				return nil, err
			}

			err = waveappstore.ReplaceInAppFile(appId, BuilderAppFileName, params.Edits)
			if err != nil {
				return nil, err
			}

			wps.Broker.Publish(wps.WaveEvent{
				Event:  wps.Event_WaveAppAppGoUpdated,
				Scopes: []string{appId},
			})

			return map[string]any{
				"success": true,
				"message": fmt.Sprintf("Successfully edited %s with %d changes", BuilderAppFileName, len(params.Edits)),
			}, nil
		},
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}

func GetBuilderListFilesToolDefinition(appId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "builder_list_files",
		DisplayName: "List App Files",
		Description: fmt.Sprintf("List all files in app %s", appId),
		ToolLogName: "builder:list_files",
		Strict:      false,
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			return fmt.Sprintf("listing files for %s", appId)
		},
		ToolAnyCallback: func(input any) (any, error) {
			result, err := waveappstore.ListAllAppFiles(appId)
			if err != nil {
				return nil, err
			}

			return result, nil
		},
		ToolApproval: func(input any) string {
			return uctypes.ApprovalAutoApproved
		},
	}
}
