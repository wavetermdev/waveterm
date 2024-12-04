package workspaceservice

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wlayout"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WorkspaceService struct{}

func (svc *WorkspaceService) GetWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"workspaceId"},
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

func (svc *WorkspaceService) DeleteWorkspace(workspaceId string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	deleted, err := wcore.DeleteWorkspace(ctx, workspaceId, true)
	if err != nil {
		return nil, fmt.Errorf("error deleting workspace: %w", err)
	}
	if !deleted {
		return nil, nil
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer panichandler.PanicHandler("WorkspaceService:DeleteWorkspace:SendUpdateEvents")
		wps.Broker.SendUpdateEvents(updates)
	}()
	return updates, nil
}

func (svg *WorkspaceService) ListWorkspaces() (waveobj.WorkspaceList, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	return wcore.ListWorkspaces(ctx)
}

func (svc *WorkspaceService) CreateTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"workspaceId", "tabName", "activateTab"},
		ReturnDesc: "tabId",
	}
}

func (svc *WorkspaceService) CreateTab(workspaceId string, tabName string, activateTab bool) (string, waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	tabId, err := wcore.CreateTab(ctx, workspaceId, tabName, activateTab)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab: %w", err)
	}
	err = wlayout.ApplyPortableLayout(ctx, tabId, wlayout.GetNewTabLayout())
	if err != nil {
		return "", nil, fmt.Errorf("error applying new tab layout: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer panichandler.PanicHandler("WorkspaceService:CreateTab:SendUpdateEvents")
		wps.Broker.SendUpdateEvents(updates)
	}()
	return tabId, updates, nil
}

func (svc *WorkspaceService) UpdateTabIds_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "workspaceId", "tabIds"},
	}
}

func (svc *WorkspaceService) UpdateTabIds(uiContext waveobj.UIContext, workspaceId string, tabIds []string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.UpdateWorkspaceTabIds(ctx, workspaceId, tabIds)
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
		defer panichandler.PanicHandler("WorkspaceService:SetActiveTab:SendUpdateEvents")
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
		ArgNames: []string{"ctx", "workspaceId", "tabId", "fromElectron"},
	}
}

// returns the new active tabid
func (svc *WorkspaceService) CloseTab(ctx context.Context, workspaceId string, tabId string, fromElectron bool) (*CloseTabRtnType, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, nil, fmt.Errorf("error getting tab: %w", err)
	}
	go func() {
		for _, blockId := range tab.BlockIds {
			blockcontroller.StopBlockController(blockId)
		}
	}()
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
		defer panichandler.PanicHandler("WorkspaceService:CloseTab:SendUpdateEvents")
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}
