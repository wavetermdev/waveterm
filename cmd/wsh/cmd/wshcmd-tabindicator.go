// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var tabIndicatorCmd = &cobra.Command{
	Use:     "tabindicator [icon]",
	Short:   "set or clear a tab indicator",
	Args:    cobra.MaximumNArgs(1),
	RunE:    tabIndicatorRun,
	PreRunE: preRunSetupRpcClient,
}

var (
	tabIndicatorTabId      string
	tabIndicatorColor      string
	tabIndicatorPriority   float64
	tabIndicatorClear      bool
	tabIndicatorPersistent bool
	tabIndicatorBeep       bool
)

func init() {
	rootCmd.AddCommand(tabIndicatorCmd)
	tabIndicatorCmd.Flags().StringVar(&tabIndicatorTabId, "tabid", "", "tab id (defaults to WAVETERM_TABID)")
	tabIndicatorCmd.Flags().StringVar(&tabIndicatorColor, "color", "", "indicator color")
	tabIndicatorCmd.Flags().Float64Var(&tabIndicatorPriority, "priority", 0, "indicator priority")
	tabIndicatorCmd.Flags().BoolVar(&tabIndicatorClear, "clear", false, "clear the indicator")
	tabIndicatorCmd.Flags().BoolVar(&tabIndicatorPersistent, "persistent", false, "make indicator persistent (don't clear on focus)")
	tabIndicatorCmd.Flags().BoolVar(&tabIndicatorBeep, "beep", false, "play system bell sound")
}

func tabIndicatorRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("tabindicator", rtnErr == nil)
	}()

	tabId := tabIndicatorTabId
	if tabId == "" {
		tabId = os.Getenv("WAVETERM_TABID")
	}
	if tabId == "" {
		return fmt.Errorf("no tab id specified (use --tabid or set WAVETERM_TABID)")
	}

	var indicator *wshrpc.TabIndicator
	if !tabIndicatorClear {
		icon := "bell"
		if len(args) > 0 {
			icon = args[0]
		}
		indicator = &wshrpc.TabIndicator{
			Icon:         icon,
			Color:        tabIndicatorColor,
			Priority:     tabIndicatorPriority,
			ClearOnFocus: !tabIndicatorPersistent,
		}
	}

	eventData := wshrpc.TabIndicatorEventData{
		TabId:     tabId,
		Indicator: indicator,
	}

	event := wps.WaveEvent{
		Event:  wps.Event_TabIndicator,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Tab, tabId).String()},
		Data:   eventData,
	}

	err := wshclient.EventPublishCommand(RpcClient, event, &wshrpc.RpcOpts{NoResponse: true})
	if err != nil {
		return fmt.Errorf("publishing tab indicator event: %v", err)
	}

	if tabIndicatorBeep {
		err = wshclient.ElectronSystemBellCommand(RpcClient, &wshrpc.RpcOpts{Route: "electron"})
		if err != nil {
			return fmt.Errorf("playing system bell: %v", err)
		}
	}

	if tabIndicatorClear {
		fmt.Printf("tab indicator cleared\n")
	} else {
		fmt.Printf("tab indicator set\n")
	}
	return nil
}
