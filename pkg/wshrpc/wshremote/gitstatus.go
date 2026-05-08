// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
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
