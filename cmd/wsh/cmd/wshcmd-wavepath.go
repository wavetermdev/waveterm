// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var wavepathCmd = &cobra.Command{
	Use:     "wavepath {config|data|log}",
	Short:   "Get paths to various waveterm files and directories",
	RunE:    wavepathRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	wavepathCmd.Flags().BoolP("open", "o", false, "Open the path in a new block")
	wavepathCmd.Flags().BoolP("open-external", "O", false, "Open the path in the default external application")
	wavepathCmd.Flags().BoolP("tail", "t", false, "Tail the last 100 lines of the log")
	rootCmd.AddCommand(wavepathCmd)
}

func wavepathRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("wavepath", rtnErr == nil)
	}()

	if len(args) == 0 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("no arguments. wsh wavepath requires a type argument (config, data, or log)")
	}
	if len(args) > 1 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("too many arguments. wsh wavepath requires exactly one argument")
	}

	pathType := args[0]
	if pathType != "config" && pathType != "data" && pathType != "log" {
		OutputHelpMessage(cmd)
		return fmt.Errorf("invalid path type %q. must be one of: config, data, log", pathType)
	}

	tail, _ := cmd.Flags().GetBool("tail")
	if tail && pathType != "log" {
		return fmt.Errorf("--tail can only be used with the log path type")
	}

	open, _ := cmd.Flags().GetBool("open")
	openExternal, _ := cmd.Flags().GetBool("open-external")

	tabId := getTabIdFromEnv()
	if tabId == "" {
		return fmt.Errorf("no WAVETERM_TABID env var set")
	}

	path, err := wshclient.PathCommand(RpcClient, wshrpc.PathCommandData{
		PathType:     pathType,
		Open:         open,
		OpenExternal: openExternal,
		TabId:        tabId,
	}, nil)
	if err != nil {
		return fmt.Errorf("getting path: %w", err)
	}

	if tail && pathType == "log" {
		err = tailLogFile(path)
		if err != nil {
			return fmt.Errorf("tailing log file: %w", err)
		}
		return nil
	}

	WriteStdout("%s\n", path)
	return nil
}

func tailLogFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("opening log file: %w", err)
	}
	defer file.Close()

	// Get file size
	stat, err := file.Stat()
	if err != nil {
		return fmt.Errorf("getting file stats: %w", err)
	}

	// Read last 16KB or whole file if smaller
	readSize := int64(16 * 1024)
	var offset int64
	if stat.Size() > readSize {
		offset = stat.Size() - readSize
	}

	_, err = file.Seek(offset, 0)
	if err != nil {
		return fmt.Errorf("seeking file: %w", err)
	}

	buf := make([]byte, readSize)
	n, err := file.Read(buf)
	if err != nil && err != io.EOF {
		return fmt.Errorf("reading file: %w", err)
	}
	buf = buf[:n]

	// Skip partial line at start if we're not at beginning of file
	if offset > 0 {
		idx := bytes.IndexByte(buf, '\n')
		if idx >= 0 {
			buf = buf[idx+1:]
		}
	}

	// Split into lines
	lines := bytes.Split(buf, []byte{'\n'})

	// Take last 100 lines if we have more
	startIdx := 0
	if len(lines) > 100 {
		startIdx = len(lines) - 100
	}

	// Print lines
	for _, line := range lines[startIdx:] {
		WriteStdout("%s\n", string(line))
	}

	return nil
}
