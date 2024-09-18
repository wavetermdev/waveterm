// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var termMagnified bool

var termCmd = &cobra.Command{
	Use:     "term",
	Short:   "open a terminal in directory",
	Args:    cobra.RangeArgs(0, 1),
	Run:     termRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	termCmd.Flags().BoolVarP(&termMagnified, "magnified", "m", false, "open view in magnified mode")
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
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]interface{}{
				waveobj.MetaKey_View:       "term",
				waveobj.MetaKey_CmdCwd:     cwd,
				waveobj.MetaKey_Controller: "shell",
			},
		},
		Magnified: termMagnified,
	}
	if RpcContext.Conn != "" {
		createBlockData.BlockDef.Meta[waveobj.MetaKey_Connection] = RpcContext.Conn
	}
	oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
	if err != nil {
		WriteStderr("[error] creating new terminal block: %v\n", err)
		return
	}
	WriteStdout("terminal block created: %s\n", oref)
}
