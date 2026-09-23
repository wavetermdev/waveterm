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
	flags.Bool("wait", false, "wait for the command to complete and print its output/exit code")
	flags.Bool("json", false, "with --wait, print machine-readable JSON (stdout, stderr, exitcode, durationms, blockid, outputmerged). A PTY merges stdout and stderr, so stderr is always empty and outputmerged is true")
	flags.String("connection", "", "run the command on the specified connection (overrides the session default connection)")
	flags.Bool("focus", false, "focus the new block (default: do not steal focus)")
	flags.Bool("keep-block", false, "with --wait, leave the block open after the command exits")
	flags.String("timeout", "", "with --wait, max time to wait (default 5m; e.g. 30s, 5m)")
	rootCmd.AddCommand(runCmd)
}

func runRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
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
	waitForExit, _ := flags.GetBool("wait")
	jsonOut, _ := flags.GetBool("json")
	connection, _ := flags.GetString("connection")
	focus, _ := flags.GetBool("focus")
	keepBlock, _ := flags.GetBool("keep-block")
	timeoutStr, _ := flags.GetString("timeout")
	if jsonOut && !waitForExit {
		OutputHelpMessage(cmd)
		return fmt.Errorf("--json requires --wait")
	}
	timeout, err := parseDurationFlag(timeoutStr, runWaitDefaultTimeout)
	if err != nil {
		return fmt.Errorf("parsing --timeout: %w", err)
	}
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
	if waitForExit && !keepBlock {
		createMeta[waveobj.MetaKey_CmdCloseOnExitForce] = true
		// close-on-exit races with reading the term file (2s settle). Keep a
		// delay long enough that waitForRunBlock can finish the read; the CLI
		// then deletes the block itself.
		if delayMs < 5000 {
			delayMs = 5000
		}
	} else if forceExit {
		createMeta[waveobj.MetaKey_CmdCloseOnExitForce] = true
	} else if exit {
		createMeta[waveobj.MetaKey_CmdCloseOnExit] = true
	}
	createMeta[waveobj.MetaKey_CmdCloseOnExitDelay] = float64(delayMs)
	if appendOutput {
		createMeta[waveobj.MetaKey_CmdClearOnStart] = false
	}

	connName := connection
	if connName == "" {
		connName = RpcContext.Conn
	}
	if connName != "" {
		createMeta[waveobj.MetaKey_Connection] = connName
	}

	tabId := getTabIdFromEnv()
	if tabId == "" {
		return fmt.Errorf("no WAVETERM_TABID env var set")
	}

	createBlockData := wshrpc.CommandCreateBlockData{
		TabId: tabId,
		BlockDef: &waveobj.BlockDef{
			Meta: createMeta,
			Files: map[string]*waveobj.FileDef{
				wavebase.BlockFile_Env: {
					Content: envContent,
				},
			},
		},
		Magnified: magnified,
		Focused:   focus,
	}

	oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
	if err != nil {
		return fmt.Errorf("creating new run block: %w", err)
	}

	if !waitForExit {
		WriteStdout("run block created: %s\n", oref)
		return nil
	}

	if err := waitForRunBlock(oref.OID, connName, jsonOut, timeout); err != nil {
		return err
	}
	if !keepBlock {
		_ = wshclient.DeleteBlockCommand(RpcClient, wshrpc.CommandDeleteBlockData{BlockId: oref.OID}, &wshrpc.RpcOpts{Timeout: 2000})
	}
	return nil
}
