// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var tabRefNumRe = regexp.MustCompile(`^tab:(\d{1,3})$`)

var tabCommand = &cobra.Command{
	Use:   "tab",
	Short: "Manage tabs",
	Long:  "Commands for listing, creating, selecting, closing, renaming, and reordering tabs.",
}

var tabListCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List tabs in a workspace",
	Long: `List tabs with their ids and names, in their current order.
Defaults to the current workspace (from WAVETERM_WORKSPACEID).`,
	RunE:    tabListRun,
	PreRunE: preRunSetupRpcClient,
}

var tabMoveCmd = &cobra.Command{
	Use:   "move <tabid> --index <n>",
	Short: "Move a tab to a new position in the tab bar",
	Long: `Move the specified tab to the given 0-based index within its workspace.
The tab ordering is updated atomically; the set of tab ids must remain exactly
the same (no adding or dropping tabs).`,
	Args:    cobra.ExactArgs(1),
	RunE:    tabMoveRun,
	PreRunE: preRunSetupRpcClient,
}

var (
	tabWorkspaceId   string
	tabListJSON      bool
	tabMoveIndex     int
	tabNewName       string
	tabNewConnection string
	tabNewActivate   bool
	tabNewJSON       bool
)

var tabNewCmd = &cobra.Command{
	Use:     "new",
	Short:   "Create a new tab",
	Long:    "Create a new tab in the current workspace. Activated by default; pass --activate=false to leave the current tab selected.",
	RunE:    tabNewRun,
	PreRunE: preRunSetupRpcClient,
}

var tabSelectCmd = &cobra.Command{
	Use:     "select <tab_ref>",
	Short:   "Select (activate) a tab",
	Long:    "Activate a tab by uuid, tab:N (1-indexed), or case-insensitive name substring.",
	Args:    cobra.ExactArgs(1),
	RunE:    tabSelectRun,
	PreRunE: preRunSetupRpcClient,
}

var tabCloseCmd = &cobra.Command{
	Use:     "close <tab_ref>",
	Short:   "Close a tab",
	Long:    "Close a tab by uuid, tab:N (1-indexed), or case-insensitive name substring. Refuses to close the last tab in a workspace.",
	Args:    cobra.ExactArgs(1),
	RunE:    tabCloseRun,
	PreRunE: preRunSetupRpcClient,
}

var tabRenameCmd = &cobra.Command{
	Use:     "rename <tab_ref> <name>",
	Short:   "Rename a tab",
	Long:    "Rename a tab identified by uuid, tab:N (1-indexed), or case-insensitive name substring.",
	Args:    cobra.ExactArgs(2),
	RunE:    tabRenameRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	tabListCmd.Flags().StringVar(&tabWorkspaceId, "workspace", "", "workspace id (defaults to WAVETERM_WORKSPACEID)")
	tabListCmd.Flags().BoolVar(&tabListJSON, "json", false, "output as JSON")
	tabCommand.AddCommand(tabListCmd)

	tabMoveCmd.Flags().StringVar(&tabWorkspaceId, "workspace", "", "workspace id (defaults to WAVETERM_WORKSPACEID)")
	tabMoveCmd.Flags().IntVar(&tabMoveIndex, "index", -1, "0-based target position (required)")
	tabMoveCmd.MarkFlagRequired("index")
	tabCommand.AddCommand(tabMoveCmd)

	tabNewCmd.Flags().StringVar(&tabWorkspaceId, "workspace", "", "workspace id (defaults to WAVETERM_WORKSPACEID)")
	tabNewCmd.Flags().StringVar(&tabNewName, "name", "", "name for the new tab")
	tabNewCmd.Flags().StringVar(&tabNewConnection, "connection", "", "connection for the new tab")
	tabNewCmd.Flags().BoolVar(&tabNewActivate, "activate", true, "activate the new tab (default true)")
	tabNewCmd.Flags().BoolVar(&tabNewJSON, "json", false, "output as JSON")
	tabCommand.AddCommand(tabNewCmd)

	tabSelectCmd.Flags().StringVar(&tabWorkspaceId, "workspace", "", "workspace id (defaults to WAVETERM_WORKSPACEID)")
	tabCommand.AddCommand(tabSelectCmd)

	tabCloseCmd.Flags().StringVar(&tabWorkspaceId, "workspace", "", "workspace id (defaults to WAVETERM_WORKSPACEID)")
	tabCommand.AddCommand(tabCloseCmd)

	tabRenameCmd.Flags().StringVar(&tabWorkspaceId, "workspace", "", "workspace id (defaults to WAVETERM_WORKSPACEID)")
	tabCommand.AddCommand(tabRenameCmd)

	rootCmd.AddCommand(tabCommand)
}

