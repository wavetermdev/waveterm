// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var focusBlockCmd = &cobra.Command{
	Use:     "focusblock [-b {blockid|blocknum|this}]",
	Short:   "focus a block in the current tab",
	Args:    cobra.NoArgs,
	RunE:    focusBlockRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(focusBlockCmd)
}

func focusBlockRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("focusblock", rtnErr == nil)
	}()

	tabId := os.Getenv("WAVETERM_TABID")
	if tabId == "" {
		return fmt.Errorf("no tab id specified (set WAVETERM_TABID environment variable)")
	}

	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}

	route := fmt.Sprintf("tab:%s", tabId)
	err = wshclient.SetBlockFocusCommand(RpcClient, fullORef.OID, &wshrpc.RpcOpts{
		Route:   route,
		Timeout: 2000,
	})
	if err != nil {
		return fmt.Errorf("focusing block: %v", err)
	}
	return nil
}
