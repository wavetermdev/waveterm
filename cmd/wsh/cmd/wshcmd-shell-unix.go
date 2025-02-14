//go:build !windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

func init() {
	rootCmd.AddCommand(shellCmd)
}

var shellCmd = &cobra.Command{
	Use:    "shell",
	Hidden: true,
	Short:  "Print the login shell of this user",
	Run: func(cmd *cobra.Command, args []string) {
		WriteStdout("%s", shellCmdInner())
	},
}

func shellCmdInner() string {
	if runtime.GOOS == "darwin" {
		return shellutil.GetMacUserShell() + "\n"
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		return "/bin/bash\n"
	}
	return strings.TrimSpace(shell) + "\n"
}
