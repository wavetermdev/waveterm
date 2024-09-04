// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/remote"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
)

var connReinstallCmd = &cobra.Command{
	Use:     "connreinstall",
	Short:   "reinstall wsh on a connection",
	Args:    cobra.ExactArgs(1),
	Run:     connReinstallRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(connReinstallCmd)
}

func connReinstallRun(cmd *cobra.Command, args []string) {
	connName := args[0]
	_, err := remote.ParseOpts(connName)
	if err != nil {
		WriteStderr("[error] cannot parse connection name: %v\n", err)
		return
	}
	err = wshclient.ConnReinstallWshCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		WriteStderr("[error] getting metadata: %v\n", err)
		return
	}
	WriteStdout("wsh reinstalled on connection %q\n", connName)
}
