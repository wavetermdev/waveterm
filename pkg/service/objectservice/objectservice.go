// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package objectservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wlayout"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type ObjectService struct{}

const DefaultTimeout = 2 * time.Second
const ConnContextTimeout = 60 * time.Second

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
		ArgNames:   []string{"windowId", "tabName", "activateTab"},
		ReturnDesc: "tabId",
	}
}

func (svc *ObjectService) AddTabToWorkspace(windowId string, tabName string, activateTab bool) (string, waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	tabId, err := wcore.CreateTab(ctx, windowId, tabName, activateTab)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab: %w", err)
	}
	err = wlayout.ApplyPortableLayout(ctx, tabId, wlayout.GetNewTabLayout())
	if err != nil {
		return "", nil, fmt.Errorf("error applying new tab layout: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		wps.Broker.SendUpdateEvents(updates)
	}()
	return tabId, updates, nil
}

func (svc *ObjectService) UpdateWorkspaceTabIds_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "workspaceId", "tabIds"},
	}
}

func (svc *ObjectService) UpdateWorkspaceTabIds(uiContext waveobj.UIContext, workspaceId string, tabIds []string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wstore.UpdateWorkspaceTabIds(ctx, workspaceId, tabIds)
	if err != nil {
		return nil, fmt.Errorf("error updating workspace tab ids: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) SetActiveTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "tabId"},
	}
}

func (svc *ObjectService) SetActiveTab(windowId string, tabId string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wstore.SetActiveTab(ctx, windowId, tabId)
	if err != nil {
		return nil, fmt.Errorf("error setting active tab: %w", err)
	}
	// check all blocks in tab and start controllers (if necessary)
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	blockORefs := tab.GetBlockORefs()
	blocks, err := wstore.DBSelectORefs(ctx, blockORefs)
	if err != nil {
		return nil, fmt.Errorf("error getting tab blocks: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		wps.Broker.SendUpdateEvents(updates)
	}()
	var extraUpdates waveobj.UpdatesRtnType
	extraUpdates = append(extraUpdates, updates...)
	extraUpdates = append(extraUpdates, waveobj.MakeUpdate(tab))
	extraUpdates = append(extraUpdates, waveobj.MakeUpdates(blocks)...)
	return extraUpdates, nil
}

func (svc *ObjectService) UpdateTabName_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "tabId", "name"},
	}
}

func (svc *ObjectService) UpdateTabName(uiContext waveobj.UIContext, tabId, name string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wstore.UpdateTabName(ctx, tabId, name)
	if err != nil {
		return nil, fmt.Errorf("error updating tab name: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) CreateBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"uiContext", "blockDef", "rtOpts"},
		ReturnDesc: "blockId",
	}
}

func (svc *ObjectService) CreateBlock(uiContext waveobj.UIContext, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (string, waveobj.UpdatesRtnType, error) {
	if uiContext.ActiveTabId == "" {
		return "", nil, fmt.Errorf("no active tab")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)

	blockData, err := wcore.CreateBlock(ctx, uiContext.ActiveTabId, blockDef, rtOpts)
	if err != nil {
		return "", nil, err
	}

	return blockData.OID, waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) DeleteBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "blockId"},
	}
}

func (svc *ObjectService) DeleteBlock(uiContext waveobj.UIContext, blockId string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.DeleteBlock(ctx, uiContext.ActiveTabId, blockId)
	if err != nil {
		return nil, fmt.Errorf("error deleting block: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) UpdateObjectMeta_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "oref", "meta"},
	}
}

func (svc *ObjectService) UpdateObjectMeta(uiContext waveobj.UIContext, orefStr string, meta waveobj.MetaMapType) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, fmt.Errorf("error parsing object reference: %w", err)
	}
	err = wstore.UpdateObjectMeta(ctx, *oref, meta)
	if err != nil {
		return nil, fmt.Errorf("error updateing %q meta: %w", orefStr, err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) UpdateObject_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "waveObj", "returnUpdates"},
	}
}

func (svc *ObjectService) UpdateObject(uiContext waveobj.UIContext, waveObj waveobj.WaveObj, returnUpdates bool) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
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
		return waveobj.ContextGetUpdatesRtn(ctx), nil
	}
	return nil, nil
}
