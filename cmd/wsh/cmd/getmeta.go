// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

var getMetaCmd = &cobra.Command{
	Use:   "getmeta",
	Short: "get metadata for an entity",
	Args:  cobra.ExactArgs(1),
	Run:   getMetaRun,
}

func init() {
	rootCmd.AddCommand(getMetaCmd)
}

func getMetaRun(cmd *cobra.Command, args []string) {
	oref := args[0]
	if oref == "" {
		fmt.Println("oref is required")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		fmt.Printf("%v\n", err)
		return
	}
	getMetaWshCmd := &wshutil.BlockGetMetaCommand{
		Command: wshutil.BlockCommand_SetMeta,
		OID:     oref,
	}
	barr, _ := wshutil.EncodeWaveOSCMessage(getMetaWshCmd)
	os.Stdout.Write(barr)
}
