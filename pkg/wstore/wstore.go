// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

func init() {
	for _, rtype := range waveobj.AllWaveObjTypes() {
		waveobj.RegisterType(rtype)
	}
}

func CreateTab(ctx context.Context, workspaceId string, name string) (*waveobj.Tab, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*waveobj.Tab, error) {
		ws, _ := DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if ws == nil {
			return nil, fmt.Errorf("workspace not found: %q", workspaceId)
		}
		layoutStateId := uuid.NewString()
		tab := &waveobj.Tab{
			OID:         uuid.NewString(),
			Name:        name,
			BlockIds:    []string{},
			LayoutState: layoutStateId,
		}
		layoutState := &waveobj.LayoutState{
			OID: layoutStateId,
		}
		ws.TabIds = append(ws.TabIds, tab.OID)
		DBInsert(tx.Context(), tab)
		DBInsert(tx.Context(), layoutState)
		DBUpdate(tx.Context(), ws)
		return tab, nil
	})
}

func CreateWorkspace(ctx context.Context) (*waveobj.Workspace, error) {
	ws := &waveobj.Workspace{
		OID:    uuid.NewString(),
		TabIds: []string{},
	}
	DBInsert(ctx, ws)
	return ws, nil
}

func UpdateWorkspaceTabIds(ctx context.Context, workspaceId string, tabIds []string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		ws, _ := DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		ws.TabIds = tabIds
		DBUpdate(tx.Context(), ws)
		return nil
	})
}

func SetActiveTab(ctx context.Context, windowId string, tabId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		window, _ := DBGet[*waveobj.Window](tx.Context(), windowId)
		if window == nil {
			return fmt.Errorf("window not found: %q", windowId)
		}
		if tabId != "" {
			tab, _ := DBGet[*waveobj.Tab](tx.Context(), tabId)
			if tab == nil {
				return fmt.Errorf("tab not found: %q", tabId)
			}
		}
		window.ActiveTabId = tabId
		DBUpdate(tx.Context(), window)
		return nil
	})
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

func CreateBlock(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (*waveobj.Block, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*waveobj.Block, error) {
		tab, _ := DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return nil, fmt.Errorf("tab not found: %q", tabId)
		}
		blockId := uuid.NewString()
		blockData := &waveobj.Block{
			OID:         blockId,
			BlockDef:    blockDef,
			RuntimeOpts: rtOpts,
			Meta:        blockDef.Meta,
		}
		DBInsert(tx.Context(), blockData)
		tab.BlockIds = append(tab.BlockIds, blockId)
		DBUpdate(tx.Context(), tab)
		return blockData, nil
	})
}

func findStringInSlice(slice []string, val string) int {
	for idx, v := range slice {
		if v == val {
			return idx
		}
	}
	return -1
}

func DeleteBlock(ctx context.Context, tabId string, blockId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		tab, _ := DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		blockIdx := findStringInSlice(tab.BlockIds, blockId)
		if blockIdx == -1 {
			return nil
		}
		tab.BlockIds = append(tab.BlockIds[:blockIdx], tab.BlockIds[blockIdx+1:]...)
		DBUpdate(tx.Context(), tab)
		DBDelete(tx.Context(), waveobj.OType_Block, blockId)
		return nil
	})
}

// must delete all blocks individually first
// also deletes LayoutState
func DeleteTab(ctx context.Context, workspaceId string, tabId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		ws, _ := DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		tab, _ := DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		if len(tab.BlockIds) != 0 {
			return fmt.Errorf("tab has blocks, must delete blocks first")
		}
		tabIdx := findStringInSlice(ws.TabIds, tabId)
		if tabIdx == -1 {
			return nil
		}
		ws.TabIds = append(ws.TabIds[:tabIdx], ws.TabIds[tabIdx+1:]...)
		DBUpdate(tx.Context(), ws)
		DBDelete(tx.Context(), waveobj.OType_Tab, tabId)
		DBDelete(tx.Context(), waveobj.OType_LayoutState, tab.LayoutState)
		return nil
	})
}

func UpdateObjectMeta(ctx context.Context, oref waveobj.ORef, meta waveobj.MetaMapType) error {
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
		newMeta := waveobj.MergeMeta(objMeta, meta)
		waveobj.SetMeta(obj, newMeta)
		DBUpdate(tx.Context(), obj)
		return nil
	})
}

func MoveBlockToTab(ctx context.Context, currentTabId string, newTabId string, blockId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		currentTab, _ := DBGet[*waveobj.Tab](tx.Context(), currentTabId)
		if currentTab == nil {
			return fmt.Errorf("current tab not found: %q", currentTabId)
		}
		newTab, _ := DBGet[*waveobj.Tab](tx.Context(), newTabId)
		if newTab == nil {
			return fmt.Errorf("new tab not found: %q", newTabId)
		}
		blockIdx := findStringInSlice(currentTab.BlockIds, blockId)
		if blockIdx == -1 {
			return fmt.Errorf("block not found in current tab: %q", blockId)
		}
		currentTab.BlockIds = utilfn.RemoveElemFromSlice(currentTab.BlockIds, blockId)
		newTab.BlockIds = append(newTab.BlockIds, blockId)
		DBUpdate(tx.Context(), currentTab)
		DBUpdate(tx.Context(), newTab)
		return nil
	})
}
