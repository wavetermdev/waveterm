// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var excalidrawMagnified bool

var excalidrawCmd = &cobra.Command{
	Use:     "excalidraw [file]",
	Short:   "open an Excalidraw diagram",
	Args:    cobra.MaximumNArgs(1),
	RunE:    excalidrawRun,
	PreRunE: preRunSetupRpcClient,
}

var excalidrawPushCmd = &cobra.Command{
	Use:     "push <blockid> [file]",
	Short:   "push Excalidraw JSON into a block's scene",
	Args:    cobra.RangeArgs(1, 2),
	RunE:    excalidrawPushRun,
	PreRunE: preRunSetupRpcClient,
}

var excalidrawMermaidCmd = &cobra.Command{
	Use:     "mermaid [blockid] [file]",
	Short:   "open or push a Mermaid diagram as Excalidraw",
	Args:    cobra.RangeArgs(0, 2),
	RunE:    excalidrawMermaidRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	excalidrawCmd.Flags().BoolVarP(&excalidrawMagnified, "magnified", "m", false, "open in magnified mode")
	excalidrawCmd.AddCommand(excalidrawPushCmd)
	excalidrawCmd.AddCommand(excalidrawMermaidCmd)
	rootCmd.AddCommand(excalidrawCmd)
}

func excalidrawRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("excalidraw", rtnErr == nil)
	}()
	tabId := getTabIdFromEnv()
	if tabId == "" {
		return fmt.Errorf("no WAVETERM_TABID env var set")
	}
	meta := map[string]any{
		waveobj.MetaKey_View: "excalidraw",
	}
	if len(args) > 0 {
		absFile, err := filepath.Abs(args[0])
		if err != nil {
			return fmt.Errorf("getting absolute path: %w", err)
		}
		meta[waveobj.MetaKey_File] = absFile
	}
	if RpcContext.Conn != "" {
		meta[waveobj.MetaKey_Connection] = RpcContext.Conn
	}
	wshCmd := &wshrpc.CommandCreateBlockData{
		TabId: tabId,
		BlockDef: &waveobj.BlockDef{
			Meta: meta,
		},
		Magnified: excalidrawMagnified,
		Focused:   true,
	}
	_, err := wshclient.CreateBlockCommand(RpcClient, *wshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("creating excalidraw block: %w", err)
	}
	return nil
}

func excalidrawPushRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("excalidraw:push", rtnErr == nil)
	}()
	blockId := args[0]
	var jsonData []byte
	var err error
	if len(args) > 1 {
		jsonData, err = os.ReadFile(args[1])
	} else {
		jsonData, err = io.ReadAll(io.LimitReader(os.Stdin, MaxFileSize+1))
	}
	if err != nil {
		return fmt.Errorf("reading input: %w", err)
	}
	if len(jsonData) > MaxFileSize {
		return fmt.Errorf("input exceeds maximum size of %d bytes", MaxFileSize)
	}
	var sceneData any
	if err := json.Unmarshal(jsonData, &sceneData); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	pushData := wshrpc.CommandExcalidrawPushData{
		BlockId:   blockId,
		SceneData: sceneData,
	}
	err = wshclient.ExcalidrawPushCommand(RpcClient, pushData, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("push failed: %w", err)
	}
	return nil
}

func excalidrawMermaidRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("excalidraw:mermaid", rtnErr == nil)
	}()
	var blockId string
	var mermaidData []byte
	var err error
	switch len(args) {
	case 0:
		mermaidData, err = io.ReadAll(io.LimitReader(os.Stdin, MaxFileSize+1))
		if err != nil {
			return fmt.Errorf("reading stdin: %w", err)
		}
	case 1:
		mermaidData, err = os.ReadFile(args[0])
		if err != nil {
			if !os.IsNotExist(err) {
				return fmt.Errorf("reading file: %w", err)
			}
			if _, uuidErr := uuid.Parse(args[0]); uuidErr != nil {
				return fmt.Errorf("file not found: %s", args[0])
			}
			blockId = args[0]
			mermaidData, err = io.ReadAll(io.LimitReader(os.Stdin, MaxFileSize+1))
			if err != nil {
				return fmt.Errorf("reading stdin: %w", err)
			}
		}
	case 2:
		blockId = args[0]
		mermaidData, err = os.ReadFile(args[1])
		if err != nil {
			return fmt.Errorf("reading file: %w", err)
		}
	}
	if len(mermaidData) > MaxFileSize {
		return fmt.Errorf("input exceeds maximum size of %d bytes", MaxFileSize)
	}
	if blockId == "" {
		tabId := getTabIdFromEnv()
		if tabId == "" {
			return fmt.Errorf("no WAVETERM_TABID env var set")
		}
		createData := &wshrpc.CommandCreateBlockData{
			TabId: tabId,
			BlockDef: &waveobj.BlockDef{
				Meta: map[string]any{
					waveobj.MetaKey_View: "excalidraw",
				},
			},
			Magnified: excalidrawMagnified,
			Focused:   true,
		}
		oref, err := wshclient.CreateBlockCommand(RpcClient, *createData, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("creating excalidraw block: %w", err)
		}
		blockId = oref.OID
	}
	pushData := wshrpc.CommandExcalidrawPushData{
		BlockId:   blockId,
		SceneData: string(mermaidData),
		Format:    "mermaid",
	}
	err = wshclient.ExcalidrawPushCommand(RpcClient, pushData, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("mermaid push failed: %w", err)
	}
	return nil
}
