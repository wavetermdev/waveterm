// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

var viewNewBlock bool

var viewCmd = &cobra.Command{
	Use:   "view",
	Short: "preview a file or directory",
	Args:  cobra.ExactArgs(1),
	Run:   viewRun,
}

func init() {
	viewCmd.Flags().BoolVarP(&viewNewBlock, "newblock", "n", false, "open view in a new block")
	rootCmd.AddCommand(viewCmd)
}

func viewRun(cmd *cobra.Command, args []string) {
	fileArg := args[0]
	absFile, err := filepath.Abs(fileArg)
	if err != nil {
		log.Printf("error getting absolute path: %v\n", err)
		return
	}
	_, err = os.Stat(absFile)
	if err == fs.ErrNotExist {
		log.Printf("file does not exist: %q\n", absFile)
		return
	}
	if err != nil {
		log.Printf("error getting file info: %v\n", err)
	}
	setTermRawMode()
	viewWshCmd := &wshrpc.CommandCreateBlockData{
		BlockDef: &wstore.BlockDef{
			View: "preview",
			Meta: map[string]interface{}{
				"file": absFile,
			},
		},
	}
	_, err = RpcClient.SendRpcRequest(wshrpc.Command_CreateBlock, viewWshCmd, 2000)
	if err != nil {
		log.Printf("error running view command: %v\r\n", err)
		return
	}
}
