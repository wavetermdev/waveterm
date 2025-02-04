// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
)

var testCmd = &cobra.Command{
	Use:     "test",
	Hidden:  true,
	Short:   "test command",
	PreRunE: preRunSetupRpcClient,
	RunE:    runTestCmd,
}

func init() {
	rootCmd.AddCommand(testCmd)
}

func runTestCmd(cmd *cobra.Command, args []string) error {
	return nil
}
