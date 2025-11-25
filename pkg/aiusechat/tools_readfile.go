// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/readutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const ReadFileDefaultLineCount = 100
const ReadFileDefaultMaxBytes = 50 * 1024
const StopReasonMaxBytes = "max_bytes"

type readTextFileParams struct {
	Filename string  `json:"filename"`
	Origin   *string `json:"origin"` // "start" or "end", defaults to "start"
	Offset   *int    `json:"offset"` // lines to skip, defaults to 0
	Count    *int    `json:"count"`  // number of lines to read, defaults to DefaultLineCount
	MaxBytes *int    `json:"max_bytes"`
}

func parseReadTextFileInput(input any) (*readTextFileParams, error) {
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
		count := ReadFileDefaultLineCount
		result.Count = &count
	}

	if *result.Count < 1 {
		return nil, fmt.Errorf("count must be at least 1, got %d", *result.Count)
	}

	if result.MaxBytes == nil {
		maxBytes := ReadFileDefaultMaxBytes
		result.MaxBytes = &maxBytes
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

func isBlockedFile(expandedPath string) (bool, string) {
	homeDir := os.Getenv("HOME")
	if homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
	}

	cleanPath := filepath.Clean(expandedPath)
	baseName := filepath.Base(cleanPath)

	exactPaths := []struct {
		path   string
		reason string
	}{
		{filepath.Join(homeDir, ".aws", "credentials"), "AWS credentials file"},
		{filepath.Join(homeDir, ".git-credentials"), "Git credentials file"},
		{filepath.Join(homeDir, ".netrc"), "netrc credentials file"},
		{filepath.Join(homeDir, ".pgpass"), "PostgreSQL password file"},
		{filepath.Join(homeDir, ".my.cnf"), "MySQL credentials file"},
		{filepath.Join(homeDir, ".kube", "config"), "Kubernetes config file"},
		{"/etc/shadow", "system password file"},
		{"/etc/sudoers", "system sudoers file"},
	}

	for _, ep := range exactPaths {
		if cleanPath == ep.path {
			return true, ep.reason
		}
	}

	dirPrefixes := []struct {
		prefix string
		reason string
	}{
		{filepath.Join(homeDir, ".gnupg") + string(filepath.Separator), "GPG directory"},
		{filepath.Join(homeDir, ".password-store") + string(filepath.Separator), "password store directory"},
		{"/etc/sudoers.d/", "system sudoers directory"},
		{"/Library/Keychains/", "macOS keychain directory"},
		{filepath.Join(homeDir, "Library", "Keychains") + string(filepath.Separator), "macOS keychain directory"},
	}

	for _, dp := range dirPrefixes {
		if strings.HasPrefix(cleanPath, dp.prefix) {
			return true, dp.reason
		}
	}

	if strings.Contains(cleanPath, filepath.Join(homeDir, ".secrets")) {
		return true, "secrets directory"
	}

	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		credPath := filepath.Join(localAppData, "Microsoft", "Credentials")
		if strings.HasPrefix(cleanPath, credPath) {
			return true, "Windows credentials"
		}
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		credPath := filepath.Join(appData, "Microsoft", "Credentials")
		if strings.HasPrefix(cleanPath, credPath) {
			return true, "Windows credentials"
		}
	}

	if strings.HasPrefix(baseName, "id_") && strings.Contains(cleanPath, ".ssh") {
		return true, "SSH private key"
	}
	if strings.Contains(baseName, "id_rsa") {
		return true, "SSH private key"
	}
	if strings.HasPrefix(baseName, "ssh_host_") && strings.Contains(baseName, "key") {
		return true, "SSH host key"
	}

	extensions := map[string]string{
		".pem":      "certificate/key file",
		".p12":      "certificate file",
		".key":      "key file",
		".pfx":      "certificate file",
		".pkcs12":   "certificate file",
		".keystore": "Java keystore file",
		".jks":      "Java keystore file",
	}

	if reason, exists := extensions[filepath.Ext(baseName)]; exists {
		return true, reason
	}

	if baseName == ".git-credentials" {
		return true, "Git credentials file"
	}

	return false, ""
}

func verifyReadTextFileInput(input any, toolUseData *uctypes.UIMessageDataToolUse) error {
	params, err := parseReadTextFileInput(input)
	if err != nil {
		return err
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
	if err != nil {
		return fmt.Errorf("failed to expand path: %w", err)
	}

	if blocked, reason := isBlockedFile(expandedPath); blocked {
		return fmt.Errorf("access denied: potentially sensitive file: %s", reason)
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.IsDir() {
		return fmt.Errorf("path is a directory, cannot be read with the read_text_file tool. use the read_dir tool if available to read directories")
	}

	return nil
}

func readTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	const ReadLimit = 1024 * 1024 * 1024

	params, err := parseReadTextFileInput(input)
	if err != nil {
		return nil, err
	}

	expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	if blocked, reason := isBlockedFile(expandedPath); blocked {
		return nil, fmt.Errorf("access denied: potentially sensitive file: %s", reason)
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

	origin := *params.Origin
	offset := *params.Offset
	count := *params.Count
	maxBytes := *params.MaxBytes

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
		"modified_time": modTime.UTC().Format(time.RFC3339),
		"mode":          fileInfo.Mode().String(),
	}
	if stopReason == "read_limit" || stopReason == StopReasonMaxBytes {
		result["truncated"] = stopReason
	}

	return result, nil
}

func GetReadTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "read_text_file",
		DisplayName: "Read Text File",
		Description: "Read a text file from the filesystem. Can read specific line ranges or from the end. Detects and rejects binary files.",
		ToolLogName: "gen:readfile",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Absolute path to the file to read. Supports '~' for the user's home directory. Relative paths are not supported.",
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
					"default":     ReadFileDefaultLineCount,
					"description": "Number of lines to return",
				},
				"max_bytes": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"default":     ReadFileDefaultMaxBytes,
					"description": "Maximum bytes to return. If the result exceeds this, it will be truncated at line boundaries",
				},
			},
			"required":             []string{"filename"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseReadTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}

			origin := *parsed.Origin
			offset := *parsed.Offset
			count := *parsed.Count

			readFullFile := false
			if output != nil {
				if outputMap, ok := output.(map[string]any); ok {
					_, wasTruncated := outputMap["truncated"]
					readFullFile = !wasTruncated
				}
			}

			if origin == "start" && offset == 0 {
				if readFullFile {
					return fmt.Sprintf("reading %q (entire file)", parsed.Filename)
				}
				return fmt.Sprintf("reading %q (first %d lines)", parsed.Filename, count)
			}
			if origin == "end" && offset == 0 {
				if readFullFile {
					return fmt.Sprintf("reading %q (entire file)", parsed.Filename)
				}
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
		ToolVerifyInput: verifyReadTextFileInput,
	}
}
