// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var testCmd = &cobra.Command{
	Use:     "test",
	Hidden:  true,
	Short:   "test command",
	PreRunE: preRunSetupRpcClient,
	RunE:    runTestCmd,
}

func init() {
	rootCmd.AddCommand(testCmd)
}

func runTestCmd(cmd *cobra.Command, args []string) error {
	rtn, err := wshclient.TestMultiArgCommand(RpcClient, "testarg", 42, true, nil)
	if err != nil {
		return err
	}
	WriteStdout("%s\n", rtn)
	return nil
}
