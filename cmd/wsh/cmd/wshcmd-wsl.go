// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var distroName string

var wslCmd = &cobra.Command{
	Use:     "wsl [-d <Distro>]",
	Short:   "connect this terminal to a local wsl connection",
	Args:    cobra.NoArgs,
	Run:     wslRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	wslCmd.Flags().StringVarP(&distroName, "distribution", "d", "", "Run the specified distribution")
	rootCmd.AddCommand(wslCmd)
}

func wslRun(cmd *cobra.Command, args []string) {
	var err error
	if distroName == "" {
		// get default distro from the host
		distroName, err = wshclient.WslDefaultDistroCommand(RpcClient, nil)
		if err != nil {
			WriteStderr("[error] %s\n", err)
			return
		}
	}
	if !strings.HasPrefix(distroName, "wsl://") {
		distroName = "wsl://" + distroName
	}
	blockId := RpcContext.BlockId
	if blockId == "" {
		WriteStderr("[error] cannot determine blockid (not in JWT)\n")
		return
	}
	data := wshrpc.CommandSetMetaData{
		ORef: waveobj.MakeORef(waveobj.OType_Block, blockId),
		Meta: map[string]any{
			waveobj.MetaKey_Connection: distroName,
		},
	}
	err = wshclient.SetMetaCommand(RpcClient, data, nil)
	if err != nil {
		WriteStderr("[error] setting switching connection: %v\n", err)
		return
	}
	WriteStderr("switched connection to %q\n", distroName)
}
