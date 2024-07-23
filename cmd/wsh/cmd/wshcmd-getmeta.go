// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

var getMetaCmd = &cobra.Command{
	Use:   "getmeta",
	Short: "get metadata for an entity",
	Args:  cobra.RangeArgs(1, 2),
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

	wshutil.SetTermRawModeAndInstallShutdownHandlers(true)
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		fmt.Printf("error resolving oref: %v\r\n", err)
		return
	}
	resp, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *fullORef}, &wshrpc.WshRpcCommandOpts{Timeout: 2000})
	if err != nil {
		log.Printf("error getting metadata: %v\r\n", err)
		return
	}
	if len(args) > 1 {
		val, ok := resp[args[1]]
		if !ok {
			return
		}
		outBArr, err := json.MarshalIndent(val, "", "  ")
		if err != nil {
			log.Printf("error formatting metadata: %v\r\n", err)
		}
		outStr := string(outBArr)
		outStr = strings.ReplaceAll(outStr, "\n", "\r\n")
		fmt.Print(outStr)
		fmt.Print("\r\n")
	} else {
		outBArr, err := json.MarshalIndent(resp, "", "  ")
		if err != nil {
			log.Printf("error formatting metadata: %v\r\n", err)
			return
		}
		outStr := string(outBArr)
		outStr = strings.ReplaceAll(outStr, "\n", "\r\n")
		fmt.Print(outStr)
		fmt.Print("\r\n")
	}
}
