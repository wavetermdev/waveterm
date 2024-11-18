// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const DefaultVarFileName = "var"

var setVarCmd = &cobra.Command{
	Use:   "setvar [flags] KEY=VALUE...",
	Short: "set variable(s) for a block",
	Long: `Set one or more variables for a block. 
Use --remove/-r to remove variables instead of setting them.
When setting, each argument must be in KEY=VALUE format.
When removing, each argument is treated as a key to remove.`,
	Example: "  wsh setvar FOO=bar BAZ=123\n  wsh setvar -r FOO BAZ",
	Args:    cobra.MinimumNArgs(1),
	RunE:    setVarRun,
	PreRunE: preRunSetupRpcClient,
}

var (
	setVarFileName  string
	setVarRemoveVar bool
	setVarLocal     bool
)

func init() {
	rootCmd.AddCommand(setVarCmd)
	setVarCmd.Flags().StringVar(&setVarFileName, "varfile", DefaultVarFileName, "var file name")
	setVarCmd.Flags().BoolVarP(&setVarLocal, "local", "l", false, "set variables local to block")
	setVarCmd.Flags().BoolVarP(&setVarRemoveVar, "remove", "r", false, "remove the variable(s) instead of setting")
}

func parseKeyValue(arg string) (key, value string, err error) {
	if setVarRemoveVar {
		return arg, "", nil
	}

	parts := strings.SplitN(arg, "=", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid KEY=VALUE format %q (= sign required)", arg)
	}
	key = parts[0]
	if key == "" {
		return "", "", fmt.Errorf("empty key not allowed")
	}
	return key, parts[1], nil
}

func setVarRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("setvar", rtnErr == nil)
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

	// Process all variables
	for _, arg := range args {
		key, value, err := parseKeyValue(arg)
		if err != nil {
			return err
		}

		commandData := wshrpc.CommandVarData{
			Key:      key,
			ZoneId:   fullORef.OID,
			FileName: setVarFileName,
			Remove:   setVarRemoveVar,
		}

		if !setVarRemoveVar {
			commandData.Val = value
		}

		err = wshclient.SetVarCommand(RpcClient, commandData, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("setting variable %s: %w", key, err)
		}
	}
	return nil
}
