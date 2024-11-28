// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"io/fs"
	"sort"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
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
	fileData := wshrpc.CommandFileData{
		ZoneId:   zoneId,
		FileName: getVarFileName,
	}

	envStr64, err := wshclient.FileReadCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading variables: %w", err)
	}
	envBytes, err := base64.StdEncoding.DecodeString(envStr64)
	if err != nil {
		return fmt.Errorf("decoding variables: %w", err)
	}

	envMap := envutil.EnvToMap(string(envBytes))

	terminator := "\n"
	if getVarNullTerminate {
		terminator = "\x00"
	}

	// Sort keys for consistent output
	keys := make([]string, 0, len(envMap))
	for k := range envMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		WriteStdout("%s=%s%s", k, envMap[k], terminator)
	}

	return nil
}
