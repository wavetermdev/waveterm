// Copyright 2025, Command Line Inc.
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

	WriteStdout("[\n")
	for i, w := range workspaces {
		WriteStdout("  {\n    \"windowId\": \"%s\",\n", w.WindowId)
		WriteStderr("    \"workspaceId\": \"%s\",\n", w.WorkspaceData.OID)
		WriteStdout("    \"name\": \"%s\",\n", w.WorkspaceData.Name)
		WriteStdout("    \"icon\": \"%s\",\n", w.WorkspaceData.Icon)
		WriteStdout("    \"color\": \"%s\"\n", w.WorkspaceData.Color)
		if i < len(workspaces)-1 {
			WriteStdout("  },\n")
		} else {
			WriteStdout("  }\n")
		}
	}
	WriteStdout("]\n")
}
