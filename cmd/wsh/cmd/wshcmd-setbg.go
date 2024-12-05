// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/hex"
	"encoding/json"
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
	Use:   "setbg [--opacity value] [--tile|--center] [--scale value] (image-path|\"#color\"|color-name)",
	Short: "set background image or color for a tab",
	Long: `Set a background image or color for a tab. Colors can be specified as:
  - A quoted hex value like "#ff0000" (quotes required to prevent # being interpreted as a shell comment)
  - A CSS color name like "blue" or "forestgreen"
Or provide a path to a supported image file (jpg, png, gif, webp, or svg).

You can also:
  - Use --clear to remove the background
  - Use --opacity without other arguments to change just the opacity
  - Use --center for centered images without scaling (good for logos)
  - Use --scale with --center to control image size
  - Use --print to see the metadata without applying it`,
	RunE:    setBgRun,
	PreRunE: preRunSetupRpcClient,
}

var (
	setBgOpacity float64
	setBgTile    bool
	setBgCenter  bool
	setBgSize    string
	setBgClear   bool
	setBgPrint   bool
)

func init() {
	rootCmd.AddCommand(setBgCmd)
	setBgCmd.Flags().Float64Var(&setBgOpacity, "opacity", 0.5, "background opacity (0.0-1.0)")
	setBgCmd.Flags().BoolVar(&setBgTile, "tile", false, "tile the background image")
	setBgCmd.Flags().BoolVar(&setBgCenter, "center", false, "center the image without scaling")
	setBgCmd.Flags().StringVar(&setBgSize, "size", "auto", "size for centered images (px, %, or auto)")
	setBgCmd.Flags().BoolVar(&setBgClear, "clear", false, "clear the background")
	setBgCmd.Flags().BoolVar(&setBgPrint, "print", false, "print the metadata without applying it")

	// Make tile and center mutually exclusive
	setBgCmd.MarkFlagsMutuallyExclusive("tile", "center")
}

func validateHexColor(color string) error {
	if !strings.HasPrefix(color, "#") {
		return fmt.Errorf("color must start with #")
	}
	colorHex := color[1:]
	if len(colorHex) != 6 && len(colorHex) != 8 {
		return fmt.Errorf("color must be in #RRGGBB or #RRGGBBAA format")
	}
	_, err := hex.DecodeString(colorHex)
	if err != nil {
		return fmt.Errorf("invalid hex color: %v", err)
	}
	return nil
}

func setBgRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("setbg", rtnErr == nil)
	}()

	// Create base metadata
	meta := map[string]interface{}{}

	// Handle opacity-only change or clear
	if len(args) == 0 {
		if !cmd.Flags().Changed("opacity") && !setBgClear {
			OutputHelpMessage(cmd)
			return fmt.Errorf("setbg requires an image path or color value")
		}
		if setBgOpacity < 0 || setBgOpacity > 1 {
			return fmt.Errorf("opacity must be between 0.0 and 1.0")
		}
		if cmd.Flags().Changed("opacity") {
			meta["bg:opacity"] = setBgOpacity
		}
	} else if len(args) > 1 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("too many arguments")
	} else {
		// Handle background setting
		meta["bg:*"] = true
		if setBgOpacity < 0 || setBgOpacity > 1 {
			return fmt.Errorf("opacity must be between 0.0 and 1.0")
		}
		meta["bg:opacity"] = setBgOpacity

		input := args[0]
		var bgStyle string

		// Check for hex color
		if strings.HasPrefix(input, "#") {
			if err := validateHexColor(input); err != nil {
				return err
			}
			bgStyle = input
		} else if CssColorNames[strings.ToLower(input)] {
			// Handle CSS color name
			bgStyle = strings.ToLower(input)
		} else {
			// Handle image input
			absPath, err := filepath.Abs(wavebase.ExpandHomeDirSafe(input))
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
			bgStyle = fmt.Sprintf("url('%s')", escapedPath)

			switch {
			case setBgTile:
				bgStyle += " repeat"
			case setBgCenter:
				bgStyle += fmt.Sprintf(" no-repeat center/%s", setBgSize)
			default:
				bgStyle += " center/cover no-repeat"
			}
		}

		meta["bg"] = bgStyle
	}

	if setBgPrint {
		jsonBytes, err := json.MarshalIndent(meta, "", "  ")
		if err != nil {
			return fmt.Errorf("error formatting metadata: %v", err)
		}
		WriteStdout(string(jsonBytes) + "\n")
		return nil
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
