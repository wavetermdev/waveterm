// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshremote"
)

var serverCmd = &cobra.Command{
	Use:     "connserver",
	Short:   "remote server to power wave blocks",
	Args:    cobra.NoArgs,
	Run:     serverRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(serverCmd)
}

func serverRun(cmd *cobra.Command, args []string) {
	WriteStdout("running wsh connserver (%s)\n", RpcContext.Conn)
	go wshremote.RunSysInfoLoop(RpcClient, RpcContext.Conn)
	RpcClient.SetServerImpl(&wshremote.ServerImpl{LogWriter: os.Stdout})

	select {} // run forever
}
