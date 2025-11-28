// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var editConfigMagnified bool

var editConfigCmd = &cobra.Command{
	Use:     "editconfig [configfile]",
	Short:   "edit Wave configuration files",
	Long:    "Edit Wave configuration files. Defaults to settings.json if no file specified. Common files: settings.json, presets.json, widgets.json",
	Args:    cobra.MaximumNArgs(1),
	RunE:    editConfigRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	editConfigCmd.Flags().BoolVarP(&editConfigMagnified, "magnified", "m", false, "open config in magnified mode")
	rootCmd.AddCommand(editConfigCmd)
}

func editConfigRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("editconfig", rtnErr == nil)
	}()

	configFile := "settings.json" // default
	if len(args) > 0 {
		configFile = args[0]
	}

	wshCmd := &wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]interface{}{
				waveobj.MetaKey_View: "waveconfig",
				waveobj.MetaKey_File: configFile,
			},
		},
		Magnified: editConfigMagnified,
		Focused:   true,
	}

	_, err := RpcClient.SendRpcRequest(wshrpc.Command_CreateBlock, wshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("opening config file: %w", err)
	}
	return nil
}
