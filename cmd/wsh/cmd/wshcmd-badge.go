// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"runtime"
	"strings"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var badgeCmd = &cobra.Command{
	Use:     "badge [icon]",
	Short:   "set or clear a block badge",
	Args:    cobra.MaximumNArgs(1),
	RunE:    badgeRun,
	PreRunE: preRunSetupRpcClient,
}

var (
	badgeColor       string
	badgePriority    float64
	badgeClear       bool
	badgeBeep        bool
	badgeSound       string
	badgeBorder      bool
	badgeBorderColor string
	badgePid         int
)

func init() {
	rootCmd.AddCommand(badgeCmd)
	badgeCmd.Flags().StringVar(&badgeColor, "color", "", "badge color")
	badgeCmd.Flags().Float64Var(&badgePriority, "priority", 10, "badge priority")
	badgeCmd.Flags().BoolVar(&badgeClear, "clear", false, "clear the badge")
	badgeCmd.Flags().BoolVar(&badgeBeep, "beep", false, "play system bell sound (alias for --sound system)")
	badgeCmd.Flags().StringVar(&badgeSound, "sound", "", "play a sound preset (system, chime, ping, gentle) or custom .mp3 filename from ~/.waveterm/sounds/")
	badgeCmd.Flags().BoolVar(&badgeBorder, "border", false, "show a persistent border highlight on the block")
	badgeCmd.Flags().StringVar(&badgeBorderColor, "border-color", "", "border color override (defaults to --color, then #fbbf24)")
	badgeCmd.Flags().IntVar(&badgePid, "pid", 0, "watch a pid and automatically clear the badge when it exits (default priority 5)")
}

func badgeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("badge", rtnErr == nil)
	}()

	if badgePid > 0 && runtime.GOOS == "windows" {
		return fmt.Errorf("--pid flag is not supported on Windows")
	}
	if badgePid > 0 && !cmd.Flags().Changed("priority") {
		badgePriority = 5
	}

	// --beep is an alias for --sound system
	resolvedSound := badgeSound
	if badgeBeep && resolvedSound == "" {
		resolvedSound = "system"
	}

	// Validate custom sound filename (no path traversal)
	if resolvedSound != "" && resolvedSound != "system" {
		if strings.Contains(resolvedSound, "/") || strings.Contains(resolvedSound, "\\") || strings.Contains(resolvedSound, "..") {
			return fmt.Errorf("custom sound filename must not contain path separators or '..'")
		}
	}

	oref, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving block: %v", err)
	}
	if oref.OType != waveobj.OType_Block && oref.OType != waveobj.OType_Tab {
		return fmt.Errorf("badge oref must be a block or tab (got %q)", oref.OType)
	}

	var eventData baseds.BadgeEvent
	eventData.ORef = oref.String()

	if badgeClear {
		eventData.Clear = true
	} else {
		eventData.Sound = resolvedSound
		eventData.Border = badgeBorder
		eventData.BorderColor = badgeBorderColor

		icon := "circle-small"
		if len(args) > 0 {
			icon = args[0]
		}
		badgeId, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("generating badge id: %v", err)
		}
		eventData.Badge = &baseds.Badge{
			BadgeId:   badgeId.String(),
			Icon:      icon,
			Color:     badgeColor,
			Priority:  badgePriority,
			PidLinked: badgePid > 0,
		}
	}

	event := wps.WaveEvent{
		Event:  wps.Event_Badge,
		Scopes: []string{oref.String()},
		Data:   eventData,
	}

	err = wshclient.EventPublishCommand(RpcClient, event, &wshrpc.RpcOpts{NoResponse: true})
	if err != nil {
		return fmt.Errorf("publishing badge event: %v", err)
	}

	if badgePid > 0 && eventData.Badge != nil {
		conn := RpcContext.Conn
		if conn == "" {
			conn = wshrpc.LocalConnName
		}
		connRoute := wshutil.MakeConnectionRouteId(conn)
		watchData := wshrpc.CommandBadgeWatchPidData{
			Pid:     badgePid,
			ORef:    *oref,
			BadgeId: eventData.Badge.BadgeId,
		}
		err = wshclient.BadgeWatchPidCommand(RpcClient, watchData, &wshrpc.RpcOpts{Route: connRoute})
		if err != nil {
			return fmt.Errorf("watching pid: %v", err)
		}
	}

	if badgeClear {
		fmt.Printf("badge cleared\n")
	} else {
		fmt.Printf("badge set\n")
	}
	return nil
}
