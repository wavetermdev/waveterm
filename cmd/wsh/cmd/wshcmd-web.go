// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var webCmd = &cobra.Command{
	Use:               "web [open|get|set]",
	Short:             "web commands",
	PersistentPreRunE: preRunSetupRpcClient,
}

var webOpenCommand = &cobra.Command{
	Use:   "open url",
	Short: "open a url a web widget",
	Args:  cobra.ExactArgs(1),
	RunE:  webOpenRun,
}

func init() {
	webCmd.AddCommand(webOpenCommand)
	rootCmd.AddCommand(webCmd)
}

func webOpenRun(cmd *cobra.Command, args []string) error {
	wshCmd := wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]any{
				waveobj.MetaKey_View: "web",
				waveobj.MetaKey_Url:  args[0],
			},
		},
		Magnified: viewMagnified,
	}
	oref, err := wshclient.CreateBlockCommand(RpcClient, wshCmd, nil)
	if err != nil {
		return fmt.Errorf("creating block: %w", err)
	}
	WriteStdout("created block %s\n", oref)
	return nil
}
