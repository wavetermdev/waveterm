// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var versionVerbose bool

// versionCmd represents the version command
var versionCmd = &cobra.Command{
	Use:   "version [-v]",
	Short: "Print the version number of wsh",
	RunE:  runVersionCmd,
}

func init() {
	versionCmd.Flags().BoolVarP(&versionVerbose, "verbose", "v", false, "Display full version information")
	rootCmd.AddCommand(versionCmd)
}

func runVersionCmd(cmd *cobra.Command, args []string) error {
	if !versionVerbose {
		WriteStdout("wsh v%s\n", wavebase.WaveVersion)
		return nil
	}
	err := preRunSetupRpcClient(cmd, args)
	if err != nil {
		return err
	}
	resp, err := wshclient.WaveInfoCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return err
	}
	updateChannel, err := wshclient.GetUpdateChannelCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000, Route: wshutil.ElectronRoute})
	if err != nil {
		return err
	}
	fmt.Printf("v%s (%s)\n", resp.Version, resp.BuildTime)
	fmt.Printf("configdir: %s\n", resp.ConfigDir)
	fmt.Printf("datadir:   %s\n", resp.DataDir)
	fmt.Printf("update-channel: %s\n", updateChannel)
	return nil
}
