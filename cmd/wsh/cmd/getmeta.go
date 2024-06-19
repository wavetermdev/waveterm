// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

var getMetaCmd = &cobra.Command{
	Use:   "getmeta",
	Short: "get metadata for an entity",
	Args:  cobra.ExactArgs(1),
	Run:   getMetaRun,
}

func init() {
	rootCmd.AddCommand(getMetaCmd)
}

func getMetaRun(cmd *cobra.Command, args []string) {
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
	getMetaWshCmd := &wshutil.BlockGetMetaCommand{
		Command: wshutil.BlockCommand_SetMeta,
		ORef:    fullORef,
	}
	resp, err := RpcClient.SendRpcRequest(getMetaWshCmd, 2000)
	if err != nil {
		log.Printf("error getting metadata: %v\r\n", err)
		return
	}
	outArr, err := json.MarshalIndent(resp, "", "  ")
	if err != nil {
		log.Printf("error formatting metadata: %v\r\n", err)
		return
	}
	outStr := string(outArr)
	outStr = strings.ReplaceAll(outStr, "\n", "\r\n")
	fmt.Print(outStr)
	fmt.Print("\r\n")
}