type tabListEntry struct {
	TabId       string `json:"tabid"`
	Name        string `json:"name"`
	WorkspaceId string `json:"workspaceid"`
	Index       int    `json:"index"`
}

func resolveWorkspaceId() (string, error) {
	wsId := tabWorkspaceId
	if wsId != "" {
		return wsId, nil
	}
	wsId = os.Getenv("WAVETERM_WORKSPACEID")
	if wsId != "" {
		return wsId, nil
	}
	return "", fmt.Errorf("no workspace id specified (use --workspace or set WAVETERM_WORKSPACEID)")
}

func getWorkspaceForId(wsId string, workspaces []wshrpc.WorkspaceInfoData) (*waveobj.Workspace, error) {
	for _, w := range workspaces {
		if w.WorkspaceData.OID == wsId {
			return w.WorkspaceData, nil
		}
	}
	return nil, fmt.Errorf("workspace %q not found", wsId)
}

func fetchWorkspaceTabs(wsId string) ([]tabListEntry, error) {
	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return nil, fmt.Errorf("failed to list workspaces: %v", err)
	}

	ws, err := getWorkspaceForId(wsId, workspaces)
	if err != nil {
		return nil, err
	}

	entries := make([]tabListEntry, 0, len(ws.TabIds))
	for i, tabId := range ws.TabIds {
		tabData, err := wshclient.GetTabCommand(RpcClient, tabId, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			WriteStderr("warning: could not fetch tab %s: %v\n", tabId, err)
			entries = append(entries, tabListEntry{
				TabId:       tabId,
				Name:        "<error>",
				WorkspaceId: ws.OID,
				Index:       i,
			})
			continue
		}
		entries = append(entries, tabListEntry{
			TabId:       tabId,
			Name:        tabData.Name,
			WorkspaceId: ws.OID,
			Index:       i,
		})
	}
	return entries, nil
}

func resolveTabRef(workspaceId, ref string) (string, error) {
	tabs, err := fetchWorkspaceTabs(workspaceId)
	if err != nil {
		return "", err
	}
	return resolveTabRefFromList(tabs, ref)
}

func resolveTabRefFromList(tabs []tabListEntry, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", fmt.Errorf("tab ref is empty")
	}

	for _, t := range tabs {
		if strings.EqualFold(t.TabId, ref) {
			return t.TabId, nil
		}
	}

	if oref, err := waveobj.ParseORef(ref); err == nil && oref.OType == waveobj.OType_Tab {
		for _, t := range tabs {
			if strings.EqualFold(t.TabId, oref.OID) {
				return t.TabId, nil
			}
		}
		return "", fmt.Errorf("tab %q not found", oref.OID)
	}

	if _, err := uuid.Parse(ref); err == nil {
		return "", fmt.Errorf("tab %q not found", ref)
	}

	if m := tabRefNumRe.FindStringSubmatch(ref); m != nil {
		n, err := strconv.Atoi(m[1])
		if err != nil {
			return "", fmt.Errorf("error parsing tab number: %v", err)
		}
		target := n - 1
		for _, t := range tabs {
			if t.Index == target {
				return t.TabId, nil
			}
		}
		return "", fmt.Errorf("tab num out of range, workspace has %d tabs", len(tabs))
	}

	query := strings.ToLower(ref)
	var matches []tabListEntry
	for _, t := range tabs {
		if t.Name == "" {
			continue
		}
		if strings.Contains(strings.ToLower(t.Name), query) {
			matches = append(matches, t)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].TabId < matches[j].TabId
	})
	switch len(matches) {
	case 0:
		return "", fmt.Errorf("no tab found with name containing %q", ref)
	case 1:
		return matches[0].TabId, nil
	default:
		var sb strings.Builder
		for i, t := range matches {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(t.TabId)
			if t.Name != "" {
				sb.WriteString(" (")
				sb.WriteString(t.Name)
				sb.WriteString(")")
			}
		}
		return "", fmt.Errorf("ambiguous: %d tabs match name %q: %s", len(matches), ref, sb.String())
	}
}

func tabListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
	}()

	wsId, err := resolveWorkspaceId()
	if err != nil {
		return err
	}

	entries, err := fetchWorkspaceTabs(wsId)
	if err != nil {
		return err
	}

	if tabListJSON {
		bytes, mErr := json.MarshalIndent(entries, "", "  ")
		if mErr != nil {
			return fmt.Errorf("failed to marshal JSON: %v", mErr)
		}
		WriteStdout("%s\n", string(bytes))
		return nil
	}

	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "INDEX\tTAB ID\tNAME\n")
	for _, e := range entries {
		tabId := e.TabId
		if len(tabId) > 36 {
			tabId = tabId[:34] + ".."
		}
		fmt.Fprintf(w, "%d\t%s\t%s\n", e.Index, tabId, e.Name)
	}
	return nil
}

func tabMoveRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
	}()

	tabId := args[0]
	wsId, err := resolveWorkspaceId()
	if err != nil {
		return err
	}

	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("failed to list workspaces: %v", err)
	}

	ws, err := getWorkspaceForId(wsId, workspaces)
	if err != nil {
		return err
	}

	oldIdx := -1
	for i, id := range ws.TabIds {
		if id == tabId {
			oldIdx = i
			break
		}
	}
	if oldIdx == -1 {
		return fmt.Errorf("tab %q not found in workspace %q", tabId, ws.OID)
	}

	targetIdx := tabMoveIndex
	if targetIdx < 0 || targetIdx >= len(ws.TabIds) {
		return fmt.Errorf("index %d out of range [0, %d]", targetIdx, len(ws.TabIds)-1)
	}
	if targetIdx == oldIdx {
		WriteStdout("tab %s is already at index %d\n", tabId, targetIdx)
		return nil
	}

	newTabIds := reorderTabIds(ws.TabIds, oldIdx, targetIdx, tabId)

	err = wshclient.UpdateWorkspaceTabIdsCommand(RpcClient, ws.OID, newTabIds, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("failed to update tab order: %v", err)
	}

	WriteStdout("moved tab %s from index %d to %d\n", tabId, oldIdx, targetIdx)
	return nil
}

// reorderTabIds returns a new slice with the element at oldIdx moved to targetIdx.
// It preserves the relative order of all other elements. Both oldIdx and targetIdx
// must be valid indices into tabIds, and oldIdx != targetIdx.
func reorderTabIds(tabIds []string, oldIdx, targetIdx int, tabId string) []string {
	newTabIds := make([]string, 0, len(tabIds))
	for i, id := range tabIds {
		if i == oldIdx {
			continue
		}
		newTabIds = append(newTabIds, id)
	}
	result := make([]string, 0, len(tabIds))
	result = append(result, newTabIds[:targetIdx]...)
	result = append(result, tabId)
	result = append(result, newTabIds[targetIdx:]...)
	return result
}

type tabNewJSONOutput struct {
	TabId string `json:"tabid"`
	Name  string `json:"name"`
}

func tabNewRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
	}()

	wsId, err := resolveWorkspaceId()
	if err != nil {
		return err
	}

	rtn, err := wshclient.CreateTabCommand(RpcClient, wshrpc.CommandCreateTabData{
		WorkspaceId: wsId,
		Name:        tabNewName,
		Connection:  tabNewConnection,
		Activate:    tabNewActivate,
	}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("creating tab: %w", err)
	}

	if tabNewJSON {
		outBytes, mErr := json.Marshal(tabNewJSONOutput{TabId: rtn.TabId, Name: rtn.Name})
		if mErr != nil {
			return fmt.Errorf("failed to marshal JSON: %v", mErr)
		}
		WriteStdout("%s\n", string(outBytes))
		return nil
	}
	WriteStdout("tab created: %s %s\n", rtn.TabId, rtn.Name)
	return nil
}

func tabSelectRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
	}()

	wsId, err := resolveWorkspaceId()
	if err != nil {
		return err
	}
	tabId, err := resolveTabRef(wsId, args[0])
	if err != nil {
		return err
	}
	err = wshclient.SetActiveTabCommand(RpcClient, wshrpc.CommandSetActiveTabData{
		WorkspaceId: wsId,
		TabId:       tabId,
	}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("selecting tab: %w", err)
	}
	WriteStdout("selected tab %s\n", tabId)
	return nil
}

func tabCloseRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
	}()

	wsId, err := resolveWorkspaceId()
	if err != nil {
		return err
	}
	tabId, err := resolveTabRef(wsId, args[0])
	if err != nil {
		return err
	}
	rtn, err := wshclient.DeleteTabCommand(RpcClient, wshrpc.CommandDeleteTabData{
		WorkspaceId: wsId,
		TabId:       tabId,
	}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "last tab") {
			return fmt.Errorf("cannot close the last tab in the workspace")
		}
		return fmt.Errorf("closing tab: %w", err)
	}
	log.Printf("[agent-audit] tab close workspace=%s tab=%s newactive=%s\n", wsId, tabId, rtn.NewActiveTabId)
	WriteStdout("closed tab %s\n", tabId)
	return nil
}

func tabRenameRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
	}()

	wsId, err := resolveWorkspaceId()
	if err != nil {
		return err
	}
	tabId, err := resolveTabRef(wsId, args[0])
	if err != nil {
		return err
	}
	newName := args[1]
	err = wshclient.UpdateTabNameCommand(RpcClient, tabId, newName, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("renaming tab: %w", err)
	}
	WriteStdout("renamed tab %s to %q\n", tabId, newName)
	return nil
}
