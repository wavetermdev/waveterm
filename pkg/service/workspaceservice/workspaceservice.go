// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workspaceservice

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WorkspaceService struct{}

func (svc *WorkspaceService) CreateWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "name", "icon", "color", "applyDefaults"},
		ReturnDesc: "workspaceId",
	}
}

func (svc *WorkspaceService) CreateWorkspace(ctx context.Context, name string, icon string, color string, applyDefaults bool) (string, error) {
	newWS, err := wcore.CreateWorkspace(ctx, name, icon, color, applyDefaults, false)
	if err != nil {
		return "", fmt.Errorf("error creating workspace: %w", err)
	}
	return newWS.OID, nil
}

func (svc *WorkspaceService) UpdateWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "workspaceId", "name", "icon", "color", "applyDefaults"},
	}
}

func (svc *WorkspaceService) UpdateWorkspace(ctx context.Context, workspaceId string, name string, icon string, color string, applyDefaults bool) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	_, updated, err := wcore.UpdateWorkspace(ctx, workspaceId, name, icon, color, applyDefaults)
	if err != nil {
		return nil, fmt.Errorf("error updating workspace: %w", err)
	}
	if !updated {
		return nil, nil
	}

	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_WorkspaceUpdate,
	})

	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:UpdateWorkspace:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return updates, nil
}

func (svc *WorkspaceService) GetWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"workspaceId"},
		ReturnDesc: "workspace",
	}
}

func (svc *WorkspaceService) GetWorkspace(workspaceId string) (*waveobj.Workspace, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ws, err := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	return ws, nil
}

func (svc *WorkspaceService) DeleteWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"workspaceId"},
	}
}

func (svc *WorkspaceService) DeleteWorkspace(workspaceId string) (waveobj.UpdatesRtnType, string, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	deleted, claimableWorkspace, err := wcore.DeleteWorkspace(ctx, workspaceId, true)
	if claimableWorkspace != "" {
		return nil, claimableWorkspace, nil
	}
	if err != nil {
		return nil, claimableWorkspace, fmt.Errorf("error deleting workspace: %w", err)
	}
	if !deleted {
		return nil, claimableWorkspace, nil
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:DeleteWorkspace:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return updates, claimableWorkspace, nil
}

func (svc *WorkspaceService) ListWorkspaces() (waveobj.WorkspaceList, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	return wcore.ListWorkspaces(ctx)
}

func (svc *WorkspaceService) CreateTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"workspaceId", "tabName", "activateTab", "pinned"},
		ReturnDesc: "tabId",
	}
}

func (svc *WorkspaceService) GetColors_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ReturnDesc: "colors",
	}
}

func (svc *WorkspaceService) GetColors() []string {
	return wcore.WorkspaceColors[:]
}

func (svc *WorkspaceService) GetIcons_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ReturnDesc: "icons",
	}
}

func (svc *WorkspaceService) GetIcons() []string {
	return wcore.WorkspaceIcons[:]
}

func (svc *WorkspaceService) CreateTab(workspaceId string, tabName string, activateTab bool, pinned bool) (string, waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	tabId, err := wcore.CreateTab(ctx, workspaceId, tabName, activateTab, pinned, false)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:CreateTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return tabId, updates, nil
}

func (svc *WorkspaceService) ChangeTabPinning_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "workspaceId", "tabId", "pinned"},
	}
}

func (svc *WorkspaceService) ChangeTabPinning(ctx context.Context, workspaceId string, tabId string, pinned bool) (waveobj.UpdatesRtnType, error) {
	log.Printf("ChangeTabPinning %s %s %v\n", workspaceId, tabId, pinned)
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.ChangeTabPinning(ctx, workspaceId, tabId, pinned)
	if err != nil {
		return nil, fmt.Errorf("error toggling tab pinning: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:ChangeTabPinning:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return updates, nil
}

func (svc *WorkspaceService) UpdateTabIds_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "workspaceId", "tabIds", "pinnedTabIds"},
	}
}

func (svc *WorkspaceService) UpdateTabIds(uiContext waveobj.UIContext, workspaceId string, tabIds []string, pinnedTabIds []string) (waveobj.UpdatesRtnType, error) {
	log.Printf("UpdateTabIds %s %v %v\n", workspaceId, tabIds, pinnedTabIds)
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.UpdateWorkspaceTabIds(ctx, workspaceId, tabIds, pinnedTabIds)
	if err != nil {
		return nil, fmt.Errorf("error updating workspace tab ids: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *WorkspaceService) SetActiveTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"workspaceId", "tabId"},
	}
}

func (svc *WorkspaceService) SetActiveTab(workspaceId string, tabId string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.SetActiveTab(ctx, workspaceId, tabId)
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
		defer func() {
			panichandler.PanicHandler("WorkspaceService:SetActiveTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	var extraUpdates waveobj.UpdatesRtnType
	extraUpdates = append(extraUpdates, updates...)
	extraUpdates = append(extraUpdates, waveobj.MakeUpdate(tab))
	extraUpdates = append(extraUpdates, waveobj.MakeUpdates(blocks)...)
	return extraUpdates, nil
}

type CloseTabRtnType struct {
	CloseWindow    bool   `json:"closewindow,omitempty"`
	NewActiveTabId string `json:"newactivetabid,omitempty"`
}

func (svc *WorkspaceService) CloseTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "workspaceId", "tabId", "fromElectron"},
		ReturnDesc: "CloseTabRtn",
	}
}

// returns the new active tabid
func (svc *WorkspaceService) CloseTab(ctx context.Context, workspaceId string, tabId string, fromElectron bool) (*CloseTabRtnType, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err == nil && tab != nil {
		go func() {
			for _, blockId := range tab.BlockIds {
				blockcontroller.StopBlockController(blockId)
			}
		}()
	}
	newActiveTabId, err := wcore.DeleteTab(ctx, workspaceId, tabId, true)
	if err != nil {
		return nil, nil, fmt.Errorf("error closing tab: %w", err)
	}
	rtn := &CloseTabRtnType{}
	if newActiveTabId == "" {
		rtn.CloseWindow = true
	} else {
		rtn.NewActiveTabId = newActiveTabId
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:CloseTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}
