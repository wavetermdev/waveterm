// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var getVarCmd = &cobra.Command{
	Use:     "getvar key",
	Short:   "get variable from a block",
	Long:    "Get a variable from a block. Returns the value if it exists. Exit code 0 indicates variable exists, 1 indicates it does not exist.",
	Args:    cobra.ExactArgs(1),
	RunE:    getVarRun,
	PreRunE: preRunSetupRpcClient,
}

var getVarFileName string

func init() {
	rootCmd.AddCommand(getVarCmd)
	getVarCmd.Flags().StringVar(&getVarFileName, "varfile", DefaultVarFileName, "var file name")
}

func getVarRun(cmd *cobra.Command, args []string) error {
	defer func() {
		sendActivity("getvar", WshExitCode == 0)
	}()

	// Resolve block to get zoneId
	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}

	key := args[0]
	commandData := wshrpc.CommandVarData{
		Key:      key,
		ZoneId:   fullORef.OID,
		FileName: getVarFileName,
	}

	resp, err := wshclient.GetVarCommand(RpcClient, commandData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting variable: %w", err)
	}

	if !resp.Exists {
		WshExitCode = 1
		return nil
	}

	WriteStdout("%s\n", resp.Val)
	return nil
}
