package wcore

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func SwitchWorkspace(ctx context.Context, windowId string, workspaceId string) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		window, err := GetWindow(tx.Context(), windowId)
		if err != nil {
			return err
		}
		if window.WorkspaceId == workspaceId {
			return nil
		}

		_, err = GetWorkspace(tx.Context(), workspaceId)
		if err != nil {
			return err
		}

		allWindows, err := wstore.DBGetAllObjsByType[*waveobj.Window](tx.Context(), waveobj.OType_Window)
		if err != nil {
			return err
		}

		for _, w := range allWindows {
			if w.WorkspaceId == workspaceId {
				return fmt.Errorf("cannot set workspace %s for window %s as it is already claimed by window %s", workspaceId, windowId, w.OID)
			}
		}

		window.WorkspaceId = workspaceId
		return wstore.DBInsert(tx.Context(), window)
	})
}

func GetWindow(ctx context.Context, windowId string) (*waveobj.Window, error) {
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		log.Printf("error getting window %q: %v\n", windowId, err)
		return nil, err
	}
	return window, nil
}

func CreateWindow(ctx context.Context, winSize *waveobj.WinSize, workspaceId string) (*waveobj.Window, error) {
	var ws *waveobj.Workspace
	if workspaceId == "" {
		ws1, err := CreateWorkspace(ctx)
		if err != nil {
			return nil, fmt.Errorf("error creating workspace: %w", err)
		}
		ws = ws1
	} else {
		ws1, err := GetWorkspace(ctx, workspaceId)
		if err != nil {
			return nil, fmt.Errorf("error getting workspace: %w", err)
		}
		ws = ws1
	}
	windowId := uuid.NewString()
	if winSize == nil {
		winSize = &waveobj.WinSize{
			Width:  0,
			Height: 0,
		}
	}
	window := &waveobj.Window{
		OID:         windowId,
		WorkspaceId: ws.OID,
		IsNew:       true,
		Pos: waveobj.Point{
			X: 0,
			Y: 0,
		},
		WinSize: *winSize,
	}
	err := wstore.DBInsert(ctx, window)
	if err != nil {
		return nil, fmt.Errorf("error inserting window: %w", err)
	}
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client: %w", err)
	}
	client.WindowIds = append(client.WindowIds, windowId)
	err = wstore.DBUpdate(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error updating client: %w", err)
	}
	return wstore.DBMustGet[*waveobj.Window](ctx, windowId)
}

func CloseWindow(ctx context.Context, windowId string, fromElectron bool) error {
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return fmt.Errorf("error getting window: %w", err)
	}
	err = DeleteWorkspace(ctx, window.WorkspaceId, fromElectron)
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
	if !fromElectron {
		eventbus.SendEventToElectron(eventbus.WSEventType{
			EventType: eventbus.WSEvent_ElectronCloseWindow,
			Data:      windowId,
		})
	}
	return nil
}

func CheckAndFixWindow(ctx context.Context, windowId string) {
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		log.Printf("error getting window %q (in checkAndFixWindow): %v\n", windowId, err)
		return
	}
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, window.WorkspaceId)
	if err != nil {
		log.Printf("error getting workspace %q (in checkAndFixWindow): %v\n", window.WorkspaceId, err)
		return
	}
	if len(ws.TabIds) == 0 {
		log.Printf("fixing workspace with no tabs %q (in checkAndFixWindow)\n", ws.OID)
		_, err = CreateTab(ctx, ws.OID, "", true)
		if err != nil {
			log.Printf("error creating tab (in checkAndFixWindow): %v\n", err)
		}
	}
}
