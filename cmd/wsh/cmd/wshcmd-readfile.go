// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
)

var readFileCmd = &cobra.Command{
	Use:     "readfile",
	Short:   "read a blockfile",
	Args:    cobra.ExactArgs(2),
	Run:     runReadFile,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(readFileCmd)
}

func runReadFile(cmd *cobra.Command, args []string) {
	oref := args[0]
	if oref == "" {
		WriteStderr("[error] oref is required\n")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		WriteStderr("[error] %v\n", err)
		return
	}
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		WriteStderr("error resolving oref: %v\n", err)
		return
	}
	resp64, err := wshclient.FileReadCommand(RpcClient, wshrpc.CommandFileData{ZoneId: fullORef.OID, FileName: args[1]}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		WriteStderr("[error] reading file: %v\n", err)
		return
	}
	resp, err := base64.StdEncoding.DecodeString(resp64)
	if err != nil {
		WriteStderr("[error] decoding file: %v\n", err)
		return
	}
	WriteStdout(string(resp))
}
