// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

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
	blocksTimeout     int    // Timeout in seconds for RPC calls
)

// BlockDetails represents the information about a block returned by the list command
type BlockDetails struct {
	BlockId     string              `json:"blockid"`     // Unique identifier for the block
	WorkspaceId string              `json:"workspaceid"` // ID of the workspace containing the block
	TabId       string              `json:"tabid"`       // ID of the tab containing the block
	View        string              `json:"view"`        // Canonical view type (term, web, preview, edit, sysinfo, waveai)
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

  # Filter by tab ID
  wsh blocks list --tab=a0459921-cc1a-48cc-ae7b-5f4821e1c9e1

  # Output as JSON for scripting
  wsh blocks list --json

  # Set a different timeout (in milliseconds)
  wsh blocks list --timeout=10000`,
	RunE:    blocksListRun,
	PreRunE: preRunSetupRpcClient,
	SilenceUsage: true,
}

// init registers the blocks commands with the root command
// It configures all the flags and command options
func init() {
	blocksListCmd.Flags().StringVar(&blocksWindowId, "window", "", "restrict to window id")
	blocksListCmd.Flags().StringVar(&blocksWorkspaceId, "workspace", "", "restrict to workspace id")
	blocksListCmd.Flags().StringVar(&blocksTabId, "tab", "", "restrict to specific tab id")
	blocksListCmd.Flags().StringVar(&blocksView, "view", "", "restrict to view type (term/terminal, web/browser, preview/edit, sysinfo, waveai)")
	blocksListCmd.Flags().BoolVar(&blocksJSON, "json", false, "output as JSON")
	blocksListCmd.Flags().IntVar(&blocksTimeout, "timeout", 5000, "timeout in milliseconds for RPC calls (default: 5000)")

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

	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: int64(blocksTimeout)})
	if err != nil {
		return fmt.Errorf("failed to list workspaces: %v", err)
	}

	if len(workspaces) == 0 {
		return fmt.Errorf("no workspaces found")
	}

	var workspaceIdsToQuery []string

	// Determine which workspaces to query
	if blocksWorkspaceId != "" && blocksWindowId != "" {
		return fmt.Errorf("--workspace and --window are mutually exclusive; specify only one")
	}
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
	hadSuccess := false
	for _, wsId := range workspaceIdsToQuery {
		req := wshrpc.BlocksListRequest{WorkspaceId: wsId}
		if blocksWindowId != "" {
			req.WindowId = blocksWindowId
		}

		blocks, err := wshclient.BlocksListCommand(RpcClient, req, &wshrpc.RpcOpts{Timeout: int64(blocksTimeout)})
		if err != nil {
			WriteStderr("Warning: couldn't list blocks for workspace %s: %v\n", wsId, err)
			continue
		}
		hadSuccess = true

		// Apply filters
		for _, b := range blocks {
			if blocksTabId != "" && b.TabId != blocksTabId {
				continue
			}

			if blocksView != "" {
				view := b.Meta.GetString(waveobj.MetaKey_View, "")

				// Support view type aliases
				if !matchesViewType(view, blocksView) {
					continue
				}
			}

			v := b.Meta.GetString(waveobj.MetaKey_View, "")
			allBlocks = append(allBlocks, BlockDetails{
				BlockId:     b.BlockId,
				WorkspaceId: b.WorkspaceId,
				TabId:       b.TabId,
				View:        v,
				Meta:        b.Meta,
			})
		}
	}

	// No blocks found check
	if len(allBlocks) == 0 {
		if !hadSuccess {
			return fmt.Errorf("failed to list blocks from all %d workspace(s)", len(workspaceIdsToQuery))
		}
		WriteStdout("No blocks found\n")
		return nil
	}

	// Stable ordering for both JSON and table output
	sort.Slice(allBlocks, func(i, j int) bool {
		if allBlocks[i].WorkspaceId != allBlocks[j].WorkspaceId {
			return allBlocks[i].WorkspaceId < allBlocks[j].WorkspaceId
		}
		if allBlocks[i].TabId != allBlocks[j].TabId {
			return allBlocks[i].TabId < allBlocks[j].TabId
		}
		return allBlocks[i].BlockId < allBlocks[j].BlockId
	})

	// Output results
	if blocksJSON {
		bytes, err := json.MarshalIndent(allBlocks, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal JSON: %v", err)
		}
		WriteStdout("%s\n", string(bytes))
		return nil
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "BLOCK ID\tWORKSPACE\tTAB ID\tVIEW\tCONTENT\n")

	for _, b := range allBlocks {
		blockID := b.BlockId
		if len(blockID) > 36 {
			blockID = blockID[:34] + ".."
		}
		view := b.View
		if view == "" {
			view = "<unknown>"
		}
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
		if len(wsID) > 36 {
			wsID = wsID[:34] + ".."
		}

		tabID := b.TabId
		if len(tabID) > 36 {
			tabID = tabID[0:34] + ".."
		}

		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", blockID, wsID, tabID, view, content)
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
