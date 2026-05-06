// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var doneExitCode int
var doneTitle string
var doneMessage string

var doneCmd = &cobra.Command{
	Use:     "done [-t title] [-m message] [-e exitcode]",
	Short:   "Signal that a command has finished (triggers notification sound, highlight, and OS notification for background blocks)",
	Args:    cobra.MaximumNArgs(1),
	RunE:    doneRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	doneCmd.Flags().IntVarP(&doneExitCode, "exitcode", "e", 0, "exit code of the completed command")
	doneCmd.Flags().StringVarP(&doneTitle, "title", "t", "", "notification title (default: Command Finished)")
	doneCmd.Flags().StringVarP(&doneMessage, "message", "m", "", "notification message")
	rootCmd.AddCommand(doneCmd)
}

func doneRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("done", rtnErr == nil)
	}()
	blockId := os.Getenv("WAVETERM_BLOCKID")
	if blockId == "" {
		return fmt.Errorf("WAVETERM_BLOCKID not set, must be run inside a Wave terminal block")
	}

	if doneMessage == "" && len(args) > 0 {
		doneMessage = args[0]
	}

	err := wshclient.EventPublishCommand(RpcClient, wps.WaveEvent{
		Event:  "block:done",
		Scopes: []string{fmt.Sprintf("block:%s", blockId)},
		Data: map[string]any{
			"blockid":  blockId,
			"exitcode": doneExitCode,
			"title":    doneTitle,
			"message":  doneMessage,
		},
	}, &wshrpc.RpcOpts{NoResponse: true})
	if err != nil {
		return fmt.Errorf("done command: %w", err)
	}
	return nil
}
