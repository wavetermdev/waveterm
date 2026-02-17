// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var termScrollbackCmd = &cobra.Command{
	Use:   "termscrollback",
	Short: "Get terminal scrollback from a terminal block",
	Long: `Get the terminal scrollback from a terminal block.

By default, retrieves all lines. You can specify line ranges or get the 
output of the last command using the --lastcommand flag.`,
	RunE:                  termScrollbackRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	termScrollbackLineStart  int
	termScrollbackLineEnd    int
	termScrollbackLastCmd    bool
	termScrollbackOutputFile string
)

func init() {
	rootCmd.AddCommand(termScrollbackCmd)

	termScrollbackCmd.Flags().IntVar(&termScrollbackLineStart, "start", 0, "starting line number (0 = beginning)")
	termScrollbackCmd.Flags().IntVar(&termScrollbackLineEnd, "end", 0, "ending line number (0 = all lines)")
	termScrollbackCmd.Flags().BoolVar(&termScrollbackLastCmd, "lastcommand", false, "get output of last command (requires shell integration)")
	termScrollbackCmd.Flags().StringVarP(&termScrollbackOutputFile, "output", "o", "", "write output to file instead of stdout")
}

func termScrollbackRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("termscrollback", rtnErr == nil)
	}()

	// Resolve the block argument
	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}

	// Get block metadata to verify it's a terminal block
	metaData, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{
		ORef: *fullORef,
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("error getting block metadata: %w", err)
	}

	// Check if the block is a terminal block
	viewType, ok := metaData[waveobj.MetaKey_View].(string)
	if !ok || viewType != "term" {
		return fmt.Errorf("block %s is not a terminal block (view type: %s)", fullORef.OID, viewType)
	}

	// Make the RPC call to get scrollback
	scrollbackData := wshrpc.CommandTermGetScrollbackLinesData{
		LineStart:   termScrollbackLineStart,
		LineEnd:     termScrollbackLineEnd,
		LastCommand: termScrollbackLastCmd,
	}

	result, err := wshclient.TermGetScrollbackLinesCommand(RpcClient, scrollbackData, &wshrpc.RpcOpts{
		Route:   fullORef.String(),
		Timeout: 5000,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "error getting terminal scrollback: %v\n", err)
		return err
	}

	// Format the output
	output := strings.Join(result.Lines, "\n")
	if len(result.Lines) > 0 {
		output += "\n" // Add final newline
	}

	// Write to file or stdout
	if termScrollbackOutputFile != "" {
		err = os.WriteFile(termScrollbackOutputFile, []byte(output), 0644)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error writing to file %s: %v\n", termScrollbackOutputFile, err)
			return err
		}
		fmt.Printf("terminal scrollback written to %s (%d lines)\n", termScrollbackOutputFile, len(result.Lines))
	} else {
		fmt.Print(output)
	}

	return nil
}
