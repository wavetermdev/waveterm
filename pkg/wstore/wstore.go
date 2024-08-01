// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

var waveObjUpdateKey = struct{}{}

type UpdatesRtnType = []WaveObjUpdate

func init() {
	for _, rtype := range AllWaveObjTypes() {
		waveobj.RegisterType(rtype)
	}
}

type contextUpdatesType struct {
	UpdatesStack []map[waveobj.ORef]WaveObjUpdate
}

func dumpUpdateStack(updates *contextUpdatesType) {
	log.Printf("dumpUpdateStack len:%d\n", len(updates.UpdatesStack))
	for idx, update := range updates.UpdatesStack {
		var buf bytes.Buffer
		buf.WriteString(fmt.Sprintf("  [%d]:", idx))
		for k := range update {
			buf.WriteString(fmt.Sprintf(" %s:%s", k.OType, k.OID))
		}
		buf.WriteString("\n")
		log.Print(buf.String())
	}
}

func ContextWithUpdates(ctx context.Context) context.Context {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal != nil {
		return ctx
	}
	return context.WithValue(ctx, waveObjUpdateKey, &contextUpdatesType{
		UpdatesStack: []map[waveobj.ORef]WaveObjUpdate{make(map[waveobj.ORef]WaveObjUpdate)},
	})
}

func ContextGetUpdates(ctx context.Context) map[waveobj.ORef]WaveObjUpdate {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return nil
	}
	updates := updatesVal.(*contextUpdatesType)
	if len(updates.UpdatesStack) == 1 {
		return updates.UpdatesStack[0]
	}
	rtn := make(map[waveobj.ORef]WaveObjUpdate)
	for _, update := range updates.UpdatesStack {
		for k, v := range update {
			rtn[k] = v
		}
	}
	return rtn
}

func ContextGetUpdatesRtn(ctx context.Context) UpdatesRtnType {
	updatesMap := ContextGetUpdates(ctx)
	if updatesMap == nil {
		return nil
	}
	rtn := make(UpdatesRtnType, 0, len(updatesMap))
	for _, v := range updatesMap {
		rtn = append(rtn, v)
	}
	return rtn
}

func ContextGetUpdate(ctx context.Context, oref waveobj.ORef) *WaveObjUpdate {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return nil
	}
	updates := updatesVal.(*contextUpdatesType)
	for idx := len(updates.UpdatesStack) - 1; idx >= 0; idx-- {
		if obj, ok := updates.UpdatesStack[idx][oref]; ok {
			return &obj
		}
	}
	return nil
}

func ContextAddUpdate(ctx context.Context, update WaveObjUpdate) {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return
	}
	updates := updatesVal.(*contextUpdatesType)
	oref := waveobj.ORef{
		OType: update.OType,
		OID:   update.OID,
	}
	updates.UpdatesStack[len(updates.UpdatesStack)-1][oref] = update
}

func ContextUpdatesBeginTx(ctx context.Context) context.Context {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return ctx
	}
	updates := updatesVal.(*contextUpdatesType)
	updates.UpdatesStack = append(updates.UpdatesStack, make(map[waveobj.ORef]WaveObjUpdate))
	return ctx
}

func ContextUpdatesCommitTx(ctx context.Context) {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return
	}
	updates := updatesVal.(*contextUpdatesType)
	if len(updates.UpdatesStack) <= 1 {
		panic(fmt.Errorf("no updates transaction to commit"))
	}
	// merge the last two updates
	curUpdateMap := updates.UpdatesStack[len(updates.UpdatesStack)-1]
	prevUpdateMap := updates.UpdatesStack[len(updates.UpdatesStack)-2]
	for k, v := range curUpdateMap {
		prevUpdateMap[k] = v
	}
	updates.UpdatesStack = updates.UpdatesStack[:len(updates.UpdatesStack)-1]
}

func ContextUpdatesRollbackTx(ctx context.Context) {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return
	}
	updates := updatesVal.(*contextUpdatesType)
	if len(updates.UpdatesStack) <= 1 {
		panic(fmt.Errorf("no updates transaction to rollback"))
	}
	updates.UpdatesStack = updates.UpdatesStack[:len(updates.UpdatesStack)-1]
}

func CreateTab(ctx context.Context, workspaceId string, name string) (*Tab, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*Tab, error) {
		ws, _ := DBGet[*Workspace](tx.Context(), workspaceId)
		if ws == nil {
			return nil, fmt.Errorf("workspace not found: %q", workspaceId)
		}
		layoutNodeId := uuid.NewString()
		tab := &Tab{
			OID:        uuid.NewString(),
			Name:       name,
			BlockIds:   []string{},
			LayoutNode: layoutNodeId,
		}
		layoutNode := &LayoutNode{
			OID: layoutNodeId,
		}
		ws.TabIds = append(ws.TabIds, tab.OID)
		DBInsert(tx.Context(), tab)
		DBInsert(tx.Context(), layoutNode)
		DBUpdate(tx.Context(), ws)
		return tab, nil
	})
}

func CreateWorkspace(ctx context.Context) (*Workspace, error) {
	ws := &Workspace{
		OID:    uuid.NewString(),
		TabIds: []string{},
	}
	DBInsert(ctx, ws)
	return ws, nil
}

