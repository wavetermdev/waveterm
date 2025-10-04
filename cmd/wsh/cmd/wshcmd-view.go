// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var viewMagnified bool

var viewCmd = &cobra.Command{
	Use:     "view {file|directory|URL}",
	Aliases: []string{"preview", "open"},
	Short:   "preview/edit a file or directory",
	RunE:    viewRun,
	PreRunE: preRunSetupRpcClient,
}

var editCmd = &cobra.Command{
	Use:     "edit {file}",
	Short:   "edit a file",
	RunE:    viewRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	viewCmd.Flags().BoolVarP(&viewMagnified, "magnified", "m", false, "open view in magnified mode")
	rootCmd.AddCommand(viewCmd)
	editCmd.Flags().BoolVarP(&viewMagnified, "magnified", "m", false, "open view in magnified mode")
	rootCmd.AddCommand(editCmd)
}

func viewRun(cmd *cobra.Command, args []string) (rtnErr error) {
	cmdName := cmd.Name()
	defer func() {
		sendActivity(cmdName, rtnErr == nil)
	}()
	if len(args) == 0 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("no arguments.  wsh %s requires a file or URL as an argument argument", cmdName)
	}
	if len(args) > 1 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("too many arguments.  wsh %s requires exactly one argument", cmdName)
	}
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
			Focused:   true,
		}
	} else {
		absFile, err := filepath.Abs(fileArg)
		if err != nil {
			return fmt.Errorf("getting absolute path: %w", err)
		}
		absParent, err := filepath.Abs(filepath.Dir(fileArg))
		if err != nil {
			return fmt.Errorf("getting absolute path of parent dir: %w", err)
		}
		_, err = os.Stat(absParent)
		if err == fs.ErrNotExist {
			return fmt.Errorf("parent directory does not exist: %q", absParent)
		}
		if err != nil {
			return fmt.Errorf("getting file info: %w", err)
		}
		wshCmd = &wshrpc.CommandCreateBlockData{
			BlockDef: &waveobj.BlockDef{
				Meta: map[string]interface{}{
					waveobj.MetaKey_View: "preview",
					waveobj.MetaKey_File: absFile,
				},
			},
			Magnified: viewMagnified,
			Focused:   true,
		}
		if cmdName == "edit" {
			wshCmd.BlockDef.Meta[waveobj.MetaKey_Edit] = true
		}
		if conn != "" {
			wshCmd.BlockDef.Meta[waveobj.MetaKey_Connection] = conn
		}
	}
	_, err := RpcClient.SendRpcRequest(wshrpc.Command_CreateBlock, wshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("running view command: %w", err)
	}
	return nil
}
