// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func GetTermGetScrollbackToolDefinition(block *waveobj.Block) uctypes.ToolDefinition {
	blockIdPrefix := block.OID[:8]
	toolName := fmt.Sprintf("term_get_scrollback_%s", blockIdPrefix)

	return uctypes.ToolDefinition{
		Name:        toolName,
		DisplayName: fmt.Sprintf("Get Terminal Scrollback %s", blockIdPrefix),
		Description: fmt.Sprintf("Fetch terminal scrollback from widget %s as plain text. Index 0 is the most recent line; indices increase going upward (older lines).", blockIdPrefix),
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"linestart": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"description": "Logical start index where 0 = most recent line (default: 0)",
				},
				"lineend": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"description": "Exclusive end index. Returns lines [linestart, lineend)",
				},
				"count": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Alternative to lineend: number of lines to return from linestart (default: 200)",
				},
			},
			"required":             []string{},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			const DEFAULT_COUNT = 200
			inputMap := make(map[string]any)
			if input != nil {
				if m, ok := input.(map[string]any); ok {
					inputMap = m
				}
			}

			lineStart := 0
			if val, ok := inputMap["linestart"].(float64); ok {
				lineStart = int(val)
			}

			count := DEFAULT_COUNT
			if val, ok := inputMap["count"].(float64); ok {
				count = int(val)
			} else if lineEndVal, ok := inputMap["lineend"].(float64); ok {
				lineEnd := int(lineEndVal)
				count = lineEnd - lineStart
			}

			if lineStart == 0 && count == DEFAULT_COUNT {
				return fmt.Sprintf("reading terminal output from %s (most recent %d lines)", blockIdPrefix, count)
			}
			lineEnd := lineStart + count
			return fmt.Sprintf("reading terminal output from %s (lines %d-%d)", blockIdPrefix, lineStart, lineEnd)
		},
		ToolAnyCallback: func(input any) (any, error) {
			const DEFAULT_COUNT = 200
			const MAX_COUNT = 1000

			inputMap := make(map[string]any)
			if input != nil {
				var ok bool
				inputMap, ok = input.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid input format")
				}
			}

			lineStart := 0
			if val, ok := inputMap["linestart"].(float64); ok {
				lineStart = int(val)
			}

			count := DEFAULT_COUNT
			if val, ok := inputMap["count"].(float64); ok {
				count = int(val)
			} else if lineEndVal, ok := inputMap["lineend"].(float64); ok {
				lineEnd := int(lineEndVal)
				count = lineEnd - lineStart
			}

			count = min(count, MAX_COUNT)
			if count < 0 {
				count = 0
			}
			lineEnd := lineStart + count

			rpcClient := wshclient.GetBareRpcClient()
			result, err := wshclient.TermGetScrollbackLinesCommand(
				rpcClient,
				wshrpc.CommandTermGetScrollbackLinesData{
					LineStart: lineStart,
					LineEnd:   lineEnd,
				},
				&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(block.OID)},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to get terminal scrollback: %w", err)
			}

			content := strings.Join(result.Lines, "\n")
			sinceLastOutputSec := 0
			if result.LastUpdated > 0 {
				sinceLastOutputSec = max(0, int((time.Now().UnixMilli()-result.LastUpdated)/1000))
			}

			return map[string]any{
				"totallines":            result.TotalLines,
				"linestart":             result.LineStart,
				"lineend":               min(lineEnd, result.TotalLines),
				"returned_lines":        len(result.Lines),
				"content":               content,
				"since_last_output_sec": sinceLastOutputSec,
				"has_more":              lineEnd < result.TotalLines,
			}, nil
		},
	}
}