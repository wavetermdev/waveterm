// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

func init() {
	rootCmd.AddCommand(versionCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the version number of wsh",
	Run: func(cmd *cobra.Command, args []string) {
		WriteStdout(fmt.Sprintf("wsh v%s\n", wavebase.WaveVersion))
	},
}
