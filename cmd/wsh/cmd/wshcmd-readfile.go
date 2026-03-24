// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var readFileCmd = &cobra.Command{
	Use:     "readfile [filename]",
	Short:   "read a blockfile",
	Args:    cobra.ExactArgs(1),
	Run:     runReadFile,
	PreRunE: preRunSetupRpcClient,
	Hidden:  true,
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

	broker := RpcClient.StreamBroker
	if broker == nil {
		WriteStderr("[error] stream broker not available\n")
		return
	}

	readerRouteId, err := wshclient.ControlGetRouteIdCommand(RpcClient, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		WriteStderr("[error] getting route id: %v\n", err)
		return
	}
	if readerRouteId == "" {
		WriteStderr("[error] no route to receive data\n")
		return
	}
	writerRouteId := ""
	reader, streamMeta := broker.CreateStreamReader(readerRouteId, writerRouteId, 64*1024)
	defer reader.Close()

	data := wshrpc.CommandWaveFileReadStreamData{
		ZoneId:     fullORef.OID,
		Name:       args[0],
		StreamMeta: *streamMeta,
	}

	_, err = wshclient.WaveFileReadStreamCommand(RpcClient, data, nil)
	if err != nil {
		WriteStderr("[error] starting stream read: %v\n", err)
		return
	}

	_, err = io.Copy(os.Stdout, reader)
	if err != nil {
		WriteStderr("[error] reading stream: %v\n", err)
		return
	}
}
