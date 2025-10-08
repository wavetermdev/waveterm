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
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type TermGetScrollbackToolInput struct {
	WidgetId  string `json:"widget_id"`
	LineStart int    `json:"line_start,omitempty"`
	Count     int    `json:"count,omitempty"`
}

type TermGetScrollbackToolOutput struct {
	TotalLines         int    `json:"total_lines"`
	LineStart          int    `json:"line_start"`
	LineEnd            int    `json:"line_end"`
	ReturnedLines      int    `json:"returned_lines"`
	Content            string `json:"content"`
	SinceLastOutputSec *int   `json:"since_last_output_sec,omitempty"`
	HasMore            bool   `json:"has_more"`
	NextStart          *int   `json:"next_start"`
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

func GetTermGetScrollbackToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_get_scrollback",
		DisplayName: "Get Terminal Scrollback",
		Description: "Fetch terminal scrollback from a widget as plain text. Index 0 is the most recent line; indices increase going upward (older lines).",
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
					"description": "Logical start index where 0 = most recent line (default: 0)",
				},
				"count": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Number of lines to return from line_start (default: 200)",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
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
		ToolAnyCallback: func(input any) (any, error) {
			parsed, err := parseTermGetScrollbackInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
			if err != nil {
				return nil, fmt.Errorf("error getting tab: %w", err)
			}

			fullBlockId, err := resolveBlockIdFromPrefix(tab, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			lineEnd := parsed.LineStart + parsed.Count

			rpcClient := wshclient.GetBareRpcClient()
			result, err := wshclient.TermGetScrollbackLinesCommand(
				rpcClient,
				wshrpc.CommandTermGetScrollbackLinesData{
					LineStart: parsed.LineStart,
					LineEnd:   lineEnd,
				},
				&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(fullBlockId)},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to get terminal scrollback: %w", err)
			}

			content := strings.Join(result.Lines, "\n")
			effectiveLineEnd := min(lineEnd, result.TotalLines)
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

			return &TermGetScrollbackToolOutput{
				TotalLines:         result.TotalLines,
				LineStart:          result.LineStart,
				LineEnd:            effectiveLineEnd,
				ReturnedLines:      len(result.Lines),
				Content:            content,
				SinceLastOutputSec: sinceLastOutputSec,
				HasMore:            hasMore,
				NextStart:          nextStart,
			}, nil
		},
	}
}
