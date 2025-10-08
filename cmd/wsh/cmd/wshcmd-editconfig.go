// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var editConfigCmd = &cobra.Command{
	Use:     "editconfig [configfile]",
	Short:   "edit Wave configuration files",
	Long:    "Edit Wave configuration files. Defaults to settings.json if no file specified. Common files: settings.json, presets.json, widgets.json",
	Args:    cobra.MaximumNArgs(1),
	RunE:    editConfigRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(editConfigCmd)
}

func editConfigRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("editconfig", rtnErr == nil)
	}()

	// Get config directory from Wave info
	resp, err := wshclient.WaveInfoCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting Wave info: %w", err)
	}

	configFile := "settings.json" // default
	if len(args) > 0 {
		configFile = args[0]
	}

	settingsFile := filepath.Join(resp.ConfigDir, configFile)

	wshCmd := &wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]interface{}{
				waveobj.MetaKey_View: "preview",
				waveobj.MetaKey_File: settingsFile,
				waveobj.MetaKey_Edit: true,
			},
		},
		Focused: true,
	}

	_, err = RpcClient.SendRpcRequest(wshrpc.Command_CreateBlock, wshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("opening config file: %w", err)
	}
	return nil
}
