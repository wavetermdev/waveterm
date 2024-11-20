package workspaceservice

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type WorkspaceService struct{}

type CloseTabRtnType struct {
	CloseWindow    bool   `json:"closewindow,omitempty"`
	NewActiveTabId string `json:"newactivetabid,omitempty"`
}

// returns the new active tabid
func (svc *WorkspaceService) CloseTab(ctx context.Context, workspaceId string, tabId string, fromElectron bool) (*CloseTabRtnType, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, nil, fmt.Errorf("error getting tab: %w", err)
	}
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, workspaceId)
	if err != nil {
		return nil, nil, fmt.Errorf("error getting workspace: %w", err)
	}
	tabIndex := -1
	for i, id := range ws.TabIds {
		if id == tabId {
			tabIndex = i
			break
		}
	}
	go func() {
		for _, blockId := range tab.BlockIds {
			blockcontroller.StopBlockController(blockId)
		}
	}()
	if err := wcore.DeleteTab(ctx, workspaceId, tabId); err != nil {
		return nil, nil, fmt.Errorf("error closing tab: %w", err)
	}
	rtn := &CloseTabRtnType{}
	if ws.ActiveTabId == tabId && tabIndex != -1 {
		if len(ws.TabIds) == 1 {
			windowId, err := wstore.DBFindWindowForWorkspaceId(ctx, workspaceId)
			if err != nil {
				return rtn, nil, fmt.Errorf("unable to find window for workspace id %v: %w", workspaceId, err)
			}
			rtn.CloseWindow = true
			err = wcore.CloseWindow(ctx, windowId, fromElectron)
			if err != nil {
				return rtn, nil, err
			}
		} else {
			if tabIndex < len(ws.TabIds)-1 {
				newActiveTabId := ws.TabIds[tabIndex+1]
				err := wcore.SetActiveTab(ctx, ws.OID, newActiveTabId)
				if err != nil {
					return rtn, nil, err
				}
				rtn.NewActiveTabId = newActiveTabId
			} else {
				newActiveTabId := ws.TabIds[tabIndex-1]
				err := wcore.SetActiveTab(ctx, ws.OID, newActiveTabId)
				if err != nil {
					return rtn, nil, err
				}
				rtn.NewActiveTabId = newActiveTabId
			}
		}
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}
