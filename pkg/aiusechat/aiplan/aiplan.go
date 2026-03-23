// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiplan

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/woveterm/wove/pkg/wavebase"
)

const (
	planDirName    = "plans"
	maxResultLen   = 2000
	StatusPending  = "pending"
	StatusRunning  = "running"
	StatusDone     = "done"
	StatusFailed   = "failed"
	StatusSkipped  = "skipped"
)

// PlanStep represents a single step in the plan.
type PlanStep struct {
	Id       int    `json:"id"`
	Label    string `json:"label"`
	Status   string `json:"status"`
	Details  string `json:"details,omitempty"`
	Result   string `json:"result,omitempty"`
	Error    string `json:"error,omitempty"`
	DoneAt   string `json:"doneAt,omitempty"`
}

// Plan represents a multi-step execution plan for AI.
type Plan struct {
	TabId       string     `json:"tabId"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	CreatedAt   string     `json:"createdAt"`
	UpdatedAt   string     `json:"updatedAt"`
	Steps       []PlanStep `json:"steps"`
}

var (
	plansMu sync.Mutex
)

func getPlanDir() string {
	return filepath.Join(wavebase.GetWaveDataDir(), planDirName)
}

func getPlanFilePath(tabId string) string {
	return filepath.Join(getPlanDir(), tabId+".json")
}

// CreatePlan creates a new plan (without details per step).
func CreatePlan(tabId string, name string, description string, stepLabels []string) (*Plan, error) {
	details := make([]string, len(stepLabels))
	return CreatePlanWithDetails(tabId, name, description, stepLabels, details)
}

// CreatePlanWithDetails creates a new plan with optional details per step.
func CreatePlanWithDetails(tabId string, name string, description string, stepLabels []string, stepDetails []string) (*Plan, error) {
	plansMu.Lock()
	defer plansMu.Unlock()

	if err := os.MkdirAll(getPlanDir(), 0755); err != nil {
		return nil, fmt.Errorf("creating plans dir: %w", err)
	}

	// Auto-append testing and lint steps if not already present
	hasTestStep := false
	hasLintStep := false
	for _, label := range stepLabels {
		lower := strings.ToLower(label)
		if strings.Contains(lower, "test") && (strings.Contains(lower, "write") || strings.Contains(lower, "create")) {
			hasTestStep = true
		}
		if strings.Contains(lower, "lint") || strings.Contains(lower, "pint") || strings.Contains(lower, "format") {
			hasLintStep = true
		}
	}
	if !hasLintStep {
		stepLabels = append(stepLabels, "Run syntax check (php -l) and lint/format (pint) on all modified files")
	}
	// Review step: verify code against project conventions
	stepLabels = append(stepLabels, "Call wave_utils(action='project_instructions') then review all created files against those rules - fix any violations")
	if !hasTestStep {
		stepLabels = append(stepLabels, "Write NEW test file with happy path, edge cases, and business logic tests")
	}
	// Always end with running tests
	stepLabels = append(stepLabels, "Run all tests and verify they pass")

	steps := make([]PlanStep, len(stepLabels))
	for i, label := range stepLabels {
		steps[i] = PlanStep{
			Id:     i + 1,
			Label:  label,
			Status: StatusPending,
		}
		if i < len(stepDetails) && stepDetails[i] != "" {
			steps[i].Details = stepDetails[i]
		}
	}

	now := time.Now().Format(time.RFC3339)
	plan := &Plan{
		TabId:       tabId,
		Name:        name,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
		Steps:       steps,
	}

	if err := savePlanLocked(plan); err != nil {
		return nil, err
	}
	return plan, nil
}

// GetPlan loads the current plan for a tab.
func GetPlan(tabId string) *Plan {
	plansMu.Lock()
	defer plansMu.Unlock()
	return loadPlanLocked(tabId)
}

// UpdateStep marks a step with a new status and optional result.
func UpdateStep(tabId string, stepId int, status string, result string, errMsg string) (*Plan, error) {
	plansMu.Lock()
	defer plansMu.Unlock()

	plan := loadPlanLocked(tabId)
	if plan == nil {
		return nil, fmt.Errorf("no plan found for tab %s", tabId)
	}

	found := false
	for i := range plan.Steps {
		if plan.Steps[i].Id == stepId {
			plan.Steps[i].Status = status
			if result != "" {
				if len(result) > maxResultLen {
					result = result[:maxResultLen] + "..."
				}
				plan.Steps[i].Result = result
			}
			if errMsg != "" {
				plan.Steps[i].Error = errMsg
			}
			if status == StatusDone || status == StatusFailed || status == StatusSkipped {
				plan.Steps[i].DoneAt = time.Now().Format(time.RFC3339)
			}
			found = true
			break
		}
	}

	if !found {
		return nil, fmt.Errorf("step %d not found in plan", stepId)
	}

	plan.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := savePlanLocked(plan); err != nil {
		return nil, err
	}
	return plan, nil
}

// DeletePlan removes the plan for a tab.
func DeletePlan(tabId string) {
	plansMu.Lock()
	defer plansMu.Unlock()
	os.Remove(getPlanFilePath(tabId))
}

// GetNextPendingStep returns the next step that needs to be executed.
func GetNextPendingStep(plan *Plan) *PlanStep {
	if plan == nil {
		return nil
	}
	for i := range plan.Steps {
		if plan.Steps[i].Status == StatusPending {
			return &plan.Steps[i]
		}
	}
	return nil
}

// IsComplete returns true if all steps are done/failed/skipped.
func IsComplete(plan *Plan) bool {
	if plan == nil {
		return true
	}
	for _, step := range plan.Steps {
		if step.Status == StatusPending || step.Status == StatusRunning {
			return false
		}
	}
	return true
}

// FormatPlanStatus returns a human-readable summary of the plan for AI context.
func FormatPlanStatus(plan *Plan) string {
	if plan == nil {
		return ""
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<active_plan name=%q>\n", plan.Name))
	if plan.Description != "" {
		sb.WriteString(fmt.Sprintf("Description: %s\n", plan.Description))
	}

	doneCount := 0
	totalCount := len(plan.Steps)
	for _, step := range plan.Steps {
		if step.Status == StatusDone || step.Status == StatusFailed || step.Status == StatusSkipped {
			doneCount++
		}
	}
	sb.WriteString(fmt.Sprintf("Progress: %d/%d steps completed\n\n", doneCount, totalCount))

	for _, step := range plan.Steps {
		icon := "[ ]"
		switch step.Status {
		case StatusDone:
			icon = "[x]"
		case StatusFailed:
			icon = "[!]"
		case StatusRunning:
			icon = "[>]"
		case StatusSkipped:
			icon = "[-]"
		}

		sb.WriteString(fmt.Sprintf("%s %d. %s", icon, step.Id, step.Label))
		if step.Details != "" {
			sb.WriteString(fmt.Sprintf("\n     %s", step.Details))
		}
		if step.Result != "" {
			// Show abbreviated result
			result := step.Result
			if len(result) > 200 {
				result = result[:200] + "..."
			}
			sb.WriteString(fmt.Sprintf(" - %s", result))
		}
		if step.Error != "" {
			sb.WriteString(fmt.Sprintf(" [ERROR: %s]", step.Error))
		}
		sb.WriteString("\n")
	}

	next := GetNextPendingStep(plan)
	if next != nil {
		sb.WriteString(fmt.Sprintf("\nNext step: #%d %s\n", next.Id, next.Label))
		if next.Details != "" {
			sb.WriteString(fmt.Sprintf("Details: %s\n", next.Details))
		}
		sb.WriteString("IMPORTANT: This plan was started in a previous session. Continue executing from this step now. Do not restart the plan or re-create completed steps. Call wave_utils(action='plan_update') when done.\n")
	} else {
		sb.WriteString("\nAll steps completed. Summarize the results for the user.\n")
	}

	sb.WriteString("</active_plan>")
	return sb.String()
}

func loadPlanLocked(tabId string) *Plan {
	data, err := os.ReadFile(getPlanFilePath(tabId))
	if err != nil {
		return nil
	}
	var plan Plan
	if err := json.Unmarshal(data, &plan); err != nil {
		return nil
	}
	return &plan
}

func savePlanLocked(plan *Plan) error {
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling plan: %w", err)
	}
	return os.WriteFile(getPlanFilePath(plan.TabId), data, 0644)
}
