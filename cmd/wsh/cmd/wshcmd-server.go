// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshremote"
)

var serverCmd = &cobra.Command{
	Use:   "server",
	Short: "remote server to power wave blocks",
	Args:  cobra.NoArgs,
	Run:   serverRun,
}

func init() {
	rootCmd.AddCommand(serverCmd)
}

func serverRun(cmd *cobra.Command, args []string) {
	WriteStdout("running wsh server\n")
	RpcClient.SetServerImpl(&wshremote.ServerImpl{LogWriter: os.Stdout})
	err := wshclient.TestCommand(RpcClient, "hello", nil)
	WriteStdout("got test rtn: %v\n", err)

	select {} // run forever
}
