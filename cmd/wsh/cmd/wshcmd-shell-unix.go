//go:build !windows

// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"os"
	"os/user"
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
	user, err := user.Current()
	if err != nil {
		return "/bin/bash\n"
	}

	passwd, err := os.Open("/etc/passwd")
	if err != nil {
		return "/bin/bash\n"
	}

	scanner := bufio.NewScanner(passwd)
	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		parts := strings.Split(line, ":")

		if len(parts) != 7 {
			continue
		}

		if parts[0] == user.Username {
			return parts[6] + "\n"
		}
	}
	// none found
	return "/bin/bash\n"
}
