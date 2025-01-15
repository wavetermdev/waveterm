// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/wavefileutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var readFileCmd = &cobra.Command{
	Use:     "readfile [filename]",
	Short:   "read a blockfile",
	Args:    cobra.ExactArgs(1),
	Run:     runReadFile,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(readFileCmd)
}

func runReadFile(cmd *cobra.Command, args []string) {
	fullORef, err := resolveBlockArg()
	if err != nil {
		WriteStderr("[error] %v\n", err)
		return
	}
	data, err := wshclient.FileReadCommand(RpcClient, wshrpc.FileData{Info: &wshrpc.FileInfo{Path: fmt.Sprintf(wavefileutil.WaveFilePathPattern, fullORef.OID, args[0])}}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		WriteStderr("[error] reading file: %v\n", err)
		return
	}
	resp, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		WriteStderr("[error] decoding file: %v\n", err)
		return
	}
	WriteStdout("%s", string(resp))
}
