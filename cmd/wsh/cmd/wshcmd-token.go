// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var tokenCmd = &cobra.Command{
	Use:     "token [tokne] [shell-type]",
	Short:   "exchange token for shell initialization script",
	RunE:    tokenCmdRun,
	PreRunE: preRunSetupRpcClient,
	Hidden:  true,
}

func init() {
	rootCmd.AddCommand(tokenCmd)
}

func tokenCmdRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("token", rtnErr == nil)
	}()
	if len(args) != 2 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("wsh token requires exactly 2 arguments, got %d", len(args))
	}
	token, shellType := args[0], args[1]
	entry, err := wshclient.TokenSwapCommand(RpcClient, token, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("error swapping token: %w", err)
	}
	if entry == nil {
		return fmt.Errorf("no token entry found")
	}
	scriptText, err := shellutil.EncodeTokenSwapEntryForShell(entry, shellType)
	if err != nil {
		return fmt.Errorf("error encoding token entry: %w", err)
	}
	WriteStdout("%s\n", scriptText)
	return nil
}
