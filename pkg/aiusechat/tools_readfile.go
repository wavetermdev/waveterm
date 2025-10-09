// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/readutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const StopReasonMaxBytes = "max_bytes"

type readTextFileParams struct {
	Filename string  `json:"filename"`
	Origin   *string `json:"origin"` // "start" or "end", defaults to "start"
	Offset   *int    `json:"offset"` // lines to skip, defaults to 0
	Count    *int    `json:"count"`  // number of lines to read, defaults to DefaultLineCount
	MaxBytes *int    `json:"max_bytes"`
}

func parseReadTextFileInput(input any) (*readTextFileParams, error) {
	const DefaultLineCount = 100

	result := &readTextFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	if result.Origin == nil {
		origin := "start"
		result.Origin = &origin
	}

	if *result.Origin != "start" && *result.Origin != "end" {
		return nil, fmt.Errorf("invalid origin value '%s': must be 'start' or 'end'", *result.Origin)
	}

	if result.Offset == nil {
		offset := 0
		result.Offset = &offset
	}

	if *result.Offset < 0 {
		return nil, fmt.Errorf("offset must be non-negative, got %d", *result.Offset)
	}

	if result.Count == nil {
		count := DefaultLineCount
		result.Count = &count
	}

	if *result.Count < 1 {
		return nil, fmt.Errorf("count must be at least 1, got %d", *result.Count)
	}

	return result, nil
}

// truncateData truncates data to maxBytes while respecting line boundaries.
// For origin "start", keeps the beginning and truncates at last newline before maxBytes.
// For origin "end", keeps the end and truncates from beginning at first newline after removing excess.
func truncateData(data string, origin string, maxBytes int) string {
	if len(data) <= maxBytes {
		return data
	}

	if origin == "end" {
		excessBytes := len(data) - maxBytes
		truncateIdx := strings.Index(data[excessBytes:], "\n")
		if truncateIdx == -1 {
			return data[excessBytes:]
		}
		return data[excessBytes+truncateIdx+1:]
	}

	truncateIdx := strings.LastIndex(data[:maxBytes], "\n")
	if truncateIdx == -1 {
		return data[:maxBytes]
	}
	return data[:truncateIdx+1]
}

func readTextFileCallback(input any) (any, error) {
	const DefaultLineCount = 100
	const DefaultMaxBytes = 50 * 1024
	const ReadLimit = 1024 * 1024 * 1024

	var params readTextFileParams
	if err := utilfn.ReUnmarshal(&params, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if params.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	maxBytes := DefaultMaxBytes
	if params.MaxBytes != nil {
		maxBytes = *params.MaxBytes
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.IsDir() {
		return nil, fmt.Errorf("path is a directory, cannot be read with the read_text_file tool. use the read_dir tool if available to read directories")
	}

	file, err := os.Open(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	totalSize := fileInfo.Size()
	modTime := fileInfo.ModTime()

	initialBuf := make([]byte, min(8192, int(totalSize)))
	n, err := file.Read(initialBuf)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}
	initialBuf = initialBuf[:n]

	if utilfn.IsBinaryContent(initialBuf) {
		return nil, fmt.Errorf("file appears to be binary content")
	}

	origin := "start"
	if params.Origin != nil {
		origin = *params.Origin
	}

	if origin != "start" && origin != "end" {
		return nil, fmt.Errorf("invalid origin value '%s': must be 'start' or 'end'", origin)
	}

	offset := 0
	if params.Offset != nil {
		offset = *params.Offset
	}

	count := DefaultLineCount
	if params.Count != nil {
		count = *params.Count
		if count < 1 {
			return nil, fmt.Errorf("count must be at least 1, got %d", count)
		}
	}

	if offset < 0 {
		offset = 0
	}

	var lines []string
	var stopReason string

	if _, err := file.Seek(0, 0); err != nil {
		return nil, fmt.Errorf("failed to seek to start of file: %w", err)
	}

	if origin == "end" {
		lines, stopReason, err = readutil.ReadTailLines(file, count, offset, int64(ReadLimit))
		if err != nil {
			return nil, fmt.Errorf("error reading file from end: %w", err)
		}
	} else {
		lines, stopReason, err = readutil.ReadLines(file, count, offset, ReadLimit)
		if err != nil {
			return nil, fmt.Errorf("error reading file: %w", err)
		}
	}

	data := strings.Join(lines, "")
	data = strings.TrimSuffix(data, "\n")

	if len(data) > maxBytes {
		data = truncateData(data, origin, maxBytes)
		stopReason = StopReasonMaxBytes
	}

	result := map[string]any{
		"total_size":    totalSize,
		"data":          data,
		"modified":      utilfn.FormatRelativeTime(modTime),
		"modified_time": modTime.UTC().Format("2006-01-02 15:04:05 UTC"),
		"mode":          fileInfo.Mode().String(),
	}
	if stopReason != "" {
		result["truncated"] = stopReason
	}

	return result, nil
}

func GetReadTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "read_text_file",
		DisplayName: "Read Text File",
		Description: "Read a text file from the filesystem. Can read specific line ranges or from the end. Detects and rejects binary files. Requires user approval.",
		ToolLogName: "gen:readfile",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Path to the file to read",
				},
				"origin": map[string]any{
					"type":        "string",
					"enum":        []string{"start", "end"},
					"default":     "start",
					"description": "Where to read from: 'start' (default) or 'end' of file",
				},
				"offset": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"default":     0,
					"description": "Lines to skip. From 'start': 0-based line index. From 'end': lines to skip from the end (0 = very last line)",
				},
				"count": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"default":     100,
					"description": "Number of lines to return",
				},
				"max_bytes": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"default":     51200,
					"description": "Maximum bytes to return. If the result exceeds this, it will be truncated at line boundaries",
				},
			},
			"required":             []string{"filename"},
			"additionalProperties": false,
		},
		ToolInputDesc: func(input any) string {
			parsed, err := parseReadTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}

			origin := "start"
			if parsed.Origin != nil {
				origin = *parsed.Origin
			}
			offset := 0
			if parsed.Offset != nil {
				offset = *parsed.Offset
			}
			count := 100
			if parsed.Count != nil {
				count = *parsed.Count
			}

			if origin == "start" && offset == 0 {
				return fmt.Sprintf("reading %q (first %d lines)", parsed.Filename, count)
			}
			if origin == "end" && offset == 0 {
				return fmt.Sprintf("reading %q (last %d lines)", parsed.Filename, count)
			}
			if origin == "end" {
				return fmt.Sprintf("reading %q (from end: offset %d lines, count %d lines)", parsed.Filename, offset, count)
			}
			return fmt.Sprintf("reading %q (from start: offset %d lines, count %d lines)", parsed.Filename, offset, count)
		},
		ToolAnyCallback: readTextFileCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
