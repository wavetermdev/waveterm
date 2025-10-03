// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var createBlockMagnified bool

var createBlockCmd = &cobra.Command{
	Use:     "createblock viewname key=value ...",
	Short:   "create a new block",
	Args:    cobra.MinimumNArgs(1),
	RunE:    createBlockRun,
	PreRunE: preRunSetupRpcClient,
	Hidden:  true,
}

func init() {
	createBlockCmd.Flags().BoolVarP(&createBlockMagnified, "magnified", "m", false, "create block in magnified mode")
	rootCmd.AddCommand(createBlockCmd)
}

func createBlockRun(cmd *cobra.Command, args []string) error {
	viewName := args[0]
	var metaSetStrs []string
	if len(args) > 1 {
		metaSetStrs = args[1:]
	}
	meta, err := parseMetaSets(metaSetStrs)
	if err != nil {
		return err
	}
	meta["view"] = viewName
	data := wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: meta,
		},
		Magnified: createBlockMagnified,
		Focused:   true,
	}
	oref, err := wshclient.CreateBlockCommand(RpcClient, data, nil)
	if err != nil {
		return fmt.Errorf("create block failed: %v", err)
	}
	fmt.Printf("created block %s\n", oref.OID)
	return nil
}
