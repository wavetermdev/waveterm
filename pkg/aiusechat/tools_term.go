// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	termSendInputMaxLen           = 4096
	termSendInputReadyPollIntvl   = 150 * time.Millisecond
	termSendInputReadyMaxWait     = 30 * time.Second
	termSendInputNoIntegrationMs  = 1000
	termSendInputDefaultScrollLen = 200
)

type TermGetScrollbackToolInput struct {
	WidgetId  string `json:"widget_id"`
	LineStart int    `json:"line_start,omitempty"`
	Count     int    `json:"count,omitempty"`
}

type CommandInfo struct {
	Command  string `json:"command"`
	Status   string `json:"status"`
	ExitCode *int   `json:"exitcode,omitempty"`
}

type TermGetScrollbackToolOutput struct {
	TotalLines         int          `json:"totallines"`
	LineStart          int          `json:"linestart"`
	LineEnd            int          `json:"lineend"`
	ReturnedLines      int          `json:"returnedlines"`
	Content            string       `json:"content"`
	SinceLastOutputSec *int         `json:"sincelastoutputsec,omitempty"`
	HasMore            bool         `json:"hasmore"`
	NextStart          *int         `json:"nextstart"`
	LastCommand        *CommandInfo `json:"lastcommand,omitempty"`
}

func parseTermGetScrollbackInput(input any) (*TermGetScrollbackToolInput, error) {
	const (
		DefaultCount = 200
		MaxCount     = 1000
	)

	result := &TermGetScrollbackToolInput{
		LineStart: 0,
		Count:     0,
	}

	if input == nil {
		result.Count = DefaultCount
		return result, nil
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.Count == 0 {
		result.Count = DefaultCount
	}

	if result.Count < 0 {
		return nil, fmt.Errorf("count must be positive")
	}

	result.Count = min(result.Count, MaxCount)

	return result, nil
}

func getTermScrollbackOutput(tabId string, widgetId string, rpcData wshrpc.CommandTermGetScrollbackLinesData) (*TermGetScrollbackToolOutput, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, widgetId)
	if err != nil {
		return nil, err
	}

	rpcClient := wshclient.GetBareRpcClient()
	result, err := wshclient.TermGetScrollbackLinesCommand(
		rpcClient,
		rpcData,
		&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(fullBlockId)},
	)
	if err != nil {
		return nil, err
	}

	content := strings.Join(result.Lines, "\n")
	var effectiveLineEnd int
	if rpcData.LastCommand {
		effectiveLineEnd = result.LineStart + len(result.Lines)
	} else {
		effectiveLineEnd = min(rpcData.LineEnd, result.TotalLines)
	}
	hasMore := effectiveLineEnd < result.TotalLines

	var sinceLastOutputSec *int
	if result.LastUpdated > 0 {
		sec := max(0, int((time.Now().UnixMilli()-result.LastUpdated)/1000))
		sinceLastOutputSec = &sec
	}

	var nextStart *int
	if hasMore {
		nextStart = &effectiveLineEnd
	}

	blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
	rtInfo := wstore.GetRTInfo(blockORef)

	var lastCommand *CommandInfo
	if rtInfo != nil && rtInfo.ShellIntegration && rtInfo.ShellLastCmd != "" {
		cmdInfo := &CommandInfo{
			Command: rtInfo.ShellLastCmd,
		}
		if rtInfo.ShellState == "running-command" {
			cmdInfo.Status = "running"
		} else if rtInfo.ShellState == "ready" {
			cmdInfo.Status = "completed"
			exitCode := rtInfo.ShellLastCmdExitCode
			cmdInfo.ExitCode = &exitCode
		}
		lastCommand = cmdInfo
	}

	return &TermGetScrollbackToolOutput{
		TotalLines:         result.TotalLines,
		LineStart:          result.LineStart,
		LineEnd:            effectiveLineEnd,
		ReturnedLines:      len(result.Lines),
		Content:            content,
		SinceLastOutputSec: sinceLastOutputSec,
		HasMore:            hasMore,
		NextStart:          nextStart,
		LastCommand:        lastCommand,
	}, nil
}

func GetTermGetScrollbackToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_get_scrollback",
		DisplayName: "Get Terminal Scrollback",
		Description: "Fetch terminal scrollback from a widget as plain text. Index 0 is the most recent line; indices increase going upward (older lines). Also returns last command and exit code if shell integration is enabled.",
		ToolLogName: "term:getscrollback",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
				"line_start": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"description": "Logical start index where 0 = most recent line (default: 0).",
				},
				"count": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Number of lines to return from line_start (default: 200).",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermGetScrollbackInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}

			if parsed.LineStart == 0 && parsed.Count == 200 {
				return fmt.Sprintf("reading terminal output from %s (most recent %d lines)", parsed.WidgetId, parsed.Count)
			}
			lineEnd := parsed.LineStart + parsed.Count
			return fmt.Sprintf("reading terminal output from %s (lines %d-%d)", parsed.WidgetId, parsed.LineStart, lineEnd)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermGetScrollbackInput(input)
			if err != nil {
				return nil, err
			}

			lineEnd := parsed.LineStart + parsed.Count
			output, err := getTermScrollbackOutput(
				tabId,
				parsed.WidgetId,
				wshrpc.CommandTermGetScrollbackLinesData{
					LineStart:   parsed.LineStart,
					LineEnd:     lineEnd,
					LastCommand: false,
				},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to get terminal scrollback: %w", err)
			}
			return output, nil
		},
	}
}

type TermCommandOutputToolInput struct {
	WidgetId string `json:"widget_id"`
}

func parseTermCommandOutputInput(input any) (*TermCommandOutputToolInput, error) {
	result := &TermCommandOutputToolInput{}

	if input == nil {
		return nil, fmt.Errorf("widget_id is required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}

	return result, nil
}

func GetTermCommandOutputToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_command_output",
		DisplayName: "Get Last Command Output",
		Description: "Retrieve output from the most recent command in a terminal widget. Requires shell integration to be enabled. Returns the command text, exit code, and up to 1000 lines of output.",
		ToolLogName: "term:commandoutput",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermCommandOutputInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("reading last command output from %s", parsed.WidgetId)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermCommandOutputInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
			rtInfo := wstore.GetRTInfo(blockORef)
			if rtInfo == nil || !rtInfo.ShellIntegration {
				return nil, fmt.Errorf("shell integration is not enabled for this terminal")
			}

			output, err := getTermScrollbackOutput(
				tabId,
				parsed.WidgetId,
				wshrpc.CommandTermGetScrollbackLinesData{
					LastCommand: true,
				},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to get command output: %w", err)
			}
			return output, nil
		},
	}
}

type TermSendInputToolInput struct {
	WidgetId   string `json:"widget_id"`
	InputText  string `json:"input_text"`
	PressEnter *bool  `json:"press_enter,omitempty"`
}

type TermSendInputToolOutput struct {
	Sent       string                       `json:"sent"`
	Output     *TermGetScrollbackToolOutput `json:"output,omitempty"`
	OutputNote string                       `json:"output_note,omitempty"`
}

func parseTermSendInputInput(input any) (*TermSendInputToolInput, error) {
	if input == nil {
		return nil, fmt.Errorf("input is required")
	}
	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}
	result := &TermSendInputToolInput{}
	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}
	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}
	if result.InputText == "" {
		return nil, fmt.Errorf("input_text is required")
	}
	if len(result.InputText) > termSendInputMaxLen {
		return nil, fmt.Errorf("input_text too long: %d bytes (max %d)", len(result.InputText), termSendInputMaxLen)
	}
	if err := validateTermInputText(result.InputText); err != nil {
		return nil, err
	}
	return result, nil
}

// validateTermInputText rejects control bytes other than tab/newline/carriage-return.
// This stops the model from smuggling SIGINT (\x03), EOF (\x04), or escape sequences
// past the user-approval gate.
func validateTermInputText(s string) error {
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b == '\t' || b == '\n' || b == '\r' {
			continue
		}
		if b < 0x20 || b == 0x7f {
			return fmt.Errorf("input_text contains disallowed control byte 0x%02x at offset %d", b, i)
		}
	}
	return nil
}

func termSendInputPressEnter(in *TermSendInputToolInput) bool {
	if in.PressEnter == nil {
		return true
	}
	return *in.PressEnter
}

func termSendInputDescribe(text string, pressEnter bool) string {
	display := text
	display = strings.ReplaceAll(display, "\n", "\\n")
	display = strings.ReplaceAll(display, "\r", "\\r")
	display = strings.ReplaceAll(display, "\t", "\\t")
	if len(display) > 80 {
		display = display[:77] + "..."
	}
	if pressEnter {
		return display + " <Enter>"
	}
	return display
}

func GetTermSendInputToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_send_input",
		DisplayName: "Send Input to Terminal",
		Description: "Send text input to a terminal widget's PTY (the user's interactive shell). Each call requires explicit user approval. Pressing Enter is enabled by default; set press_enter=false to send raw text without a trailing newline. Use for running shell commands on the user's behalf. Prefer non-destructive read-only commands; explain destructive actions before sending. After execution this tool returns the resulting terminal output, so you do NOT need to call term_get_scrollback right after.",
		ToolLogName: "term:sendinput",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the target terminal widget",
				},
				"input_text": map[string]any{
					"type":        "string",
					"description": "Text to send to the terminal. Control bytes other than tab/newline/carriage-return are rejected.",
				},
				"press_enter": map[string]any{
					"type":        "boolean",
					"description": "Whether to append a carriage return (Enter) after input_text. Default true.",
				},
			},
			"required":             []string{"widget_id", "input_text"},
			"additionalProperties": false,
		},
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
		ToolVerifyInput: func(input any, _ *uctypes.UIMessageDataToolUse) error {
			_, err := parseTermSendInputInput(input)
			return err
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermSendInputInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("send to %s: %s", parsed.WidgetId, termSendInputDescribe(parsed.InputText, termSendInputPressEnter(parsed)))
		},
		ToolAnyCallback: func(input any, _ *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermSendInputInput(input)
			if err != nil {
				return nil, err
			}
			return runTermSendInput(tabId, parsed)
		},
	}
}

func runTermSendInput(tabId string, parsed *TermSendInputToolInput) (*TermSendInputToolOutput, error) {
	resolveCtx, cancelResolve := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelResolve()
	fullBlockId, err := wcore.ResolveBlockIdFromPrefix(resolveCtx, tabId, parsed.WidgetId)
	if err != nil {
		return nil, err
	}

	block, err := wstore.DBGet[*waveobj.Block](resolveCtx, fullBlockId)
	if err != nil {
		return nil, fmt.Errorf("failed to load block: %w", err)
	}
	if block == nil || block.Meta == nil {
		return nil, fmt.Errorf("block %s not found", parsed.WidgetId)
	}
	viewType, _ := block.Meta["view"].(string)
	if viewType != "term" {
		return nil, fmt.Errorf("block %s is not a terminal widget (view=%q)", parsed.WidgetId, viewType)
	}

	pressEnter := termSendInputPressEnter(parsed)
	payload := parsed.InputText
	if pressEnter {
		payload += "\r"
	}

	if err := blockcontroller.SendInput(fullBlockId, &blockcontroller.BlockInputUnion{
		InputData: []byte(payload),
	}); err != nil {
		return nil, fmt.Errorf("failed to send input to terminal: %w", err)
	}

	rtn := &TermSendInputToolOutput{Sent: termSendInputDescribe(parsed.InputText, pressEnter)}
	blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
	rtInfo := wstore.GetRTInfo(blockORef)
	hasShellIntegration := rtInfo != nil && rtInfo.ShellIntegration

	var note string
	if hasShellIntegration {
		note = waitForShellReady(blockORef)
	} else {
		time.Sleep(termSendInputNoIntegrationMs * time.Millisecond)
		note = "shell integration not enabled; returning recent scrollback after 1s"
	}

	scrollData := wshrpc.CommandTermGetScrollbackLinesData{}
	if hasShellIntegration {
		scrollData.LastCommand = true
	} else {
		scrollData.LineStart = 0
		scrollData.LineEnd = termSendInputDefaultScrollLen
	}
	output, scrollErr := getTermScrollbackOutput(tabId, parsed.WidgetId, scrollData)
	if scrollErr != nil {
		rtn.OutputNote = fmt.Sprintf("input sent; failed to fetch output: %v", scrollErr)
		return rtn, nil
	}
	rtn.Output = output
	rtn.OutputNote = note
	return rtn, nil
}

// waitForShellReady polls the runtime info until ShellState=="ready" or timeout.
// Returns an empty string on success, or a human-readable note on timeout.
func waitForShellReady(blockORef waveobj.ORef) string {
	deadline := time.Now().Add(termSendInputReadyMaxWait)
	for time.Now().Before(deadline) {
		time.Sleep(termSendInputReadyPollIntvl)
		rt := wstore.GetRTInfo(blockORef)
		if rt == nil {
			continue
		}
		if rt.ShellState == "ready" {
			return ""
		}
	}
	return fmt.Sprintf("command still running after %s; returning partial output", termSendInputReadyMaxWait)
}
