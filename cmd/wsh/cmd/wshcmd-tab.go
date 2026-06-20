// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var tabCmd = &cobra.Command{
	Use:   "tab",
	Short: "Manage tabs",
}

var tabCreateCmd = &cobra.Command{
	Use:                   "create [-w workspaceid] [-n name] [--no-activate]",
	Short:                 "Create a new tab in a workspace",
	Args:                  cobra.NoArgs,
	RunE:                  tabCreateRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var tabRenameCmd = &cobra.Command{
	Use:                   "rename [-t tabid] <name>",
	Short:                 "Rename a tab",
	Args:                  cobra.ExactArgs(1),
	RunE:                  tabRenameRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var tabFocusCmd = &cobra.Command{
	Use:                   "focus <tabid>",
	Short:                 "Focus (activate) a tab",
	Args:                  cobra.ExactArgs(1),
	RunE:                  tabFocusRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	tabCreateFlagWorkspaceId string
	tabCreateFlagName        string
	tabCreateFlagNoActivate  bool
	tabCreateFlagMeta        []string
	tabRenameFlagTabId       string
)

func init() {
	rootCmd.AddCommand(tabCmd)
	tabCmd.AddCommand(tabCreateCmd)
	tabCmd.AddCommand(tabRenameCmd)
	tabCmd.AddCommand(tabFocusCmd)

	tabCreateCmd.Flags().StringVarP(&tabCreateFlagWorkspaceId, "workspace", "w", "", "workspace id (defaults to the caller's workspace)")
	tabCreateCmd.Flags().StringVarP(&tabCreateFlagName, "name", "n", "", "tab name (defaults to next auto-generated name)")
	tabCreateCmd.Flags().BoolVar(&tabCreateFlagNoActivate, "no-activate", false, "do not switch focus to the newly created tab")
	tabCreateCmd.Flags().StringArrayVar(&tabCreateFlagMeta, "meta", nil, "metadata key=value pairs (repeatable)")

	tabRenameCmd.Flags().StringVarP(&tabRenameFlagTabId, "tab", "t", "", "tab id to rename (defaults to WAVETERM_TABID)")
}

func tabCreateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("tab:create", rtnErr == nil)
	}()

	var metaMap map[string]string
	if len(tabCreateFlagMeta) > 0 {
		metaMap = make(map[string]string, len(tabCreateFlagMeta))
		for _, kv := range tabCreateFlagMeta {
			idx := strings.IndexByte(kv, '=')
			if idx <= 0 {
				return fmt.Errorf("--meta value %q must be in key=value format with a non-empty key", kv)
			}
			metaMap[kv[:idx]] = kv[idx+1:]
		}
	}
	data := wshrpc.CommandCreateTabData{
		WorkspaceId: tabCreateFlagWorkspaceId,
		TabName:     tabCreateFlagName,
		ActivateTab: !tabCreateFlagNoActivate,
		Meta:        metaMap,
	}
	tabId, err := wshclient.CreateTabCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("creating tab: %w", err)
	}
	WriteStdout("%s", tabId)
	if getIsTty() {
		WriteStdout("\n")
	}
	return nil
}

func tabRenameRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("tab:rename", rtnErr == nil)
	}()

	tabId := tabRenameFlagTabId
	if tabId == "" {
		tabId = os.Getenv("WAVETERM_TABID")
	}
	if tabId == "" {
		return fmt.Errorf("tab id required (pass --tab or set WAVETERM_TABID)")
	}
	name := args[0]
	err := wshclient.UpdateTabNameCommand(RpcClient, tabId, name, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("renaming tab: %w", err)
	}
	WriteStdout("tab renamed\n")
	return nil
}

func tabFocusRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("tab:focus", rtnErr == nil)
	}()

	tabId := args[0]
	err := wshclient.FocusTabCommand(RpcClient, tabId, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("focusing tab: %w", err)
	}
	return nil
}
