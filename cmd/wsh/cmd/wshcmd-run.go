// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var runMagnified bool

var runCmd = &cobra.Command{
	Use:              "run [flags] -- command [args...]",
	Short:            "run a command in a new block",
	RunE:             runRun,
	PreRunE:          preRunSetupRpcClient,
	TraverseChildren: true,
}

func init() {
	runCmd.Flags().BoolVarP(&runMagnified, "magnified", "m", false, "open view in magnified mode")
	rootCmd.AddCommand(runCmd)
}

func runRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("run", rtnErr == nil)
	}()

	// Find and remove the "--" if present
	cmdArgs := args
	for i, arg := range args {
		if arg == "--" {
			if i+1 >= len(args) {
				OutputHelpMessage(cmd)
				return fmt.Errorf("no command provided after --")
			}
			cmdArgs = args[i+1:]
			break
		}
	}

	if len(cmdArgs) == 0 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("no command provided")
	}

	// Get current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("getting current directory: %w", err)
	}
	cwd, err = filepath.Abs(cwd)
	if err != nil {
		return fmt.Errorf("getting absolute path: %w", err)
	}
	// Get current environment and convert to map
	envMap := make(map[string]string)
	for _, envStr := range os.Environ() {
		env := strings.SplitN(envStr, "=", 2)
		if len(env) == 2 {
			envMap[env[0]] = env[1]
		}
	}

	// Convert to null-terminated format
	envContent := envutil.MapToEnv(envMap)

	createBlockData := wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]interface{}{
				waveobj.MetaKey_View:       "term",
				waveobj.MetaKey_Cmd:        cmdArgs[0],
				waveobj.MetaKey_CmdArgs:    cmdArgs[1:],
				waveobj.MetaKey_CmdCwd:     cwd,
				waveobj.MetaKey_Controller: "cmd",
				waveobj.MetaKey_CmdShell:   false,
			},
			Files: map[string]*waveobj.FileDef{
				"env": {
					Content: envContent,
				},
			},
		},
		Magnified: runMagnified,
	}
	if RpcContext.Conn != "" {
		createBlockData.BlockDef.Meta[waveobj.MetaKey_Connection] = RpcContext.Conn
	}
	oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
	if err != nil {
		return fmt.Errorf("creating new run block: %w", err)
	}

	WriteStdout("run block created: %s\n", oref)
	return nil
}
