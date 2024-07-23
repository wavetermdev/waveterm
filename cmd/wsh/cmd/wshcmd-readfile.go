// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

var readFileCmd = &cobra.Command{
	Use:   "readfile",
	Short: "read a blockfile",
	Args:  cobra.ExactArgs(2),
	Run:   runReadFile,
}

func init() {
	rootCmd.AddCommand(readFileCmd)
}

func runReadFile(cmd *cobra.Command, args []string) {
	oref := args[0]
	if oref == "" {
		fmt.Fprintf(os.Stderr, "oref is required\r\n")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		return
	}

	wshutil.SetTermRawModeAndInstallShutdownHandlers(true)
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error resolving oref: %v\r\n", err)
		return
	}
	resp64, err := wshclient.ReadFile(RpcClient, wshrpc.CommandFileData{ZoneId: fullORef.OID, FileName: args[1]}, &wshrpc.WshRpcCommandOpts{Timeout: 5000})
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading file: %v\r\n", err)
		return
	}
	resp, err := base64.StdEncoding.DecodeString(resp64)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error decoding file: %v\r\n", err)
		return
	}
	fmt.Print(string(resp))
}
