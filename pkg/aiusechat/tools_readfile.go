// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

type readTextFileParams struct {
	Filename  string `json:"filename"`
	LineStart *int   `json:"line_start"`
	LineEnd   *int   `json:"line_end"`
	MaxBytes  *int   `json:"max_bytes"`
	FromEnd   bool   `json:"from_end"`
}

func readTextFileCallback(input any) (any, error) {
	const DEFAULT_LINE_COUNT = 100
	const DEFAULT_MAX_BYTES = 50 * 1024

	var params readTextFileParams
	if err := utilfn.ReUnmarshal(&params, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if params.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	maxBytes := DEFAULT_MAX_BYTES
	if params.MaxBytes != nil {
		maxBytes = *params.MaxBytes
	}

	file, err := os.Open(params.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	fileInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

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

	file.Seek(0, 0)

	var lines []string
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, maxBytes)

	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading file: %w", err)
	}

	totalLines := len(lines)

	if params.FromEnd {
		for i, j := 0, len(lines)-1; i < j; i, j = i+1, j-1 {
			lines[i], lines[j] = lines[j], lines[i]
		}
	}

	start := 0
	count := DEFAULT_LINE_COUNT
	if params.LineStart != nil {
		start = *params.LineStart
	}
	if params.LineEnd != nil {
		count = *params.LineEnd - start
	}

	if start < 0 {
		start = 0
	}
	if start > len(lines) {
		start = len(lines)
	}

	end := start + count
	if end > len(lines) {
		end = len(lines)
	}
	if end < start {
		end = start
	}

	selectedLines := lines[start:end]

	var dataBuilder strings.Builder
	for i, line := range selectedLines {
		if i > 0 {
			dataBuilder.WriteString("\n")
		}
		dataBuilder.WriteString(line)
	}
	data := dataBuilder.String()

	truncated := ""
	currentBytes := len(data)
	if currentBytes >= maxBytes {
		truncated = "max_bytes"
		lastNewline := bytes.LastIndexByte([]byte(data[:maxBytes]), '\n')
		if lastNewline > 0 {
			data = data[:lastNewline]
		} else {
			data = data[:maxBytes]
		}
	} else if end >= len(lines) {
		truncated = "eof"
	}

	if truncated == "" {
		truncated = "null"
	}

	return map[string]any{
		"total_size":    totalSize,
		"line_count":    totalLines,
		"data":          data,
		"modified":      utilfn.FormatRelativeTime(modTime),
		"modified_time": modTime.UTC().Format("2006-01-02 15:04:05 UTC"),
		"truncated":     truncated,
	}, nil
}

func GetReadTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "read_text_file",
		DisplayName: "Read Text File",
		Description: "Read a text file from the filesystem. Can read specific line ranges or from the end. Detects and rejects binary files.",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Path to the file to read",
				},
				"line_start": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"description": "Starting line number (0-based). If from_end is true, this is lines from the end.",
				},
				"line_end": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"description": "Ending line number (exclusive). If from_end is true, this is lines from the end.",
				},
				"max_bytes": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Maximum bytes to return (default: 51200). Data will be truncated if it exceeds this.",
				},
				"from_end": map[string]any{
					"type":        "boolean",
					"description": "If true, read lines from the end of the file instead of the beginning (default: false)",
				},
			},
			"required":             []string{"filename"},
			"additionalProperties": false,
		},
		ToolAnyCallback: readTextFileCallback,
	}
}