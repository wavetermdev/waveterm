// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package objectservice

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

type ObjectService struct{}

const DefaultTimeout = 2 * time.Second

func parseORef(oref string) (*waveobj.ORef, error) {
	fields := strings.Split(oref, ":")
	if len(fields) != 2 {
		return nil, fmt.Errorf("invalid object reference: %q", oref)
	}
	return &waveobj.ORef{OType: fields[0], OID: fields[1]}, nil
}

func (svc *ObjectService) GetObject_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get wave object by oref",
		ArgNames: []string{"oref"},
	}
}

func (svc *ObjectService) GetObject(orefStr string) (waveobj.WaveObj, error) {
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, err
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	obj, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	return obj, nil
}

func (svc *ObjectService) GetObjects_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"orefs"},
		ReturnDesc: "objects",
	}
}

func (svc *ObjectService) GetObjects(orefStrArr []string) ([]waveobj.WaveObj, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	var orefArr []waveobj.ORef
	for _, orefStr := range orefStrArr {
		orefObj, err := parseORef(orefStr)
		if err != nil {
			return nil, err
		}
		orefArr = append(orefArr, *orefObj)
	}
	return wstore.DBSelectORefs(ctx, orefArr)
}

func (svc *ObjectService) AddTabToWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"uiContext", "tabName", "activateTab"},
		ReturnDesc: "tabId",
	}
}

func (svc *ObjectService) AddTabToWorkspace(uiContext wstore.UIContext, tabName string, activateTab bool) (string, wstore.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	windowData, err := wstore.DBMustGet[*wstore.Window](ctx, uiContext.WindowId)
	if err != nil {
		return "", nil, fmt.Errorf("error getting window: %w", err)
	}
	tab, err := wstore.CreateTab(ctx, windowData.WorkspaceId, tabName)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab: %w", err)
	}
	if activateTab {
		err = wstore.SetActiveTab(ctx, uiContext.WindowId, tab.OID)
		if err != nil {
			return "", nil, fmt.Errorf("error setting active tab: %w", err)
		}
	}
	return tab.OID, wstore.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) UpdateWorkspaceTabIds_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "workspaceId", "tabIds"},
	}
}

func (svc *ObjectService) UpdateWorkspaceTabIds(uiContext wstore.UIContext, workspaceId string, tabIds []string) (wstore.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	err := wstore.UpdateWorkspaceTabIds(ctx, workspaceId, tabIds)
	if err != nil {
		return nil, fmt.Errorf("error updating workspace tab ids: %w", err)
	}
	return wstore.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) SetActiveTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "tabId"},
	}
}

func (svc *ObjectService) SetActiveTab(uiContext wstore.UIContext, tabId string) (wstore.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	err := wstore.SetActiveTab(ctx, uiContext.WindowId, tabId)
	if err != nil {
		return nil, fmt.Errorf("error setting active tab: %w", err)
	}
	// check all blocks in tab and start controllers (if necessary)
	tab, err := wstore.DBMustGet[*wstore.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	for _, blockId := range tab.BlockIds {
		blockErr := blockcontroller.StartBlockController(ctx, blockId)
		if blockErr != nil {
			// we don't want to fail the set active tab operation if a block controller fails to start
			log.Printf("error starting block controller (blockid:%s): %v", blockId, blockErr)
			continue
		}
	}
	blockORefs := tab.GetBlockORefs()
	blocks, err := wstore.DBSelectORefs(ctx, blockORefs)
	if err != nil {
		return nil, fmt.Errorf("error getting tab blocks: %w", err)
	}
	updates := wstore.ContextGetUpdatesRtn(ctx)
	updates = append(updates, wstore.MakeUpdate(tab))
	updates = append(updates, wstore.MakeUpdates(blocks)...)
	return updates, nil
}

func (svc *ObjectService) CreateBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"uiContext", "blockDef", "rtOpts"},
		ReturnDesc: "blockId",
	}
}

func (svc *ObjectService) CreateBlock(uiContext wstore.UIContext, blockDef *wstore.BlockDef, rtOpts *wstore.RuntimeOpts) (string, wstore.UpdatesRtnType, error) {
	if uiContext.ActiveTabId == "" {
		return "", nil, fmt.Errorf("no active tab")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	blockData, err := wstore.CreateBlock(ctx, uiContext.ActiveTabId, blockDef, rtOpts)
	if err != nil {
		return "", nil, fmt.Errorf("error creating block: %w", err)
	}
	if blockData.Controller != "" {
		err = blockcontroller.StartBlockController(ctx, blockData.OID)
		if err != nil {
			return "", nil, fmt.Errorf("error starting block controller: %w", err)
		}
	}
	return blockData.OID, wstore.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) DeleteBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "blockId"},
	}
}

func (svc *ObjectService) DeleteBlock(uiContext wstore.UIContext, blockId string) (wstore.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	err := wstore.DeleteBlock(ctx, uiContext.ActiveTabId, blockId)
	if err != nil {
		return nil, fmt.Errorf("error deleting block: %w", err)
	}
	blockcontroller.StopBlockController(blockId)
	return wstore.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) CloseTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "tabId"},
	}
}

func (svc *ObjectService) CloseTab(uiContext wstore.UIContext, tabId string) (wstore.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	window, err := wstore.DBMustGet[*wstore.Window](ctx, uiContext.WindowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	tab, err := wstore.DBMustGet[*wstore.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	for _, blockId := range tab.BlockIds {
		blockcontroller.StopBlockController(blockId)
	}
	err = wstore.CloseTab(ctx, window.WorkspaceId, tabId)
	if err != nil {
		return nil, fmt.Errorf("error closing tab: %w", err)
	}
	if window.ActiveTabId == tabId {
		ws, err := wstore.DBMustGet[*wstore.Workspace](ctx, window.WorkspaceId)
		if err != nil {
			return nil, fmt.Errorf("error getting workspace: %w", err)
		}
		var newActiveTabId string
		if len(ws.TabIds) > 0 {
			newActiveTabId = ws.TabIds[0]
		} else {
			newActiveTabId = ""
		}
		wstore.SetActiveTab(ctx, uiContext.WindowId, newActiveTabId)
	}
	return wstore.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) UpdateObjectMeta_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "oref", "meta"},
	}
}

func (svc *ObjectService) UpdateObjectMeta(uiContext wstore.UIContext, orefStr string, meta map[string]any) (wstore.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, fmt.Errorf("error parsing object reference: %w", err)
	}
	err = wstore.UpdateObjectMeta(ctx, *oref, meta)
	if err != nil {
		return nil, fmt.Errorf("error updateing %q meta: %w", orefStr, err)
	}
	return wstore.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) UpdateObject_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "waveObj", "returnUpdates"},
	}
}

func (svc *ObjectService) UpdateObject(uiContext wstore.UIContext, waveObj waveobj.WaveObj, returnUpdates bool) (wstore.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	if waveObj == nil {
		return nil, fmt.Errorf("update wavobj is nil")
	}
	oref := waveobj.ORefFromWaveObj(waveObj)
	found, err := wstore.DBExistsORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if !found {
		return nil, fmt.Errorf("object not found: %s", oref)
	}
	err = wstore.DBUpdate(ctx, waveObj)
	if err != nil {
		return nil, fmt.Errorf("error updating object: %w", err)
	}
	if returnUpdates {
		return wstore.ContextGetUpdatesRtn(ctx), nil
	}
	return nil, nil
}
