// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	blocksWindowId    string
	blocksWorkspaceId string
	blocksTabId       string
	blocksView        string
	blocksJSON        bool
)

type BlockDetails struct {
	BlockId     string              `json:"blockid"`
	WorkspaceId string              `json:"workspaceid"`
	TabId       string              `json:"tabid"`
	Meta        waveobj.MetaMapType `json:"meta"`
}

var blocksListCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls", "get"},
	Short:   "List blocks in workspaces/windows",
	Long:    `List blocks with optional filtering by workspace, window, tab, or view type.

Examples:
  # List blocks in the current workspace
  wsh blocks list

  # List only terminal blocks
  wsh blocks list --view=term

  # Filter by window ID (get IDs from 'wsh workspace list')
  wsh blocks list --window=dbca23b5-f89b-4780-a0fe-452f5bc7d900

  # Output as JSON for scripting
  wsh blocks list --json`,
	RunE:    blocksListRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	blocksListCmd.Flags().StringVar(&blocksWindowId, "window", "", "restrict to window id")
	blocksListCmd.Flags().StringVar(&blocksWorkspaceId, "workspace", "", "restrict to workspace id")
	blocksListCmd.Flags().StringVar(&blocksTabId, "tab", "", "restrict to tab id")
	blocksListCmd.Flags().StringVar(&blocksView, "view", "", "restrict to view type (term/terminal, web/browser, preview/edit, sysinfo, waveai)")
	blocksListCmd.Flags().BoolVar(&blocksJSON, "json", false, "output as JSON")

	for _, cmd := range rootCmd.Commands() {
		if cmd.Use == "blocks" {
			cmd.AddCommand(blocksListCmd)
			return
		}
	}

	blocksCmd := &cobra.Command{
		Use:     "blocks",
		Short:   "Manage blocks",
		Long:    "Commands for working with blocks",
	}

	blocksCmd.AddCommand(blocksListCmd)
	rootCmd.AddCommand(blocksCmd)
}

func blocksListRun(cmd *cobra.Command, args []string) error {
	var allBlocks []BlockDetails

	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("failed to list workspaces: %v", err)
	}

	if len(workspaces) == 0 {
		return fmt.Errorf("no workspaces found")
	}

	var currentWorkspaceId string
	if len(workspaces) > 0 {
		currentWorkspaceId = workspaces[0].WorkspaceData.OID
	}

	var workspaceIdsToQuery []string

	// Determine which workspaces to query
	if blocksWorkspaceId != "" {
		workspaceIdsToQuery = []string{blocksWorkspaceId}
	} else if blocksWindowId != "" {
		// Find workspace ID for this window
		windowFound := false
		for _, ws := range workspaces {
			if ws.WindowId == blocksWindowId {
				workspaceIdsToQuery = []string{ws.WorkspaceData.OID}
				windowFound = true
				break
			}
		}
		if !windowFound {
			return fmt.Errorf("window %s not found", blocksWindowId)
		}
	} else if blocksTabId != "" {
		// When filtering by tab, we need to check all workspaces
		for _, ws := range workspaces {
			workspaceIdsToQuery = append(workspaceIdsToQuery, ws.WorkspaceData.OID)
		}
	} else {
		// Default to current workspace
		workspaceIdsToQuery = []string{currentWorkspaceId}
	}

	// Query each selected workspace
	for _, wsId := range workspaceIdsToQuery {
		req := wshrpc.BlocksListRequest{
			WorkspaceId: wsId,
		}

		blocks, err := wshclient.BlocksListCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			WriteStderr("Warning: couldn't list blocks for workspace %s: %v\n", wsId, err)
			continue
		}

		// Apply filters
		for _, b := range blocks {
			if blocksTabId != "" && blocksTabId != "current" && b.TabId != blocksTabId {
				continue
			}

			if blocksView != "" {
				view := b.Meta.GetString(waveobj.MetaKey_View, "")

				// Support view type aliases
				if !matchesViewType(view, blocksView) {
					continue
				}
			}

			allBlocks = append(allBlocks, BlockDetails{
				BlockId:     b.BlockId,
				WorkspaceId: b.WorkspaceId,
				TabId:       b.TabId,
				Meta:        b.Meta,
			})
		}
	}

	// Output results
	if blocksJSON {
		bytes, _ := json.MarshalIndent(allBlocks, "", "  ")
		WriteStdout("%s\n", string(bytes))
		return nil
	}

	if len(allBlocks) == 0 {
		WriteStdout("No blocks found\n")
		return nil
	}

	format := "%-36s  %-10s  %-36s  %-15s  %s\n"
	WriteStdout(format, "BLOCK ID", "WORKSPACE", "TAB ID", "VIEW", "CONTENT")

	for _, b := range allBlocks {
		view := b.Meta.GetString(waveobj.MetaKey_View, "<unknown>")
		var content string

		switch view {
		case "preview", "edit":
			content = b.Meta.GetString(waveobj.MetaKey_File, "<no file>")
		case "web":
			content = b.Meta.GetString(waveobj.MetaKey_Url, "<no url>")
		case "term":
			content = b.Meta.GetString(waveobj.MetaKey_CmdCwd, "<no cwd>")
		default:
			content = ""
		}

		wsID := b.WorkspaceId
		if len(wsID) > 10 {
			wsID = wsID[0:8] + ".."
		}

		tabID := b.TabId
		if len(tabID) > 36 {
			tabID = tabID[0:34] + ".."
		}

		WriteStdout(format, b.BlockId, wsID, tabID, view, content)
	}

	return nil
}

// matchesViewType checks if a view type matches a filter, supporting aliases
func matchesViewType(actual, filter string) bool {
	// Direct match (case insensitive)
	if strings.EqualFold(actual, filter) {
		return true
	}

	// Handle aliases
	switch strings.ToLower(filter) {
	case "preview", "edit":
		return strings.EqualFold(actual, "preview") || strings.EqualFold(actual, "edit")
	case "terminal", "term", "shell", "console":
		return strings.EqualFold(actual, "term")
	case "web", "browser", "url":
		return strings.EqualFold(actual, "web")
	case "ai", "waveai", "assistant":
		return strings.EqualFold(actual, "waveai")
	case "sys", "sysinfo", "system":
		return strings.EqualFold(actual, "sysinfo")
	}

	return false
}
