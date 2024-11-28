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

var runCmd = &cobra.Command{
	Use:              "run [flags] -- command [args...]",
	Short:            "run a command in a new block",
	RunE:             runRun,
	PreRunE:          preRunSetupRpcClient,
	TraverseChildren: true,
}

func init() {
	flags := runCmd.Flags()
	flags.BoolP("magnified", "m", false, "open view in magnified mode")
	flags.StringP("command", "c", "", "run command string in shell")
	flags.BoolP("exit", "x", false, "close block when command exits")
	flags.BoolP("paused", "p", false, "create block in paused state")
	flags.String("cwd", "", "set working directory for command")
	rootCmd.AddCommand(runCmd)
}

func runRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("run", rtnErr == nil)
	}()

	flags := cmd.Flags()
	magnified, _ := flags.GetBool("magnified")
	commandArg, _ := flags.GetString("command")
	exit, _ := flags.GetBool("exit")
	paused, _ := flags.GetBool("paused")
	cwd, _ := flags.GetString("cwd")
	var cmdArgs []string
	var useShell bool
	var shellCmd string

	for i, arg := range os.Args {
		if arg == "--" {
			if i+1 >= len(os.Args) {
				OutputHelpMessage(cmd)
				return fmt.Errorf("no command provided after --")
			}
			shellCmd = os.Args[i+1]
			cmdArgs = os.Args[i+2:]
			break
		}
	}
	if shellCmd != "" && commandArg != "" {
		OutputHelpMessage(cmd)
		return fmt.Errorf("cannot specify both -c and command arguments")
	}
	if shellCmd == "" && commandArg == "" {
		OutputHelpMessage(cmd)
		return fmt.Errorf("command must be specified after -- or with -c")
	}
	if commandArg != "" {
		shellCmd = commandArg
		useShell = true
	}

	// Get current working directory
	if cwd == "" {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			return fmt.Errorf("getting current directory: %w", err)
		}
	}
	cwd, err := filepath.Abs(cwd)
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
	createMeta := map[string]any{
		waveobj.MetaKey_View:       "term",
		waveobj.MetaKey_CmdCwd:     cwd,
		waveobj.MetaKey_Controller: "cmd",
	}
	createMeta[waveobj.MetaKey_Cmd] = shellCmd
	createMeta[waveobj.MetaKey_CmdArgs] = cmdArgs
	createMeta[waveobj.MetaKey_CmdShell] = useShell
	if paused {
		createMeta[waveobj.MetaKey_CmdRunOnStart] = false
	} else {
		createMeta[waveobj.MetaKey_CmdRunOnStart] = true
	}
	if exit {
		createMeta[waveobj.MetaKey_CmdCloseOnExit] = true
	}

	if RpcContext.Conn != "" {
		createMeta[waveobj.MetaKey_Connection] = RpcContext.Conn
	}

	createBlockData := wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: createMeta,
			Files: map[string]*waveobj.FileDef{
				"env": {
					Content: envContent,
				},
			},
		},
		Magnified: magnified,
	}

	oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
	if err != nil {
		return fmt.Errorf("creating new run block: %w", err)
	}

	WriteStdout("run block created: %s\n", oref)
	return nil
}
