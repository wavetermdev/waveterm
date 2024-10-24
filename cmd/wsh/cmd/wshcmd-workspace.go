// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var workspaceCommand = &cobra.Command{
	Use:   "workspace",
	Short: "Manage workspaces",
	// Args:    cobra.MinimumNArgs(1),
	Run:     workspaceRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(workspaceCommand)
}

func workspaceRun(cmd *cobra.Command, args []string) {
	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("Unable to list workspaces: %v\n", err)
		return
	}

	for _, w := range workspaces {
		WriteStdout("workspaceid: %s, windowid: %s\n", w.WorkspaceId, w.WindowId)
	}
}
