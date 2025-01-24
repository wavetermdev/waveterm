// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func init() {
	rootCmd.AddCommand(rcfilesCmd)
}

var rcfilesCmd = &cobra.Command{
	Use:    "rcfiles",
	Hidden: true,
	Short:  "Generate the rc files needed for various shells",
	Run: func(cmd *cobra.Command, args []string) {
		err := wshutil.InstallRcFiles()
		if err != nil {
			WriteStderr("%s\n", err.Error())
			return
		}
	},
}
