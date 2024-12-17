// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var pathCommand = &cobra.Command{
	Use:       "path [flags] config|data|log",
	Short:     "Get paths to various waveterm files and directories",
	ValidArgs: []string{"config", "data", "log"},
	Args:      cobra.MatchAll(cobra.OnlyValidArgs, cobra.ExactArgs(1)),
	Run:       runPathCommand,
	PreRunE:   preRunSetupRpcClient,
}

func init() {
	pathCommand.Flags().BoolP("open", "o", false, "Open the path in a new block")
	pathCommand.Flags().BoolP("open-external", "O", false, "Open the path in the default external application")
	rootCmd.AddCommand(pathCommand)
}

func runPathCommand(cmd *cobra.Command, args []string) {
	pathType := args[0]
	open, _ := cmd.Flags().GetBool("open")
	openExternal, _ := cmd.Flags().GetBool("open-external")
	path, err := wshclient.PathCommand(RpcClient, wshrpc.PathCommandData{
		PathType:     pathType,
		Open:         open,
		OpenExternal: openExternal,
	}, nil)
	if err != nil {
		WriteStderr("Error getting path: %v\n", err)
		return
	}
	WriteStdout("%s\n", path)
}
