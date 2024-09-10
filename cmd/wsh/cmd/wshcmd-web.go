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

var webOpenCmd = &cobra.Command{
	Use:   "open url",
	Short: "open a url a web widget",
	Args:  cobra.ExactArgs(1),
	RunE:  webOpenRun,
}

var webGetCmd = &cobra.Command{
	Use:    "get [--inner] [--all] css-selector",
	Short:  "get the html for a css selector",
	Args:   cobra.ExactArgs(1),
	Hidden: true,
	RunE:   webGetRun,
}

var webGetInner bool
var webGetAll bool
var webOpenMagnified bool

func init() {
	webOpenCmd.Flags().BoolVarP(&webOpenMagnified, "magnified", "m", false, "open view in magnified mode")
	webCmd.AddCommand(webOpenCmd)
	webGetCmd.Flags().BoolVarP(&webGetInner, "inner", "", false, "get inner html (instead of outer)")
	webGetCmd.Flags().BoolVarP(&webGetAll, "all", "", false, "get all matches (querySelectorAll)")
	webCmd.AddCommand(webGetCmd)
	rootCmd.AddCommand(webCmd)
}

func webGetRun(cmd *cobra.Command, args []string) error {
	return nil
}

func webOpenRun(cmd *cobra.Command, args []string) error {
	wshCmd := wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]any{
				waveobj.MetaKey_View: "web",
				waveobj.MetaKey_Url:  args[0],
			},
		},
		Magnified: webOpenMagnified,
	}
	oref, err := wshclient.CreateBlockCommand(RpcClient, wshCmd, nil)
	if err != nil {
		return fmt.Errorf("creating block: %w", err)
	}
	WriteStdout("created block %s\n", oref)
	return nil
}
