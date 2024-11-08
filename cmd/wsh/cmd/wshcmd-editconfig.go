// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var editConfigCmd = &cobra.Command{
	Use:     "editconfig",
	Short:   "edit Wave settings",
	Args:    cobra.NoArgs,
	Run:     editConfigRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(editConfigCmd)
}

func editConfigRun(cmd *cobra.Command, args []string) {
	// Get config directory from Wave info
	resp, err := wshclient.WaveInfoCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] getting Wave info: %v\n", err)
		return
	}

	settingsFile := filepath.Join(resp.ConfigDir, "settings.json")

	wshCmd := &wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]interface{}{
				waveobj.MetaKey_View: "preview",
				waveobj.MetaKey_File: settingsFile,
				waveobj.MetaKey_Edit: true,
			},
		},
	}

	_, err = RpcClient.SendRpcRequest(wshrpc.Command_CreateBlock, wshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] opening settings file: %v\n", err)
		return
	}
}
