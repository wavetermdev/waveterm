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
			Controller:  blockDef.Controller,
			View:        blockDef.View,
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

func CloseTab(ctx context.Context, workspaceId string, tabId string) error {
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

func UpdateMeta(ctx context.Context, oref waveobj.ORef, meta map[string]any) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		obj, _ := DBGetORef(tx.Context(), oref)
		if obj == nil {
			return fmt.Errorf("object not found: %q", oref)
		}
		// obj.SetMeta(meta)
		DBUpdate(tx.Context(), obj)
		return nil
	})
}

func UpdateObjectMeta(ctx context.Context, oref waveobj.ORef, meta map[string]any) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		obj, _ := DBGetORef(tx.Context(), oref)
		if obj == nil {
			return fmt.Errorf("object not found: %q", oref)
		}
		objMeta := waveobj.GetMeta(obj)
		if objMeta == nil {
			objMeta = make(map[string]any)
		}
		for k, v := range meta {
			if v == nil {
				delete(objMeta, k)
				continue
			}
			objMeta[k] = v
		}
		waveobj.SetMeta(obj, objMeta)
		DBUpdate(tx.Context(), obj)
		return nil
	})
}

func EnsureInitialData() error {
	// does not need to run in a transaction since it is called on startup
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	clientCount, err := DBGetCount[*Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client count: %w", err)
	}
	if clientCount > 0 {
		return nil
	}
	windowId := uuid.NewString()
	workspaceId := uuid.NewString()
	tabId := uuid.NewString()
	layoutNodeId := uuid.NewString()
	client := &Client{
		OID:          uuid.NewString(),
		MainWindowId: windowId,
	}
	err = DBInsert(ctx, client)
	if err != nil {
		return fmt.Errorf("error inserting client: %w", err)
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
		WinSize: WinSize{
			Width:  800,
			Height: 600,
		},
	}
	err = DBInsert(ctx, window)
	if err != nil {
		return fmt.Errorf("error inserting window: %w", err)
	}
	ws := &Workspace{
		OID:    workspaceId,
		Name:   "default",
		TabIds: []string{tabId},
	}
	err = DBInsert(ctx, ws)
	if err != nil {
		return fmt.Errorf("error inserting workspace: %w", err)
	}
	tab := &Tab{
		OID:        tabId,
		Name:       "Tab-1",
		BlockIds:   []string{},
		LayoutNode: layoutNodeId,
	}
	err = DBInsert(ctx, tab)
	if err != nil {
		return fmt.Errorf("error inserting tab: %w", err)
	}

	layoutNode := &LayoutNode{
		OID: layoutNodeId,
	}
	err = DBInsert(ctx, layoutNode)
	if err != nil {
		return fmt.Errorf("error inserting layout node: %w", err)
	}
	return nil
}
