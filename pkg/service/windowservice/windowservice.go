// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package windowservice

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WindowService struct{}

func (ws *WindowService) SetWindowPosAndSize(ctx context.Context, windowId string, pos *wstore.Point, size *wstore.WinSize) (wstore.UpdatesRtnType, error) {
	if pos == nil && size == nil {
		return nil, nil
	}
	ctx = wstore.ContextWithUpdates(ctx)
	win, err := wstore.DBMustGet[*wstore.Window](ctx, windowId)
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
	return wstore.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WindowService) CloseTab(ctx context.Context, uiContext wstore.UIContext, tabId string) (wstore.UpdatesRtnType, error) {
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
	err = wstore.DeleteTab(ctx, window.WorkspaceId, tabId)
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

func (svc *WindowService) CloseWindow(ctx context.Context, windowId string) error {
	ctx = wstore.ContextWithUpdates(ctx)
	window, err := wstore.DBMustGet[*wstore.Window](ctx, windowId)
	if err != nil {
		return fmt.Errorf("error getting window: %w", err)
	}
	workspace, err := wstore.DBMustGet[*wstore.Workspace](ctx, window.WorkspaceId)
	if err != nil {
		return fmt.Errorf("error getting workspace: %w", err)
	}
	for _, tabId := range workspace.TabIds {
		uiContext := wstore.UIContext{WindowId: windowId}
		_, err := svc.CloseTab(ctx, uiContext, tabId)
		if err != nil {
			return fmt.Errorf("error closing tab: %w", err)
		}
	}
	err = wstore.DBDelete(ctx, wstore.OType_Workspace, window.WorkspaceId)
	if err != nil {
		return fmt.Errorf("error deleting workspace: %w", err)
	}
	err = wstore.DBDelete(ctx, wstore.OType_Window, windowId)
	if err != nil {
		return fmt.Errorf("error deleting window: %w", err)
	}
	return nil
}
