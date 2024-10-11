// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var deleteBlockCmd = &cobra.Command{
	Use:     "deleteblock",
	Short:   "delete a block",
	Run:     deleteBlockRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(deleteBlockCmd)
}

func deleteBlockRun(cmd *cobra.Command, args []string) {
	oref := blockArg
	err := validateEasyORef(oref)
	if err != nil {
		WriteStderr("[error]%v\n", err)
		return
	}
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		WriteStderr("[error] resolving oref: %v\n", err)
		return
	}
	if fullORef.OType != "block" {
		WriteStderr("[error] oref is not a block\n")
		return
	}
	deleteBlockData := &wshrpc.CommandDeleteBlockData{
		BlockId: fullORef.OID,
	}
	_, err = RpcClient.SendRpcRequest(wshrpc.Command_DeleteBlock, deleteBlockData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] deleting block: %v\n", err)
		return
	}
	WriteStdout("block deleted\n")
}
