// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiplan"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func GetPlanCreateToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "plan_create",
		DisplayName:      "Create Plan",
		Description:      "Create a multi-step plan for repeating operations across items. Each step runs independently. Start executing step 1 immediately after creation.",
		ShortDescription: "Create multi-step plan",
		ToolLogName:      "plan:create",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "Short name for the plan (e.g., 'SEO Audit mits.pl')",
				},
				"description": map[string]any{
					"type":        "string",
					"description": "What to do for each step (e.g., 'Run SEO audit and report issues')",
				},
				"steps": map[string]any{
					"type":        "array",
					"description": "List of step labels (e.g., URLs to audit, files to process)",
					"items": map[string]any{
						"type": "string",
					},
				},
			},
			"required": []string{"name", "steps"},
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			inputMap, _ := input.(map[string]any)
			name, _ := inputMap["name"].(string)
			steps, _ := inputMap["steps"].([]any)
			return fmt.Sprintf("creating plan %q with %d steps", name, len(steps))
		},
		ToolTextCallback: func(input any) (string, error) {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return "", fmt.Errorf("invalid input format")
			}

			name, _ := inputMap["name"].(string)
			if name == "" {
				return "", fmt.Errorf("name is required")
			}

			description, _ := inputMap["description"].(string)

			stepsRaw, _ := inputMap["steps"].([]any)
			if len(stepsRaw) == 0 {
				return "", fmt.Errorf("at least one step is required")
			}

			stepLabels := make([]string, len(stepsRaw))
			for i, s := range stepsRaw {
				stepLabels[i] = fmt.Sprintf("%v", s)
			}

			plan, err := aiplan.CreatePlan(tabId, name, description, stepLabels)
			if err != nil {
				return "", err
			}

			return aiplan.FormatPlanStatus(plan), nil
		},
	}
}

func GetPlanStatusToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "plan_status",
		DisplayName:      "Plan Status",
		Description:      "Get active plan status: done/pending steps and what to do next.",
		ShortDescription: "Check plan status",
		ToolLogName:      "plan:status",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			return "checking plan status"
		},
		ToolTextCallback: func(input any) (string, error) {
			plan := aiplan.GetPlan(tabId)
			if plan == nil {
				return "No active plan for this tab.", nil
			}
			return aiplan.FormatPlanStatus(plan), nil
		},
	}
}

func GetPlanUpdateToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "plan_update",
		DisplayName:      "Update Plan Step",
		Description:      "Mark a plan step as done/failed/skipped with result summary. Continue with next pending step.",
		ShortDescription: "Update plan step",
		ToolLogName:      "plan:update",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"step_id": map[string]any{
					"type":        "integer",
					"description": "Step number to update",
				},
				"status": map[string]any{
					"type":        "string",
					"enum":        []string{"done", "failed", "skipped"},
					"description": "New status for the step",
				},
				"result": map[string]any{
					"type":        "string",
					"description": "Brief summary of what was found/done in this step",
				},
			},
			"required": []string{"step_id", "status"},
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			inputMap, _ := input.(map[string]any)
			stepId, _ := inputMap["step_id"].(float64)
			status, _ := inputMap["status"].(string)
			return fmt.Sprintf("marking step #%d as %s", int(stepId), status)
		},
		ToolTextCallback: func(input any) (string, error) {
			inputBytes, err := json.Marshal(input)
			if err != nil {
				return "", fmt.Errorf("invalid input: %w", err)
			}

			var params struct {
				StepId int    `json:"step_id"`
				Status string `json:"status"`
				Result string `json:"result"`
			}
			if err := json.Unmarshal(inputBytes, &params); err != nil {
				return "", fmt.Errorf("parsing input: %w", err)
			}

			if params.StepId == 0 {
				return "", fmt.Errorf("step_id is required")
			}
			if params.Status == "" {
				params.Status = aiplan.StatusDone
			}

			plan, err := aiplan.UpdateStep(tabId, params.StepId, params.Status, params.Result, "")
			if err != nil {
				return "", err
			}

			return aiplan.FormatPlanStatus(plan), nil
		},
	}
}
