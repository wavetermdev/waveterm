// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var getVarCmd = &cobra.Command{
	Use:   "getvar [flags] [key]",
	Short: "get variable(s) from a block",
	Long: `Get variable(s) from a block. Without --all, requires a key argument.
With --all, prints all variables. Use -0 for null-terminated output.`,
	Example: "  wsh getvar FOO\n  wsh getvar --all\n  wsh getvar --all -0",
	RunE:    getVarRun,
	PreRunE: preRunSetupRpcClient,
}

var (
	getVarFileName      string
	getVarAllVars       bool
	getVarNullTerminate bool
	getVarLocal         bool
	getVarFlagNL        bool
	getVarFlagNoNL      bool
)

func init() {
	rootCmd.AddCommand(getVarCmd)
	getVarCmd.Flags().StringVar(&getVarFileName, "varfile", DefaultVarFileName, "var file name")
	getVarCmd.Flags().BoolVar(&getVarAllVars, "all", false, "get all variables")
	getVarCmd.Flags().BoolVarP(&getVarNullTerminate, "null", "0", false, "use null terminators in output")
	getVarCmd.Flags().BoolVarP(&getVarLocal, "local", "l", false, "get variables local to block")
	getVarCmd.Flags().BoolVarP(&getVarFlagNL, "newline", "n", false, "print newline after output")
	getVarCmd.Flags().BoolVarP(&getVarFlagNoNL, "no-newline", "N", false, "do not print newline after output")
}

func shouldPrintNewline() bool {
	isTty := getIsTty()
	if getVarFlagNL {
		return true
	}
	if getVarFlagNoNL {
		return false
	}
	return isTty
}

func getVarRun(cmd *cobra.Command, args []string) error {
	defer func() {
		sendActivity("getvar", WshExitCode == 0)
	}()

	// Resolve block to get zoneId
	if blockArg == "" {
		if getVarLocal {
			blockArg = "this"
		} else {
			blockArg = "client"
		}
	}
	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}

	if getVarAllVars {
		if len(args) > 0 {
			return fmt.Errorf("cannot specify key with --all")
		}
		return getAllVariables(fullORef.OID)
	}

	// Single variable case - existing logic
	if len(args) != 1 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("requires a key argument")
	}

	key := args[0]
	commandData := wshrpc.CommandVarData{
		Key:      key,
		ZoneId:   fullORef.OID,
		FileName: getVarFileName,
	}

	resp, err := wshclient.GetVarCommand(RpcClient, commandData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting variable: %w", err)
	}

	if !resp.Exists {
		WshExitCode = 1
		return nil
	}

	WriteStdout("%s", resp.Val)
	if shouldPrintNewline() {
		WriteStdout("\n")
	}

	return nil
}

func getAllVariables(zoneId string) error {
	commandData := wshrpc.CommandVarData{
		ZoneId:   zoneId,
		FileName: getVarFileName,
	}

	vars, err := wshclient.GetAllVarsCommand(RpcClient, commandData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting variables: %w", err)
	}

	terminator := "\n"
	if getVarNullTerminate {
		terminator = "\x00"
	}

	for _, v := range vars {
		WriteStdout("%s=%s%s", v.Key, v.Val, terminator)
	}

	return nil
}
