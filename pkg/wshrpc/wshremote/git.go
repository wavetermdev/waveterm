// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/util/gitutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (impl *ServerImpl) RemoteGitStatusCommand(ctx context.Context, data wshrpc.CommandRemoteGitStatusData) (*wshrpc.GitStatusRtnData, error) {
	cwd := data.Cwd
	if cwd == "" {
		cwd = "~"
	}
	cwd = filepath.Clean(wavebase.ExpandHomeDirSafe(cwd))
	return gitutil.GetStatus(ctx, cwd)
}

func (impl *ServerImpl) RemoteGitFileDiffCommand(ctx context.Context, data wshrpc.CommandRemoteGitFileDiffData) (*wshrpc.GitFileDiffRtnData, error) {
	data.RepoRoot = filepath.Clean(wavebase.ExpandHomeDirSafe(data.RepoRoot))
	return gitutil.GetFileDiff(ctx, data)
}

func (impl *ServerImpl) RemoteGitRevertFileCommand(ctx context.Context, data wshrpc.CommandRemoteGitRevertFileData) error {
	data.RepoRoot = filepath.Clean(wavebase.ExpandHomeDirSafe(data.RepoRoot))
	return gitutil.RevertFile(ctx, data)
}
