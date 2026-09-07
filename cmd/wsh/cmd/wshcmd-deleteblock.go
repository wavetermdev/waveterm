// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var deleteBlockCmd = &cobra.Command{
	Use:     "deleteblock [block-ref]",
	Short:   "delete a block",
	Long:    "Delete a block. Optionally specify a block reference (block:oid, uuid, block number, or keyword like 'this'). If no block is specified, deletes the current block. Can also use --block/-b flag.",
	Args:    cobra.MaximumNArgs(1),
	RunE:    deleteBlockRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(deleteBlockCmd)
}

func deleteBlockRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("deleteblock", rtnErr == nil)
	}()
	var blockRef string
	if len(args) > 0 {
		blockRef = args[0]
	}
	fullORef, err := resolveBlockArgWithOverride(blockRef)
	if err != nil {
		return err
	}
	if fullORef.OType != "block" {
		return fmt.Errorf("object reference is not a block")
	}
	deleteBlockData := &wshrpc.CommandDeleteBlockData{
		BlockId: fullORef.OID,
	}
	err = wshclient.DeleteBlockCommand(RpcClient, *deleteBlockData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("delete block failed: %v", err)
	}
	WriteStdout("block deleted\n")
	return nil
}
