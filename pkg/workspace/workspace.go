package workspace

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func CreateWorkspace(ctx context.Context) (*waveobj.Workspace, error) {
	ws := &waveobj.Workspace{
		OID:    uuid.NewString(),
		TabIds: []string{},
	}
	wstore.DBInsert(ctx, ws)
	return ws, nil
}

func CreateTab(ctx context.Context, workspaceId string, name string) (*waveobj.Tab, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*waveobj.Tab, error) {
		ws, _ := wstore.DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
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
		wstore.DBInsert(tx.Context(), tab)
		wstore.DBInsert(tx.Context(), layoutState)
		wstore.DBUpdate(tx.Context(), ws)
		return tab, nil
	})
}

// must delete all blocks individually first
// also deletes LayoutState
func DeleteTab(ctx context.Context, workspaceId string, tabId string) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		ws, _ := wstore.DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		tab, _ := wstore.DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		if len(tab.BlockIds) != 0 {
			return fmt.Errorf("tab has blocks, must delete blocks first")
		}
		tabIdx := utilfn.FindStringInSlice(ws.TabIds, tabId)
		if tabIdx == -1 {
			return nil
		}
		ws.TabIds = append(ws.TabIds[:tabIdx], ws.TabIds[tabIdx+1:]...)
		wstore.DBUpdate(tx.Context(), ws)
		wstore.DBDelete(tx.Context(), waveobj.OType_Tab, tabId)
		wstore.DBDelete(tx.Context(), waveobj.OType_LayoutState, tab.LayoutState)
		return nil
	})
}

func UpdateWorkspaceTabIds(ctx context.Context, workspaceId string, tabIds []string) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		ws, _ := wstore.DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		ws.TabIds = tabIds
		wstore.DBUpdate(tx.Context(), ws)
		return nil
	})
}

type WorkspaceListEntry struct {
	WorkspaceId string `json:"workspaceid"`
	WindowId    string `json:"windowid"`
}

type WorkspaceList []*WorkspaceListEntry

func List() (WorkspaceList, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	workspaceIds, err := wstore.DBGetAllOIDsByType(ctx, waveobj.OType_Workspace)
	if err != nil {
		return nil, err
	}

	log.Println("got workspace ids")

	windows, err := wstore.DBGetAllObjsByType[*waveobj.Window](ctx, waveobj.OType_Window)
	if err != nil {
		return nil, err
	}

	workspaceToWindow := make(map[string]string)
	for _, window := range windows {
		workspaceToWindow[window.WorkspaceId] = window.OID
	}

	var wl WorkspaceList
	for _, workspaceId := range workspaceIds {
		windowId, ok := workspaceToWindow[workspaceId]
		if !ok {
			windowId = ""
		}
		wl = append(wl, &WorkspaceListEntry{
			WorkspaceId: workspaceId,
			WindowId:    windowId,
		})
	}
	return wl, nil
}

func SetIcon(workspaceId string, icon string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		ws, e := wstore.DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if e != nil {
			return e
		}
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		ws.Icon = icon
		wstore.DBUpdate(tx.Context(), ws)
		return nil
	})
}

func SetColor(workspaceId string, color string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		ws, e := wstore.DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if e != nil {
			return e
		}
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		ws.Color = color
		wstore.DBUpdate(tx.Context(), ws)
		return nil
	})
}

func SetName(workspaceId string, name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		ws, e := wstore.DBGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if e != nil {
			return e
		}
		if ws == nil {
			return fmt.Errorf("workspace not found: %q", workspaceId)
		}
		ws.Name = name
		wstore.DBUpdate(tx.Context(), ws)
		return nil
	})
}
