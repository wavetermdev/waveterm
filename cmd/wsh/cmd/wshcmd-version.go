// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func init() {
	rootCmd.AddCommand(versionCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the version number of wsh",
	Run: func(cmd *cobra.Command, args []string) {
		WriteStdout("wsh v%s\n", wavebase.WaveVersion)
	},
}
