// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func init() {
	for _, rtype := range waveobj.AllWaveObjTypes() {
		waveobj.RegisterType(rtype)
	}
}

func UpdateTabName(ctx context.Context, tabId, name string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		tab, _ := DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		if tabId != "" {
			tab.Name = name
			DBUpdate(tx.Context(), tab)
		}
		return nil
	})
}

// must delete all blocks individually first
// also deletes LayoutState
func DeleteTab(ctx context.Context, workspaceId string, tabId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		tab, _ := DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return nil
		}
		if len(tab.BlockIds) != 0 {
			return fmt.Errorf("tab has blocks, must delete blocks first")
		}
		ws, _ := DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if ws != nil {
			ws.TabIds = utilfn.RemoveElemFromSlice(ws.TabIds, tabId)
			DBUpdate(tx.Context(), ws)
		}
		DBDelete(tx.Context(), waveobj.OType_Tab, tabId)
		DBDelete(tx.Context(), waveobj.OType_LayoutState, tab.LayoutState)
		return nil
	})
}

func UpdateObjectMeta(ctx context.Context, oref waveobj.ORef, meta waveobj.MetaMapType, mergeSpecial bool) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		if oref.IsEmpty() {
			return fmt.Errorf("empty object reference")
		}
		obj, _ := DBGetORef(tx.Context(), oref)
		if obj == nil {
			return ErrNotFound
		}
		objMeta := waveobj.GetMeta(obj)
		if objMeta == nil {
			objMeta = make(map[string]any)
		}
		newMeta := waveobj.MergeMeta(objMeta, meta, mergeSpecial)
		waveobj.SetMeta(obj, newMeta)
		DBUpdate(tx.Context(), obj)
		return nil
	})
}

func MoveBlockToTab(ctx context.Context, currentTabId string, newTabId string, blockId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		block, _ := DBGet[*waveobj.Block](tx.Context(), blockId)
		if block == nil {
			return fmt.Errorf("block not found: %q", blockId)
		}
		currentTab, _ := DBGet[*waveobj.Tab](tx.Context(), currentTabId)
		if currentTab == nil {
			return fmt.Errorf("current tab not found: %q", currentTabId)
		}
		newTab, _ := DBGet[*waveobj.Tab](tx.Context(), newTabId)
		if newTab == nil {
			return fmt.Errorf("new tab not found: %q", newTabId)
		}
		blockIdx := utilfn.FindStringInSlice(currentTab.BlockIds, blockId)
		if blockIdx == -1 {
			return fmt.Errorf("block not found in current tab: %q", blockId)
		}
		currentTab.BlockIds = utilfn.RemoveElemFromSlice(currentTab.BlockIds, blockId)
		newTab.BlockIds = append(newTab.BlockIds, blockId)
		block.ParentORef = waveobj.MakeORef(waveobj.OType_Tab, newTabId).String()
		DBUpdate(tx.Context(), block)
		DBUpdate(tx.Context(), currentTab)
		DBUpdate(tx.Context(), newTab)
		return nil
	})
}
