// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var setBgCmd = &cobra.Command{
	Use:     "setbg [--opacity value] [--tile] image-path",
	Short:   "set background image for a tab",
	RunE:    setBgRun,
	PreRunE: preRunSetupRpcClient,
}

var (
	setBgOpacity float64
	setBgTile    bool
)

func init() {
	rootCmd.AddCommand(setBgCmd)
	setBgCmd.Flags().Float64Var(&setBgOpacity, "opacity", 0.5, "background opacity (0.0-1.0)")
	setBgCmd.Flags().BoolVar(&setBgTile, "tile", false, "tile the background image instead of cover")
}

func setBgRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("setbg", rtnErr == nil)
	}()

	if len(args) != 1 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("setbg requires a path to an image file")
	}

	if setBgOpacity < 0 || setBgOpacity > 1 {
		return fmt.Errorf("opacity must be between 0.0 and 1.0")
	}

	// Get absolute path and escape it for URL
	imgPath := args[0]
	absPath, err := filepath.Abs(wavebase.ExpandHomeDirSafe(imgPath))
	if err != nil {
		return fmt.Errorf("resolving image path: %v", err)
	}

	fileInfo, err := os.Stat(absPath)
	if err != nil {
		return fmt.Errorf("cannot access image file: %v", err)
	}
	if fileInfo.IsDir() {
		return fmt.Errorf("path is a directory, not an image file")
	}

	mimeType := utilfn.DetectMimeType(absPath, fileInfo, true)
	switch mimeType {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml":
		// Valid image type
	default:
		return fmt.Errorf("file does not appear to be a valid image (detected type: %s)", mimeType)
	}

	// Create URL-safe path
	escapedPath := strings.ReplaceAll(absPath, "'", "\\'")

	// Construct background style
	bgStyle := fmt.Sprintf("url('%s')", escapedPath)
	if setBgTile {
		bgStyle += " repeat"
	} else {
		bgStyle += " center/cover no-repeat"
	}

	// Create metadata
	meta := map[string]interface{}{
		"bg:*":       true,
		"bg":         bgStyle,
		"bg:opacity": setBgOpacity,
	}

	// Resolve tab reference
	oRef, err := resolveSimpleId("tab")
	if err != nil {
		return err
	}

	// Send RPC request
	setMetaWshCmd := wshrpc.CommandSetMetaData{
		ORef: *oRef,
		Meta: meta,
	}
	err = wshclient.SetMetaCommand(RpcClient, setMetaWshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("setting background: %v", err)
	}

	WriteStdout("background set\n")
	return nil
}
