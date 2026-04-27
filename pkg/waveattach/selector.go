// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"fmt"
	"os"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"golang.org/x/term"
)

type blockEntry struct {
	BlockId       string
	WorkspaceName string
	TabName       string
	Cwd           string
}

func ListTermBlocks(rpcClient *wshutil.WshRpc) ([]blockEntry, error) {
	allBlocks, err := wshclient.BlocksListCommand(rpcClient, wshrpc.BlocksListRequest{}, nil)
	if err != nil {
		return nil, fmt.Errorf("listing blocks: %w", err)
	}

	wsCache := make(map[string]string)
	tabCache := make(map[string]string)

	var entries []blockEntry
	for _, blk := range allBlocks {
		view := blk.Meta.GetString("view", "")
		if view != "term" {
			continue
		}

		wsName, ok := wsCache[blk.WorkspaceId]
		if !ok {
			wsList, err := wshclient.WorkspaceListCommand(rpcClient, nil)
			if err == nil {
				for _, ws := range wsList {
					if ws.WorkspaceData != nil {
						wsCache[ws.WorkspaceData.OID] = ws.WorkspaceData.Name
					}
				}
			}
			wsName = wsCache[blk.WorkspaceId]
			if wsName == "" {
				wsName = blk.WorkspaceId[:8]
			}
			wsCache[blk.WorkspaceId] = wsName
		}

		tabName, ok := tabCache[blk.TabId]
		if !ok {
			tab, err := wshclient.GetTabCommand(rpcClient, blk.TabId, nil)
			if err == nil && tab != nil {
				tabName = tab.Name
			}
			if tabName == "" {
				tabName = blk.TabId[:8]
			}
			tabCache[blk.TabId] = tabName
		}

		cwd := blk.Meta.GetString("cmd:cwd", "")

		entries = append(entries, blockEntry{
			BlockId:       blk.BlockId,
			WorkspaceName: wsName,
			TabName:       tabName,
			Cwd:           cwd,
		})
	}
	return entries, nil
}

func SelectBlock(rpcClient *wshutil.WshRpc) (string, error) {
	entries, err := ListTermBlocks(rpcClient)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return "", fmt.Errorf("no running term blocks found")
	}
	if len(entries) == 1 {
		return entries[0].BlockId, nil
	}
	return runInteractiveSelector(entries)
}

func runInteractiveSelector(entries []blockEntry) (string, error) {
	fd := int(os.Stdin.Fd())
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return "", fmt.Errorf("entering raw mode: %w", err)
	}
	defer term.Restore(fd, oldState)

	cur := 0
	render := func() {
		var sb strings.Builder
		sb.WriteString("\r\n选择要 attach 的 Block：\r\n\r\n")
		for i, e := range entries {
			prefix := "  "
			if i == cur {
				prefix = "\033[7m▶"
			}
			cwd := e.Cwd
			if cwd == "" {
				cwd = "—"
			}
			line := fmt.Sprintf("%s [%d] term  │ workspace: %-16s │ tab: %-12s │ cwd: %s",
				prefix, i+1, e.WorkspaceName, e.TabName, cwd)
			if i == cur {
				line += "\033[0m"
			}
			sb.WriteString(line + "\r\n")
		}
		sb.WriteString("\r\n↑/↓ 选择  Enter 确认  q 退出  │ block: ")
		sb.WriteString(entries[cur].BlockId)
		sb.WriteString("\r\n")

		totalLines := len(entries) + 5
		fmt.Fprint(os.Stderr, sb.String())
		// move cursor back up to allow re-rendering
		fmt.Fprintf(os.Stderr, "\033[%dA", totalLines)
	}

	clear := func() {
		totalLines := len(entries) + 5
		for i := 0; i < totalLines; i++ {
			fmt.Fprint(os.Stderr, "\033[2K\r\n")
		}
		fmt.Fprintf(os.Stderr, "\033[%dA", totalLines)
	}

	render()

	buf := make([]byte, 4)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil {
			return "", err
		}
		b := buf[:n]

		switch {
		case n == 1 && (b[0] == 'q' || b[0] == 3): // q or Ctrl-C
			clear()
			return "", fmt.Errorf("cancelled")
		case n == 1 && b[0] == 13: // Enter
			selected := entries[cur].BlockId
			clear()
			return selected, nil
		case n == 3 && b[0] == 27 && b[1] == '[' && b[2] == 'A': // up arrow
			if cur > 0 {
				cur--
			}
		case n == 3 && b[0] == 27 && b[1] == '[' && b[2] == 'B': // down arrow
			if cur < len(entries)-1 {
				cur++
			}
		}

		clear()
		render()
	}
}
