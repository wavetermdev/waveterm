// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (impl *ServerImpl) RemoteGitStatusCommand(ctx context.Context, data wshrpc.CommandRemoteGitStatusData) (*wshrpc.GitStatusResponse, error) {
	cwd := data.Cwd
	if cwd == "" {
		return nil, fmt.Errorf("cwd is required")
	}

	branch, err := getGitBranch(ctx, cwd)
	if err != nil {
		return &wshrpc.GitStatusResponse{Error: err.Error()}, nil
	}

	files, err := getGitStatusFiles(ctx, cwd)
	if err != nil {
		return &wshrpc.GitStatusResponse{Error: err.Error()}, nil
	}

	return &wshrpc.GitStatusResponse{
		Branch: branch,
		Files:  files,
	}, nil
}

func getGitBranch(ctx context.Context, cwd string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "branch", "--show-current")
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("not a git repository or git not available")
	}
	return strings.TrimSpace(string(out)), nil
}

func getGitStatusFiles(ctx context.Context, cwd string) ([]wshrpc.GitStatusFile, error) {
	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain")
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git status failed: %v", err)
	}

	var files []wshrpc.GitStatusFile
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 4 {
			continue
		}
		status := strings.TrimSpace(line[:2])
		file := line[3:]
		if idx := strings.Index(file, " -> "); idx >= 0 {
			file = file[idx+4:]
		}
		files = append(files, wshrpc.GitStatusFile{
			Status: status,
			File:   file,
		})
	}
	return files, nil
}

var hunkHeaderRegex = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

func (impl *ServerImpl) RemoteGitLineDiffCommand(ctx context.Context, data wshrpc.CommandRemoteGitLineDiffData) (*wshrpc.GitLineDiffResponse, error) {
	if data.Cwd == "" || data.File == "" {
		return nil, fmt.Errorf("cwd and file are required")
	}

	relPath := data.File
	if filepath.IsAbs(relPath) {
		rel, err := filepath.Rel(data.Cwd, relPath)
		if err == nil {
			relPath = rel
		}
	}

	cmd := exec.CommandContext(ctx, "git", "diff", "HEAD", "--unified=0", "--", relPath)
	cmd.Dir = data.Cwd
	out, err := cmd.Output()
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if ok && exitErr.ExitCode() == 1 {
			// diff returns 1 when there are differences - that's fine, use stdout
		} else {
			return &wshrpc.GitLineDiffResponse{Error: fmt.Sprintf("git diff failed: %v", err)}, nil
		}
	}

	hunks := parseUnifiedDiffHunks(string(out))
	return &wshrpc.GitLineDiffResponse{Hunks: hunks}, nil
}

func parseUnifiedDiffHunks(diffOutput string) []wshrpc.GitLineDiffHunk {
	var hunks []wshrpc.GitLineDiffHunk
	scanner := bufio.NewScanner(strings.NewReader(diffOutput))

	for scanner.Scan() {
		line := scanner.Text()
		matches := hunkHeaderRegex.FindStringSubmatch(line)
		if matches == nil {
			continue
		}

		oldCount := 1
		if matches[2] != "" {
			oldCount, _ = strconv.Atoi(matches[2])
		}
		newStart, _ := strconv.Atoi(matches[3])
		newCount := 1
		if matches[4] != "" {
			newCount, _ = strconv.Atoi(matches[4])
		}

		if oldCount == 0 && newCount > 0 {
			hunks = append(hunks, wshrpc.GitLineDiffHunk{
				Type:      "added",
				StartLine: newStart,
				EndLine:   newStart + newCount - 1,
			})
		} else if newCount == 0 && oldCount > 0 {
			hunks = append(hunks, wshrpc.GitLineDiffHunk{
				Type:      "deleted",
				StartLine: newStart,
				EndLine:   newStart,
			})
		} else {
			hunks = append(hunks, wshrpc.GitLineDiffHunk{
				Type:      "modified",
				StartLine: newStart,
				EndLine:   newStart + newCount - 1,
			})
		}
	}
	return hunks
}
