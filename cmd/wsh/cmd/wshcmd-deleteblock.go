// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
)

var deleteBlockCmd = &cobra.Command{
	Use:   "deleteblock",
	Short: "delete a block",
	Args:  cobra.ExactArgs(1),
	Run:   deleteBlockRun,
}

func init() {
	rootCmd.AddCommand(deleteBlockCmd)
}

func deleteBlockRun(cmd *cobra.Command, args []string) {
	oref := args[0]
	if oref == "" {
		fmt.Println("oref is required")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		fmt.Printf("%v\n", err)
		return
	}
	setTermRawMode()
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		fmt.Printf("error resolving oref: %v\r\n", err)
		return
	}
	if fullORef.OType != "block" {
		fmt.Printf("oref is not a block\r\n")
		return
	}
	deleteBlockData := &wshrpc.CommandDeleteBlockData{
		BlockId: fullORef.OID,
	}
	_, err = RpcClient.SendRpcRequest(wshrpc.Command_DeleteBlock, deleteBlockData, 2000)
	if err != nil {
		fmt.Printf("error deleting block: %v\r\n", err)
		return
	}
	fmt.Print("block deleted\r\n")
}
