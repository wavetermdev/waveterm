// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/woveterm/wove/pkg/aiusechat/uctypes"
	"github.com/woveterm/wove/pkg/blockcontroller"
	"github.com/woveterm/wove/pkg/util/utilfn"
	"github.com/woveterm/wove/pkg/waveobj"
	"github.com/woveterm/wove/pkg/wcore"
	"github.com/woveterm/wove/pkg/wshrpc"
	"github.com/woveterm/wove/pkg/wshrpc/wshclient"
	"github.com/woveterm/wove/pkg/wshutil"
	"github.com/woveterm/wove/pkg/wstore"
)

const (
	TermRunCommandTimeout    = 60 * time.Second
	TermRunCommandPollPeriod = 250 * time.Millisecond
	TermRunMaxOutputLines    = 1000
)

type TermRunCommandInput struct {
	WidgetId string `json:"widget_id"`
	Command  string `json:"command"`
}

type TermRunCommandOutput struct {
	Command  string `json:"command"`
	ExitCode *int   `json:"exitcode,omitempty"`
	Output   string `json:"output"`
	TimedOut bool   `json:"timedout,omitempty"`
}

func parseTermRunCommandInput(input any) (*TermRunCommandInput, error) {
	result := &TermRunCommandInput{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}

	if result.Command == "" {
		return nil, fmt.Errorf("command is required")
	}

	return result, nil
}

func sendCommandToTerminal(blockId string, command string) error {
	// Send the command text followed by a newline (Enter key)
	inputData := []byte(command + "\n")
	inputUnion := &blockcontroller.BlockInputUnion{
		InputData: inputData,
	}
	return blockcontroller.SendInput(blockId, inputUnion)
}

func waitForCommandCompletion(ctx context.Context, blockORef waveobj.ORef) (bool, error) {
	ticker := time.NewTicker(TermRunCommandPollPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-ticker.C:
			rtInfo := wstore.GetRTInfo(blockORef)
			if rtInfo == nil {
				return false, fmt.Errorf("terminal runtime info not available")
			}
			if !rtInfo.ShellIntegration {
				return false, fmt.Errorf("shell integration is not enabled for this terminal")
			}
			if rtInfo.ShellState == "ready" {
				return true, nil
			}
			// still running, continue polling
		}
	}
}

func GetTermRunCommandToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_run_command",
		DisplayName: "Run Terminal Command",
		Description: "Run a command in terminal and return output. For CLI tools (git, npm, artisan, etc.). Requires shell integration.",
		ToolLogName: "term:runcommand",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
				"command": map[string]any{
					"type":        "string",
					"description": "The command to execute in the terminal (e.g., 'php artisan migrate:status', 'composer validate', 'ls -la')",
				},
			},
			"required":             []string{"widget_id", "command"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermRunCommandInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			cmdStr := parsed.Command
			if len(cmdStr) > 60 {
				cmdStr = cmdStr[:57] + "..."
			}
			if output != nil {
				return fmt.Sprintf("ran `%s` in %s", cmdStr, parsed.WidgetId)
			}
			return fmt.Sprintf("running `%s` in %s", cmdStr, parsed.WidgetId)
		},
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
		ToolVerifyInput: func(input any, toolUseData *uctypes.UIMessageDataToolUse) error {
			parsed, err := parseTermRunCommandInput(input)
			if err != nil {
				return err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return fmt.Errorf("terminal widget not found: %w", err)
			}

			blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
			rtInfo := wstore.GetRTInfo(blockORef)
			if rtInfo == nil {
				return fmt.Errorf("terminal runtime info not available")
			}
			if !rtInfo.ShellIntegration {
				return fmt.Errorf("shell integration is not enabled for this terminal — it is required to track command execution")
			}
			if rtInfo.ShellState == "running-command" {
				return fmt.Errorf("terminal is currently running another command, wait for it to finish first")
			}

			return nil
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermRunCommandInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, fmt.Errorf("terminal widget not found: %w", err)
			}

			blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
			rtInfo := wstore.GetRTInfo(blockORef)
			if rtInfo == nil {
				return nil, fmt.Errorf("terminal runtime info not available")
			}
			if !rtInfo.ShellIntegration {
				return nil, fmt.Errorf("shell integration is not enabled for this terminal")
			}
			if rtInfo.ShellState == "running-command" {
				return nil, fmt.Errorf("terminal is currently running another command")
			}

			// Send the command to the terminal
			err = sendCommandToTerminal(fullBlockId, parsed.Command)
			if err != nil {
				return nil, fmt.Errorf("failed to send command to terminal: %w", err)
			}

			// Wait briefly for the command to start
			time.Sleep(100 * time.Millisecond)

			// Wait for the command to complete with a timeout
			waitCtx, waitCancel := context.WithTimeout(context.Background(), TermRunCommandTimeout)
			defer waitCancel()

			completed, err := waitForCommandCompletion(waitCtx, blockORef)

			// Read the output regardless of whether it completed or timed out
			rpcClient := wshclient.GetBareRpcClient()
			scrollbackResult, scrollErr := wshclient.TermGetScrollbackLinesCommand(
				rpcClient,
				wshrpc.CommandTermGetScrollbackLinesData{
					LastCommand: true,
				},
				&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(fullBlockId)},
			)

			output := &TermRunCommandOutput{
				Command: parsed.Command,
			}

			if err != nil && !completed {
				output.TimedOut = true
			}

			// Get exit code from RTInfo
			latestRtInfo := wstore.GetRTInfo(blockORef)
			if latestRtInfo != nil && latestRtInfo.ShellState == "ready" {
				exitCode := latestRtInfo.ShellLastCmdExitCode
				output.ExitCode = &exitCode
			}

			if scrollErr == nil && scrollbackResult != nil {
				lines := scrollbackResult.Lines
				if len(lines) > TermRunMaxOutputLines {
					lines = lines[len(lines)-TermRunMaxOutputLines:]
				}
				output.Output = strings.Join(lines, "\n")
			}

			return output, nil
		},
	}
}
