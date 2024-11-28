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
}

func init() {
	workspaceCommand.AddCommand(workspaceListCommand)
	rootCmd.AddCommand(workspaceCommand)
}

var workspaceListCommand = &cobra.Command{
	Use:     "list",
	Short:   "List workspaces",
	Run:     workspaceListRun,
	PreRunE: preRunSetupRpcClient,
}

func workspaceListRun(cmd *cobra.Command, args []string) {
	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("Unable to list workspaces: %v\n", err)
		return
	}

	WriteStdout("Workspaces:\n")
	for _, w := range workspaces {
		WriteStdout("\tWorkspace ID: %s\n", w.WorkspaceData.OID)
		WriteStdout("\t\tWindow ID: %s\n", w.WindowId)
		WriteStdout("\t\tWorkspace Name: \"%s\"\n", w.WorkspaceData.Name)
		WriteStdout("\t\tWorkspace Icon: %s\n", w.WorkspaceData.Icon)
		WriteStdout("\t\tWorkspace Color: %s\n\n", w.WorkspaceData.Color)
	}
}
