// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
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
	flags.BoolP("exit", "x", false, "close block if command exits successfully (will stay open if there was an error)")
	flags.BoolP("forceexit", "X", false, "close block when command exits, regardless of exit status")
	flags.IntP("delay", "", 2000, "if -x, delay in milliseconds before closing block")
	flags.BoolP("paused", "p", false, "create block in paused state")
	flags.String("cwd", "", "set working directory for command")
	flags.BoolP("append", "a", false, "append output on restart instead of clearing")
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
	forceExit, _ := flags.GetBool("forceexit")
	paused, _ := flags.GetBool("paused")
	cwd, _ := flags.GetString("cwd")
	delayMs, _ := flags.GetInt("delay")
	appendOutput, _ := flags.GetBool("append")
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
		waveobj.MetaKey_View:            "term",
		waveobj.MetaKey_CmdCwd:          cwd,
		waveobj.MetaKey_Controller:      "cmd",
		waveobj.MetaKey_CmdClearOnStart: true,
	}
	createMeta[waveobj.MetaKey_Cmd] = shellCmd
	createMeta[waveobj.MetaKey_CmdArgs] = cmdArgs
	createMeta[waveobj.MetaKey_CmdShell] = useShell
	if paused {
		createMeta[waveobj.MetaKey_CmdRunOnStart] = false
	} else {
		createMeta[waveobj.MetaKey_CmdRunOnce] = true
		createMeta[waveobj.MetaKey_CmdRunOnStart] = true
	}
	if forceExit {
		createMeta[waveobj.MetaKey_CmdCloseOnExitForce] = true
	} else if exit {
		createMeta[waveobj.MetaKey_CmdCloseOnExit] = true
	}
	createMeta[waveobj.MetaKey_CmdCloseOnExitDelay] = float64(delayMs)
	if appendOutput {
		createMeta[waveobj.MetaKey_CmdClearOnStart] = false
	}

	if RpcContext.Conn != "" {
		createMeta[waveobj.MetaKey_Connection] = RpcContext.Conn
	}

	createBlockData := wshrpc.CommandCreateBlockData{
		BlockDef: &waveobj.BlockDef{
			Meta: createMeta,
			Files: map[string]*waveobj.FileDef{
				wavebase.BlockFile_Env: {
					Content: envContent,
				},
			},
		},
		Magnified: magnified,
		Focused:   true,
	}

	oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
	if err != nil {
		return fmt.Errorf("creating new run block: %w", err)
	}

	WriteStdout("run block created: %s\n", oref)
	return nil
}
