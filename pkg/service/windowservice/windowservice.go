// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package windowservice

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wcore"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WindowService struct{}

func (ws *WindowService) SetWindowPosAndSize(ctx context.Context, windowId string, pos *waveobj.Point, size *waveobj.WinSize) (waveobj.UpdatesRtnType, error) {
	if pos == nil && size == nil {
		return nil, nil
	}
	ctx = waveobj.ContextWithUpdates(ctx)
	win, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return nil, err
	}
	if pos != nil {
		win.Pos = *pos
	}
	if size != nil {
		win.WinSize = *size
	}
	err = wstore.DBUpdate(ctx, win)
	if err != nil {
		return nil, err
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WindowService) CloseTab(ctx context.Context, uiContext waveobj.UIContext, tabId string) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, uiContext.WindowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, window.WorkspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	tabIndex := -1
	for i, id := range ws.TabIds {
		if id == tabId {
			tabIndex = i
			break
		}
	}
	for _, blockId := range tab.BlockIds {
		blockcontroller.StopBlockController(blockId)
	}
	if err := wcore.DeleteTab(ctx, window.WorkspaceId, tabId); err != nil {
		return nil, fmt.Errorf("error closing tab: %w", err)
	}
	if window.ActiveTabId == tabId && tabIndex != -1 {
		if len(ws.TabIds) == 1 {
			eventbus.SendEventToElectron(eventbus.WSEventType{
				EventType: eventbus.WSEvent_ElectronCloseWindow,
				Data:      uiContext.WindowId,
			})
		} else {
			if tabIndex < len(ws.TabIds)-1 {
				newActiveTabId := ws.TabIds[tabIndex+1]
				wstore.SetActiveTab(ctx, uiContext.WindowId, newActiveTabId)
			} else {
				newActiveTabId := ws.TabIds[tabIndex-1]
				wstore.SetActiveTab(ctx, uiContext.WindowId, newActiveTabId)
			}
		}
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WindowService) MoveBlockToNewWindow_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "move block to new window",
		ArgNames: []string{"ctx", "currentTabId", "blockId"},
	}
}

func (svc *WindowService) MoveBlockToNewWindow(ctx context.Context, currentTabId string, blockId string) (waveobj.UpdatesRtnType, error) {
	log.Printf("MoveBlockToNewWindow(%s, %s)", currentTabId, blockId)
	ctx = waveobj.ContextWithUpdates(ctx)
	curWindowId, err := wstore.DBFindWindowForTabId(ctx, currentTabId)
	if err != nil {
		return nil, fmt.Errorf("error finding window for current-tab: %w", err)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, currentTabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	log.Printf("tab.BlockIds[%s]: %v", tab.OID, tab.BlockIds)
	var foundBlock bool
	for _, tabBlockId := range tab.BlockIds {
		if tabBlockId == blockId {
			foundBlock = true
			break
		}
	}
	if !foundBlock {
		return nil, fmt.Errorf("block not found in current tab")
	}
	newWindow, err := wcore.CreateWindow(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("error creating window: %w", err)
	}
	err = wstore.MoveBlockToTab(ctx, currentTabId, newWindow.ActiveTabId, blockId)
	if err != nil {
		return nil, fmt.Errorf("error moving block to tab: %w", err)
	}
	eventbus.SendEventToElectron(eventbus.WSEventType{
		EventType: eventbus.WSEvent_ElectronNewWindow,
		Data:      newWindow.OID,
	})
	windowCreated := eventbus.BusyWaitForWindowId(newWindow.OID, 2*time.Second)
	if !windowCreated {
		return nil, fmt.Errorf("new window not created")
	}
	eventbus.SendEventToWindow(curWindowId, eventbus.WSEventType{
		EventType: eventbus.WSEvent_LayoutAction,
		Data: waveobj.LayoutActionData{
			ActionType: eventbus.WSLayoutActionType_Remove,
			TabId:      currentTabId,
			BlockId:    blockId,
		},
	})
	eventbus.SendEventToWindow(newWindow.OID, eventbus.WSEventType{
		EventType: eventbus.WSEvent_LayoutAction,
		Data: waveobj.LayoutActionData{
			ActionType: eventbus.WSLayoutActionType_Insert,
			TabId:      newWindow.ActiveTabId,
			BlockId:    blockId,
		},
	})
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WindowService) CloseWindow(ctx context.Context, windowId string) error {
	ctx = waveobj.ContextWithUpdates(ctx)
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return fmt.Errorf("error getting window: %w", err)
	}
	workspace, err := wstore.DBMustGet[*waveobj.Workspace](ctx, window.WorkspaceId)
	if err != nil {
		return fmt.Errorf("error getting workspace: %w", err)
	}
	for _, tabId := range workspace.TabIds {
		uiContext := waveobj.UIContext{WindowId: windowId}
		_, err := svc.CloseTab(ctx, uiContext, tabId)
		if err != nil {
			return fmt.Errorf("error closing tab: %w", err)
		}
	}
	err = wstore.DBDelete(ctx, waveobj.OType_Workspace, window.WorkspaceId)
	if err != nil {
		return fmt.Errorf("error deleting workspace: %w", err)
	}
	err = wstore.DBDelete(ctx, waveobj.OType_Window, windowId)
	if err != nil {
		return fmt.Errorf("error deleting window: %w", err)
	}
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client: %w", err)
	}
	client.WindowIds = utilfn.RemoveElemFromSlice(client.WindowIds, windowId)
	err = wstore.DBUpdate(ctx, client)
	if err != nil {
		return fmt.Errorf("error updating client: %w", err)
	}
	return nil
}
