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

// Command-line flags for the blocks commands
var (
	blocksWindowId    string // Window ID to filter blocks by
	blocksWorkspaceId string // Workspace ID to filter blocks by
	blocksTabId       string // Tab ID to filter blocks by
	blocksView        string // View type to filter blocks by (term, web, etc.)
	blocksJSON        bool   // Whether to output as JSON
)

// BlockDetails represents the information about a block returned by the list command
type BlockDetails struct {
	BlockId     string              `json:"blockid"`     // Unique identifier for the block
	WorkspaceId string              `json:"workspaceid"` // ID of the workspace containing the block
	TabId       string              `json:"tabid"`       // ID of the tab containing the block
	Meta        waveobj.MetaMapType `json:"meta"`        // Block metadata including view type
}

// blocksListCmd represents the 'blocks list' command
var blocksListCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls", "get"},
	Short:   "List blocks in workspaces/windows",
	Long:    `List blocks with optional filtering by workspace, window, tab, or view type.

Examples:
  # List blocks from all workspaces
  wsh blocks list

  # List only terminal blocks
  wsh blocks list --view=term

  # Filter by window ID (get IDs from 'wsh workspace list')
  wsh blocks list --window=dbca23b5-f89b-4780-a0fe-452f5bc7d900

  # Filter by workspace ID
  wsh blocks list --workspace=12d0c067-378e-454c-872e-77a314248114

  # Output as JSON for scripting
  wsh blocks list --json`,
	RunE:    blocksListRun,
	PreRunE: preRunSetupRpcClient,
}

// init registers the blocks commands with the root command
// It configures all the flags and command options
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

// blocksListRun implements the 'blocks list' command
// It retrieves and displays blocks with optional filtering by workspace, window, tab, or view type
func blocksListRun(cmd *cobra.Command, args []string) error {
	var allBlocks []BlockDetails

	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("failed to list workspaces: %v", err)
	}

	if len(workspaces) == 0 {
		return fmt.Errorf("no workspaces found")
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
	} else {
		// Default to all workspaces
		for _, ws := range workspaces {
			workspaceIdsToQuery = append(workspaceIdsToQuery, ws.WorkspaceData.OID)
		}
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
		bytes, err := json.MarshalIndent(allBlocks, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal JSON: %v", err)
		}
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
// It handles different aliases for the same view type, allowing flexible filtering
// Examples: "term" matches "terminal", "shell", "console"; "web" matches "browser", "url"
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
