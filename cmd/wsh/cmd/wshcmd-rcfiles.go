// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

var WshBinDir = ".waveterm/bin"

func init() {
	rootCmd.AddCommand(rcfilesCmd)
}

var rcfilesCmd = &cobra.Command{
	Use:    "rcfiles",
	Hidden: true,
	Short:  "Generate the rc files needed for various shells",
	Run: func(cmd *cobra.Command, args []string) {
		home := wavebase.GetHomeDir()
		waveDir := filepath.Join(home, ".waveterm")
		winBinDir := filepath.Join(waveDir, "bin")
		err := shellutil.InitRcFiles(waveDir, winBinDir)
		if err != nil {
			WriteStderr(err.Error())
			return
		}
	},
}
