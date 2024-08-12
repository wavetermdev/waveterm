// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

var termCmd = &cobra.Command{
	Use:   "term",
	Short: "open a terminal in directory",
	Args:  cobra.RangeArgs(0, 1),
	Run:   termRun,
}

func init() {
	rootCmd.AddCommand(termCmd)
}

func termRun(cmd *cobra.Command, args []string) {
	var cwd string
	if len(args) > 0 {
		cwd = args[0]
		cwd = wavebase.ExpandHomeDir(cwd)
	} else {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			WriteStderr("[error] getting current directory: %v\n", err)
			return
		}
	}
	var err error
	cwd, err = filepath.Abs(cwd)
	if err != nil {
		WriteStderr("[error] getting absolute path: %v\n", err)
		return
	}
	createBlockData := wshrpc.CommandCreateBlockData{
		BlockDef: &wstore.BlockDef{
			Meta: map[string]interface{}{
				wstore.MetaKey_View:       "term",
				wstore.MetaKey_CmdCwd:     cwd,
				wstore.MetaKey_Controller: "shell",
			},
		},
	}
	oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
	if err != nil {
		WriteStderr("[error] creating new terminal block: %v\n", err)
		return
	}
	WriteStdout("terminal block created: %s\n", oref)
}
