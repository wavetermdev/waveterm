// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiplan"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/projectctx"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/sessionhistory"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// GetWaveUtilsToolDefinition returns a consolidated tool for less frequently used operations.
// This saves ~800 tokens compared to having 5 separate tool definitions.
func GetWaveUtilsToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "wave_utils",
		DisplayName:      "Wave Utilities",
		Description: "Utility tool. Actions: " +
			"session_history - previous session; " +
			"project_instructions - read CLAUDE.md/WAVE.md (params: sections, file_ext); " +
			"plan_create - multi-step plan (params: name, steps[{label,details}] - include concrete requirements, file paths, conventions in details); " +
			"plan_update - mark step done/failed (params: step_id, status, result); " +
			"plan_status - check progress",
		ShortDescription: "Session history, project instructions, plans",
		ToolLogName:      "wave:utils",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"action": map[string]any{
					"type":        "string",
					"enum":        []string{"session_history", "project_instructions", "plan_create", "plan_update", "plan_status"},
					"description": "Which action to run",
				},
				"sections": map[string]any{
					"type":        "array",
					"description": "For project_instructions: section headings to retrieve",
					"items":       map[string]any{"type": "string"},
				},
				"file_ext": map[string]any{
					"type":        "string",
					"description": "For project_instructions: filter by file extension",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "For plan_create: plan name",
				},
				"description": map[string]any{
					"type":        "string",
					"description": "For plan_create: what to do per step",
				},
				"steps": map[string]any{
					"type":        "array",
					"description": "For plan_create: step labels",
					"items":       map[string]any{"type": "string"},
				},
				"step_id": map[string]any{
					"type":        "integer",
					"description": "For plan_update: step number",
				},
				"status": map[string]any{
					"type":        "string",
					"description": "For plan_update: done/failed/skipped",
				},
				"result": map[string]any{
					"type":        "string",
					"description": "For plan_update: result summary",
				},
			},
			"required": []string{"action"},
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			inputMap, _ := input.(map[string]any)
			action, _ := inputMap["action"].(string)
			return fmt.Sprintf("wave_utils: %s", action)
		},
		ToolTextCallback: func(input any) (string, error) {
			var params map[string]any
			data, _ := json.Marshal(input)
			json.Unmarshal(data, &params)

			action, _ := params["action"].(string)

			switch action {
			case "session_history":
				history := sessionhistory.LoadSessionHistory(tabId)
				if history == "" {
					return "No previous session history found.", nil
				}
				return history, nil

			case "project_instructions":
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				cwd := getTerminalCwd(ctx, tabId)
				if cwd == "" {
					return "No terminal found.", nil
				}
				files := projectctx.FindAllInstructionsFiles(cwd)
				if len(files) == 0 {
					return "No project instructions file found.", nil
				}
				var allInstructions []*projectctx.ProjectInstructions
				for _, f := range files {
					pi, err := projectctx.ParseInstructions(f)
					if err == nil {
						allInstructions = append(allInstructions, pi)
					}
				}
				sectionsRaw, _ := params["sections"].([]any)
				fileExt, _ := params["file_ext"].(string)
				if len(sectionsRaw) == 0 {
					return formatTableOfContents(allInstructions, fileExt), nil
				}
				requested := make([]string, len(sectionsRaw))
				for i, s := range sectionsRaw {
					requested[i] = fmt.Sprintf("%v", s)
				}
				result := formatRequestedSections(allInstructions, requested, fileExt)
				// Fallback: if no sections matched, return table of contents so AI can retry
				if strings.HasPrefix(result, "No sections found") {
					return result + "\n\n" + formatTableOfContents(allInstructions, fileExt), nil
				}
				return result, nil

			case "plan_create":
				name, _ := params["name"].(string)
				desc, _ := params["description"].(string)
				stepsRaw, _ := params["steps"].([]any)
				if name == "" || len(stepsRaw) == 0 {
					return "", fmt.Errorf("plan_create requires name and steps")
				}
				var labels []string
				var details []string
				for _, s := range stepsRaw {
					switch v := s.(type) {
					case string:
						labels = append(labels, v)
						details = append(details, "")
					case map[string]any:
						l, _ := v["label"].(string)
						d, _ := v["details"].(string)
						if l == "" {
							l = fmt.Sprintf("%v", s)
						}
						labels = append(labels, l)
						details = append(details, d)
					default:
						labels = append(labels, fmt.Sprintf("%v", s))
						details = append(details, "")
					}
				}
				plan, err := aiplan.CreatePlanWithDetails(tabId, name, desc, labels, details)
				if err != nil {
					return "", err
				}
				return aiplan.FormatPlanStatus(plan), nil

			case "plan_update":
				stepIdRaw, ok := params["step_id"].(float64)
				if !ok || stepIdRaw == 0 {
					return "", fmt.Errorf("step_id required (must be a number)")
				}
				stepId := int(stepIdRaw)
				status, _ := params["status"].(string)
				result, _ := params["result"].(string)
				if status == "" {
					status = aiplan.StatusDone
				}
				plan, err := aiplan.UpdateStep(tabId, stepId, status, result, "")
				if err != nil {
					return "", err
				}
				return aiplan.FormatPlanStatus(plan), nil

			case "plan_status":
				plan := aiplan.GetPlan(tabId)
				if plan == nil {
					return "No active plan.", nil
				}
				return aiplan.FormatPlanStatus(plan), nil

			default:
				return "", fmt.Errorf("unknown action: %s", action)
			}
		},
	}
}
