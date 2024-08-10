// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
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
		WriteStderr("[error] oref is required")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		WriteStderr("[error] %v\n", err)
		return
	}
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		WriteStderr("[error] resolving oref: %v\n", err)
		return
	}
	resp, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *fullORef}, &wshrpc.WshRpcCommandOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] getting metadata: %v\n", err)
		return
	}
	if len(args) > 1 {
		val, ok := resp[args[1]]
		if !ok {
			return
		}
		outBArr, err := json.MarshalIndent(val, "", "  ")
		if err != nil {
			WriteStderr("[error] formatting metadata: %v\n", err)
			return
		}
		outStr := string(outBArr)
		WriteStdout(outStr + "\n")
	} else {
		outBArr, err := json.MarshalIndent(resp, "", "  ")
		if err != nil {
			WriteStderr("[error] formatting metadata: %v\n", err)
			return
		}
		outStr := string(outBArr)
		WriteStdout(outStr + "\n")
	}
}
