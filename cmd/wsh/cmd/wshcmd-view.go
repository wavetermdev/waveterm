// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
)

var viewNewBlock bool
var viewMagnified bool

var viewCmd = &cobra.Command{
	Use:     "view",
	Short:   "preview a file or directory",
	Args:    cobra.ExactArgs(1),
	Run:     viewRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	viewCmd.Flags().BoolVarP(&viewNewBlock, "newblock", "n", false, "open view in a new block")
	viewCmd.Flags().BoolVarP(&viewMagnified, "magnified", "m", false, "open view in magnified mode")
	rootCmd.AddCommand(viewCmd)
}

func viewRun(cmd *cobra.Command, args []string) {
	fileArg := args[0]
	conn := RpcContext.Conn
	var wshCmd *wshrpc.CommandCreateBlockData
	if strings.HasPrefix(fileArg, "http://") || strings.HasPrefix(fileArg, "https://") {
		wshCmd = &wshrpc.CommandCreateBlockData{
			BlockDef: &waveobj.BlockDef{
				Meta: map[string]any{
					waveobj.MetaKey_View: "web",
					waveobj.MetaKey_Url:  fileArg,
				},
			},
			Magnified: viewMagnified,
		}
	} else {
		absFile, err := filepath.Abs(fileArg)
		if err != nil {
			WriteStderr("[error] getting absolute path: %v\n", err)
			return
		}
		_, err = os.Stat(absFile)
		if err == fs.ErrNotExist {
			WriteStderr("[error] file does not exist: %q\n", absFile)
			return
		}
		if err != nil {
			WriteStderr("[error] getting file info: %v\n", err)
			return
		}
		wshCmd = &wshrpc.CommandCreateBlockData{
			BlockDef: &waveobj.BlockDef{
				Meta: map[string]interface{}{
					waveobj.MetaKey_View: "preview",
					waveobj.MetaKey_File: absFile,
				},
			},
			Magnified: viewMagnified,
		}
		if conn != "" {
			wshCmd.BlockDef.Meta[waveobj.MetaKey_Connection] = conn
		}
	}
	_, err := RpcClient.SendRpcRequest(wshrpc.Command_CreateBlock, wshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] running view command: %v\r\n", err)
		return
	}
}
