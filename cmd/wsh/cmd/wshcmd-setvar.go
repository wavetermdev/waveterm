// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const DefaultVarFileName = "var"

var setVarCmd = &cobra.Command{
	Use:     "setvar key [value]",
	Short:   "set variable for a block",
	Long:    "Set a variable for a block. If value is omitted, the variable will be removed.",
	Args:    cobra.RangeArgs(1, 2),
	RunE:    setVarRun,
	PreRunE: preRunSetupRpcClient,
}

var envFileName string

func init() {
	rootCmd.AddCommand(setVarCmd)
	setVarCmd.Flags().StringVar(&envFileName, "varfile", DefaultVarFileName, "var file name")
}

func setVarRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("setvar", rtnErr == nil)
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
		FileName: envFileName,
		Remove:   len(args) < 2,
	}

	if len(args) == 2 {
		commandData.Val = args[1]
	}

	err = wshclient.SetVarCommand(RpcClient, commandData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("setting variable: %w", err)
	}

	if commandData.Remove {
		WriteStdout("removed variable %s\n", key)
	} else {
		WriteStdout("set variable %s\n", key)
	}
	return nil
}
