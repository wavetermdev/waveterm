// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/buildercontroller"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const BuilderAppFileName = "app.go"

type builderWriteAppFileParams struct {
	Contents string `json:"contents"`
}

func triggerBuildAndWait(builderId string, appId string) map[string]any {
	bc := buildercontroller.GetOrCreateController(builderId)
	rtInfo := wstore.GetRTInfo(waveobj.MakeORef(waveobj.OType_Builder, builderId))

	var builderEnv map[string]string
	if rtInfo != nil {
		builderEnv = rtInfo.BuilderEnv
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	result, err := bc.RestartAndWaitForBuild(ctx, appId, builderEnv)
	if err != nil {
		log.Printf("Build failed for %s: %v", builderId, err)
		return map[string]any{
			"build_success": false,
			"build_error":   err.Error(),
			"build_output":  "",
		}
	}

	return map[string]any{
		"build_success": result.Success,
		"build_error":   result.ErrorMessage,
		"build_output":  result.BuildOutput,
	}
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

func GetBuilderWriteAppFileToolDefinition(appId string, builderId string) uctypes.ToolDefinition {
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
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseBuilderWriteAppFileInput(input)
			if err != nil {
				if output != nil {
					return "wrote app.go"
				}
				return "writing app.go"
			}
			lineCount := len(strings.Split(params.Contents, "\n"))
			if output != nil {
				return fmt.Sprintf("wrote app.go (+%d lines)", lineCount)
			}
			return fmt.Sprintf("writing app.go (+%d lines)", lineCount)
		},
		ToolProgressDesc: func(input any) ([]string, error) {
			params, err := parseBuilderWriteAppFileInput(input)
			if err != nil {
				return nil, err
			}
			lineCount := len(strings.Split(params.Contents, "\n"))
			return []string{fmt.Sprintf("writing app.go (+%d lines)", lineCount)}, nil
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
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

			result := map[string]any{
				"success": true,
				"message": fmt.Sprintf("Successfully wrote %s", BuilderAppFileName),
			}

			if builderId != "" {
				buildResult := triggerBuildAndWait(builderId, appId)
				result["build_success"] = buildResult["build_success"]
				result["build_error"] = buildResult["build_error"]
				result["build_output"] = buildResult["build_output"]
			}

			return result, nil
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

func formatEditDescriptions(edits []fileutil.EditSpec) []string {
	numEdits := len(edits)
	editStr := "edits"
	if numEdits == 1 {
		editStr = "edit"
	}

	result := make([]string, len(edits)+1)
	result[0] = fmt.Sprintf("editing app.go (%d %s)", numEdits, editStr)

	for i, edit := range edits {
		newLines := len(strings.Split(edit.NewStr, "\n"))
		oldLines := len(strings.Split(edit.OldStr, "\n"))
		desc := edit.Desc
		if desc == "" {
			desc = fmt.Sprintf("edit #%d", i+1)
		}
		result[i+1] = fmt.Sprintf("* %s (+%d -%d)", desc, newLines, oldLines)
	}
	return result
}

func GetBuilderEditAppFileToolDefinition(appId string, builderId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "builder_edit_app_file",
		DisplayName: "Edit App File",
		Description: "Edit the app.go file for this app using precise search and replace. " +
			"Each old_str must appear EXACTLY ONCE in the file or the edit will fail. " +
			"Edits are applied sequentially - if an edit fails, all previous edits are kept and subsequent edits are skipped.",
		ToolLogName: "builder:edit_app",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"edits": map[string]any{
					"type":        "array",
					"description": "Array of edit specifications. Edits are applied sequentially - if one fails, previous edits are kept but remaining edits are skipped.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"old_str": map[string]any{
								"type":        "string",
								"description": "The exact string to find and replace. MUST appear exactly once in the file - if it appears zero times or multiple times, this edit will fail.",
							},
							"new_str": map[string]any{
								"type":        "string",
								"description": "The string to replace with",
							},
							"desc": map[string]any{
								"type":        "string",
								"description": "Description of what this edit does (keep short, half a line of text max)",
							},
						},
						"required": []string{"old_str", "new_str"},
					},
				},
			},
			"required":             []string{"edits"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseBuilderEditAppFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return strings.Join(formatEditDescriptions(params.Edits), "\n")
		},
		ToolProgressDesc: func(input any) ([]string, error) {
			params, err := parseBuilderEditAppFileInput(input)
			if err != nil {
				return nil, err
			}
			return formatEditDescriptions(params.Edits), nil
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			params, err := parseBuilderEditAppFileInput(input)
			if err != nil {
				return nil, err
			}

			editResults, err := waveappstore.ReplaceInAppFilePartial(appId, BuilderAppFileName, params.Edits)
			if err != nil {
				return nil, err
			}

			wps.Broker.Publish(wps.WaveEvent{
				Event:  wps.Event_WaveAppAppGoUpdated,
				Scopes: []string{appId},
			})

			result := map[string]any{
				"edits": editResults,
			}

			if builderId != "" {
				buildResult := triggerBuildAndWait(builderId, appId)
				result["build_success"] = buildResult["build_success"]
				result["build_error"] = buildResult["build_error"]
				result["build_output"] = buildResult["build_output"]
			}

			return result, nil
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
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			return "listing files"
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			result, err := waveappstore.ListAllAppFiles(appId)
			if err != nil {
				return nil, err
			}

			return result, nil
		},
	}
}
