// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshremote"
)

var serverCmd = &cobra.Command{
	Use:    "connserver",
	Hidden: true,
	Short:  "remote server to power wave blocks",
	Args:   cobra.NoArgs,
	RunE:   serverRun,
}

var connServerRouter bool

func init() {
	serverCmd.Flags().BoolVar(&connServerRouter, "router", false, "run in local router mode")
	rootCmd.AddCommand(serverCmd)
}

func serverRunRouter() error {
	select {}
}

func serverRunNormal() error {
	err := setupRpcClient(&wshremote.ServerImpl{LogWriter: os.Stdout})
	if err != nil {
		return err
	}
	WriteStdout("running wsh connserver (%s)\n", RpcContext.Conn)
	go wshremote.RunSysInfoLoop(RpcClient, RpcContext.Conn)
	select {} // run forever
}

func serverRun(cmd *cobra.Command, args []string) error {
	if connServerRouter {
		return serverRunRouter()
	} else {
		return serverRunNormal()
	}
}
