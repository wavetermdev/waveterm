// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(htmlCmd)
}

var htmlCmd = &cobra.Command{
	Use:   "html",
	Short: "Launch a demo html-mode terminal",
	Run:   htmlRun,
}

func htmlRun(cmd *cobra.Command, args []string) {
	defer doShutdown("normal exit", 0)
	setTermHtmlMode()
	for {
		var buf [1]byte
		_, err := WrappedStdin.Read(buf[:])
		if err != nil {
			doShutdown(fmt.Sprintf("stdin closed/error (%v)", err), 1)
		}
		if buf[0] == 0x03 {
			doShutdown("read Ctrl-C from stdin", 1)
			break
		}
		if buf[0] == 'x' {
			doShutdown("read 'x' from stdin", 0)
			break
		}
	}
}
