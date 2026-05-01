// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveattach"
)

var attachCmd = &cobra.Command{
	Use:                   "attach [blockid]",
	Short:                 "attach to a Wave Terminal block from an external terminal",
	Long:                  "Attach to a running term block in Wave Terminal. Press Ctrl+A D to detach.",
	Args:                  cobra.MaximumNArgs(1),
	RunE:                  attachRun,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(attachCmd)
}

func attachRun(cmd *cobra.Command, args []string) error {
	rpcClient, _, err := waveattach.Connect()
	if err != nil {
		return err
	}

	var blockId string
	if len(args) == 1 {
		blockId = args[0]
	} else {
		blockId, err = waveattach.SelectBlock(rpcClient)
		if err != nil {
			return err
		}
	}

	return waveattach.Attach(rpcClient, blockId)
}