func UpdateWorkspaceTabIds(ctx context.Context, workspaceId string, tabIds []string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		ws, _ := DBGet[*Workspace](tx.Context(), workspaceId)
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
		window, _ := DBGet[*Window](tx.Context(), windowId)
		if window == nil {
			return fmt.Errorf("window not found: %q", windowId)
		}
		if tabId != "" {
			tab, _ := DBGet[*Tab](tx.Context(), tabId)
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
		tab, _ := DBGet[*Tab](tx.Context(), tabId)
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

func CreateBlock(ctx context.Context, tabId string, blockDef *BlockDef, rtOpts *RuntimeOpts) (*Block, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*Block, error) {
		tab, _ := DBGet[*Tab](tx.Context(), tabId)
		if tab == nil {
			return nil, fmt.Errorf("tab not found: %q", tabId)
		}
		blockId := uuid.NewString()
		blockData := &Block{
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
		tab, _ := DBGet[*Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		blockIdx := findStringInSlice(tab.BlockIds, blockId)
		if blockIdx == -1 {
			return nil
		}
		tab.BlockIds = append(tab.BlockIds[:blockIdx], tab.BlockIds[blockIdx+1:]...)
		DBUpdate(tx.Context(), tab)
		DBDelete(tx.Context(), OType_Block, blockId)
		return nil
	})
}

func DeleteTab(ctx context.Context, workspaceId string, tabId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		ws, _ := DBGet[*Workspace](tx.Context(), workspaceId)
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		tab, _ := DBGet[*Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		tabIdx := findStringInSlice(ws.TabIds, tabId)
		if tabIdx == -1 {
			return nil
		}
		ws.TabIds = append(ws.TabIds[:tabIdx], ws.TabIds[tabIdx+1:]...)
		DBUpdate(tx.Context(), ws)
		DBDelete(tx.Context(), OType_Tab, tabId)
		DBDelete(tx.Context(), OType_LayoutNode, tab.LayoutNode)
		for _, blockId := range tab.BlockIds {
			DBDelete(tx.Context(), OType_Block, blockId)
		}
		return nil
	})
}

func UpdateObjectMeta(ctx context.Context, oref waveobj.ORef, meta MetaMapType) error {
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
		newMeta := MergeMeta(objMeta, meta)
		waveobj.SetMeta(obj, newMeta)
		DBUpdate(tx.Context(), obj)
		return nil
	})
}

func CreateWindow(ctx context.Context, winSize *WinSize) (*Window, error) {
	windowId := uuid.NewString()
	workspaceId := uuid.NewString()
	tabId := uuid.NewString()
	layoutNodeId := uuid.NewString()
	if winSize == nil {
		winSize = &WinSize{
			Width:  1200,
			Height: 800,
		}
	}
	window := &Window{
		OID:            windowId,
		WorkspaceId:    workspaceId,
		ActiveTabId:    tabId,
		ActiveBlockMap: make(map[string]string),
		Pos: Point{
			X: 100,
			Y: 100,
		},
		WinSize: *winSize,
	}
	err := DBInsert(ctx, window)
	if err != nil {
		return nil, fmt.Errorf("error inserting window: %w", err)
	}
	ws := &Workspace{
		OID:    workspaceId,
		Name:   "w" + workspaceId[0:8],
		TabIds: []string{tabId},
	}
	err = DBInsert(ctx, ws)
	if err != nil {
		return nil, fmt.Errorf("error inserting workspace: %w", err)
	}
	tab := &Tab{
		OID:        tabId,
		Name:       "T1",
		BlockIds:   []string{},
		LayoutNode: layoutNodeId,
	}
	err = DBInsert(ctx, tab)
	if err != nil {
		return nil, fmt.Errorf("error inserting tab: %w", err)
	}

	layoutNode := &LayoutNode{
		OID: layoutNodeId,
	}
	err = DBInsert(ctx, layoutNode)
	if err != nil {
		return nil, fmt.Errorf("error inserting layout node: %w", err)
	}
	client, err := DBGetSingleton[*Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client: %w", err)
	}
	client.WindowIds = append(client.WindowIds, windowId)
	err = DBUpdate(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error updating client: %w", err)
	}
	return DBMustGet[*Window](ctx, windowId)
}

func MoveBlockToTab(ctx context.Context, currentTabId string, newTabId string, blockId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		currentTab, _ := DBGet[*Tab](tx.Context(), currentTabId)
		if currentTab == nil {
			return fmt.Errorf("current tab not found: %q", currentTabId)
		}
		newTab, _ := DBGet[*Tab](tx.Context(), newTabId)
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

func CreateClient(ctx context.Context) (*Client, error) {
	client := &Client{
		OID:       uuid.NewString(),
		WindowIds: []string{},
	}
	err := DBInsert(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error inserting client: %w", err)
	}
	return client, nil
}

func EnsureInitialData() error {
	// does not need to run in a transaction since it is called on startup
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	client, err := DBGetSingleton[*Client](ctx)
	if err == ErrNotFound {
		client, err = CreateClient(ctx)
		if err != nil {
			return fmt.Errorf("error creating client: %w", err)
		}
	}
	if len(client.WindowIds) > 0 {
		return nil
	}
	_, err = CreateWindow(ctx, &WinSize{0, 0})
	if err != nil {
		return fmt.Errorf("error creating window: %w", err)
	}
	return nil
}
