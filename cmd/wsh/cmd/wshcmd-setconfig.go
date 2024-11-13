// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var setConfigCmd = &cobra.Command{
	Use:     "setconfig",
	Short:   "set config",
	Args:    cobra.MinimumNArgs(1),
	Run:     setConfigRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(setConfigCmd)
}

func setConfigRun(cmd *cobra.Command, args []string) {
	metaSetsStrs := args[:]
	meta, err := parseMetaSets(metaSetsStrs)
	if err != nil {
		WriteStderr("[error] %v\n", err)
		return
	}
	commandData := wshrpc.MetaSettingsType{MetaMapType: meta}
	err = wshclient.SetConfigCommand(RpcClient, commandData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] setting config: %v\n", err)
		return
	}
	WriteStdout("config set\n")
}
