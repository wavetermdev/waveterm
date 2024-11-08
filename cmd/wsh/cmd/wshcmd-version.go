// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var versionVerbose bool
var versionJSON bool

// versionCmd represents the version command
var versionCmd = &cobra.Command{
	Use:   "version [-v] [--json]",
	Short: "Print the version number of wsh",
	RunE:  runVersionCmd,
}

func init() {
	versionCmd.Flags().BoolVarP(&versionVerbose, "verbose", "v", false, "Display full version information")
	versionCmd.Flags().BoolVar(&versionJSON, "json", false, "Output version information in JSON format")
	rootCmd.AddCommand(versionCmd)
}

func runVersionCmd(cmd *cobra.Command, args []string) error {
	if !versionVerbose && !versionJSON {
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

	if versionJSON {
		info := map[string]interface{}{
			"version":       resp.Version,
			"buildtime":     resp.BuildTime,
			"configdir":     resp.ConfigDir,
			"datadir":       resp.DataDir,
			"updatechannel": updateChannel,
		}
		outBArr, err := json.MarshalIndent(info, "", "  ")
		if err != nil {
			return fmt.Errorf("formatting version info: %v", err)
		}
		WriteStdout("%s\n", string(outBArr))
		return nil
	}

	// Default verbose text output
	fmt.Printf("v%s (%s)\n", resp.Version, resp.BuildTime)
	fmt.Printf("configdir: %s\n", resp.ConfigDir)
	fmt.Printf("datadir:   %s\n", resp.DataDir)
	fmt.Printf("update-channel: %s\n", updateChannel)
	return nil
}
