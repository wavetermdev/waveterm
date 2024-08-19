// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

func init() {
	rootCmd.AddCommand(htmlCmd)
}

var htmlCmd = &cobra.Command{
	Use:     "html",
	Short:   "Launch a demo html-mode terminal",
	Run:     htmlRun,
	PreRunE: preRunSetupRpcClient,
}

func htmlRun(cmd *cobra.Command, args []string) {
	defer wshutil.DoShutdown("normal exit", 0, true)
	setTermHtmlMode()
	for {
		var buf [1]byte
		_, err := WrappedStdin.Read(buf[:])
		if err != nil {
			wshutil.DoShutdown(fmt.Sprintf("stdin closed/error (%v)", err), 1, true)
		}
		if buf[0] == 0x03 {
			wshutil.DoShutdown("read Ctrl-C from stdin", 1, true)
			break
		}
		if buf[0] == 'x' {
			wshutil.DoShutdown("read 'x' from stdin", 0, true)
			break
		}
	}
}
