// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var WorkspaceColors = [...]string{
	"#58C142", // Green (accent)
	"#00FFDB", // Teal
	"#429DFF", // Blue
	"#BF55EC", // Purple
	"#FF453A", // Red
	"#FF9500", // Orange
	"#FFE900", // Yellow
}

var WorkspaceIcons = [...]string{
	"custom@wave-logo-solid",
	"triangle",
	"star",
	"heart",
	"bolt",
	"solid@cloud",
	"moon",
	"layer-group",
	"rocket",
	"flask",
	"paperclip",
	"chart-line",
	"graduation-cap",
	"mug-hot",
}

func CreateWorkspace(ctx context.Context, name string, icon string, color string, applyDefaults bool, isInitialLaunch bool) (*waveobj.Workspace, error) {
	ws := &waveobj.Workspace{
		OID:          uuid.NewString(),
		TabIds:       []string{},
		PinnedTabIds: []string{},
		Name:         "",
		Icon:         "",
		Color:        "",
	}
	err := wstore.DBInsert(ctx, ws)
	if err != nil {
		return nil, fmt.Errorf("error inserting workspace: %w", err)
	}
	_, err = CreateTab(ctx, ws.OID, "", true, false, isInitialLaunch)
	if err != nil {
		return nil, fmt.Errorf("error creating tab: %w", err)
	}

	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_WorkspaceUpdate,
	})

	ws, _, err = UpdateWorkspace(ctx, ws.OID, name, icon, color, applyDefaults)
	return ws, err
}

// Returns updated workspace, whether it was updated, error.
func UpdateWorkspace(ctx context.Context, workspaceId string, name string, icon string, color string, applyDefaults bool) (*waveobj.Workspace, bool, error) {
	ws, err := GetWorkspace(ctx, workspaceId)
	updated := false
	if err != nil {
		return nil, updated, fmt.Errorf("workspace %s not found: %w", workspaceId, err)
	}
	if name != "" {
		ws.Name = name
		updated = true
	} else if applyDefaults && ws.Name == "" {
		ws.Name = fmt.Sprintf("New Workspace (%s)", ws.OID[0:5])
		updated = true
	}
	if icon != "" {
		ws.Icon = icon
		updated = true
	} else if applyDefaults && ws.Icon == "" {
		ws.Icon = WorkspaceIcons[0]
		updated = true
	}
	if color != "" {
		ws.Color = color
		updated = true
	} else if applyDefaults && ws.Color == "" {
		wsList, err := ListWorkspaces(ctx)
		if err != nil {
			log.Printf("error listing workspaces: %v", err)
			wsList = waveobj.WorkspaceList{}
		}
		ws.Color = WorkspaceColors[len(wsList)%len(WorkspaceColors)]
		updated = true
	}
	if updated {
		wstore.DBUpdate(ctx, ws)
	}
	return ws, updated, nil
}

// If force is true, it will delete even if workspace is named.
// If workspace is empty, it will be deleted, even if it is named.
// Returns true if workspace was deleted, false if it was not deleted.
func DeleteWorkspace(ctx context.Context, workspaceId string, force bool) (bool, string, error) {
	log.Printf("DeleteWorkspace %s\n", workspaceId)
	workspace, err := wstore.DBMustGet[*waveobj.Workspace](ctx, workspaceId)
	if err != nil && wstore.ErrNotFound == err {
		return true, "", fmt.Errorf("workspace already deleted %w", err)
	}
	// @jalileh list needs to be saved early on i assume
	workspaces, err := ListWorkspaces(ctx)
	if err != nil {
		return false, "", fmt.Errorf("error retrieving workspaceList: %w", err)
	}

	if workspace.Name != "" && workspace.Icon != "" && !force && (len(workspace.TabIds) > 0 || len(workspace.PinnedTabIds) > 0) {
		log.Printf("Ignoring DeleteWorkspace for workspace %s as it is named\n", workspaceId)
		return false, "", nil
	}

	// delete all pinned and unpinned tabs
	for _, tabId := range append(workspace.TabIds, workspace.PinnedTabIds...) {
		log.Printf("deleting tab %s\n", tabId)
		_, err := DeleteTab(ctx, workspaceId, tabId, false)
		if err != nil {
			return false, "", fmt.Errorf("error closing tab: %w", err)
		}
	}
	windowId, _ := wstore.DBFindWindowForWorkspaceId(ctx, workspaceId)
	err = wstore.DBDelete(ctx, waveobj.OType_Workspace, workspaceId)
	if err != nil {
		return false, "", fmt.Errorf("error deleting workspace: %w", err)
	}
	log.Printf("deleted workspace %s\n", workspaceId)
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_WorkspaceUpdate,
	})

	if windowId != "" {

		UnclaimedWorkspace, findAfter := "", false
		for _, ws := range workspaces {
			if ws.WorkspaceId == workspaceId {
				if UnclaimedWorkspace != "" {
					break
				}
				findAfter = true
				continue
			}
			if findAfter && ws.WindowId == "" {
				UnclaimedWorkspace = ws.WorkspaceId
				break
			} else if ws.WindowId == "" {
				UnclaimedWorkspace = ws.WorkspaceId
			}
		}

		if UnclaimedWorkspace != "" {
			return true, UnclaimedWorkspace, nil
		} else {
			err = CloseWindow(ctx, windowId, false)
		}

		if err != nil {
			return false, "", fmt.Errorf("error closing window: %w", err)
		}
	}
	return true, "", nil
}

func GetWorkspace(ctx context.Context, wsID string) (*waveobj.Workspace, error) {
	return wstore.DBMustGet[*waveobj.Workspace](ctx, wsID)
}

func getTabPresetMeta() (waveobj.MetaMapType, error) {
	settings := wconfig.GetWatcher().GetFullConfig()
	tabPreset := settings.Settings.TabPreset
	if tabPreset == "" {
		return nil, nil
	}
	presetMeta := settings.Presets[tabPreset]
	return presetMeta, nil
}

// returns tabid
func CreateTab(ctx context.Context, workspaceId string, tabName string, activateTab bool, pinned bool, isInitialLaunch bool) (string, error) {
	if tabName == "" {
		ws, err := GetWorkspace(ctx, workspaceId)
		if err != nil {
			return "", fmt.Errorf("workspace %s not found: %w", workspaceId, err)
		}
		tabName = "T" + fmt.Sprint(len(ws.TabIds)+len(ws.PinnedTabIds)+1)
	}

	// The initial tab for the initial launch should be pinned
	tab, err := createTabObj(ctx, workspaceId, tabName, pinned || isInitialLaunch, nil)
	if err != nil {
		return "", fmt.Errorf("error creating tab: %w", err)
	}
	if activateTab {
		err = SetActiveTab(ctx, workspaceId, tab.OID)
		if err != nil {
			return "", fmt.Errorf("error setting active tab: %w", err)
		}
	}

	// No need to apply an initial layout for the initial launch, since the starter layout will get applied after onboarding modal dismissal
	if !isInitialLaunch {
		err = ApplyPortableLayout(ctx, tab.OID, GetNewTabLayout(), true)
		if err != nil {
			return tab.OID, fmt.Errorf("error applying new tab layout: %w", err)
		}
		presetMeta, presetErr := getTabPresetMeta()
		if presetErr != nil {
			log.Printf("error getting tab preset meta: %v\n", presetErr)
		} else if len(presetMeta) > 0 {
			tabORef := waveobj.ORefFromWaveObj(tab)
			wstore.UpdateObjectMeta(ctx, *tabORef, presetMeta, true)
		}
	}
	telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{NewTab: 1}, "createtab")
	telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
		Event: "action:createtab",
	})
	return tab.OID, nil
}

func createTabObj(ctx context.Context, workspaceId string, name string, pinned bool, meta waveobj.MetaMapType) (*waveobj.Tab, error) {
	ws, err := GetWorkspace(ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("workspace %s not found: %w", workspaceId, err)
	}
	layoutStateId := uuid.NewString()
	tab := &waveobj.Tab{
		OID:         uuid.NewString(),
		Name:        name,
		BlockIds:    []string{},
		LayoutState: layoutStateId,
		Meta:        meta,
	}
	layoutState := &waveobj.LayoutState{
		OID: layoutStateId,
	}
	if pinned {
		ws.PinnedTabIds = append(ws.PinnedTabIds, tab.OID)
	} else {
		ws.TabIds = append(ws.TabIds, tab.OID)
	}
	wstore.DBInsert(ctx, tab)
	wstore.DBInsert(ctx, layoutState)
	wstore.DBUpdate(ctx, ws)
	return tab, nil
}

// Must delete all blocks individually first.
// Also deletes LayoutState.
// recursive: if true, will recursively close parent window, workspace, if they are empty.
// Returns new active tab id, error.
func DeleteTab(ctx context.Context, workspaceId string, tabId string, recursive bool) (string, error) {
	ws, _ := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if ws == nil {
		return "", fmt.Errorf("workspace not found: %q", workspaceId)
	}

	// ensure tab is in workspace
	tabIdx := utilfn.FindStringInSlice(ws.TabIds, tabId)
	tabIdxPinned := utilfn.FindStringInSlice(ws.PinnedTabIds, tabId)
	if tabIdx != -1 {
		ws.TabIds = append(ws.TabIds[:tabIdx], ws.TabIds[tabIdx+1:]...)
	} else if tabIdxPinned != -1 {
		ws.PinnedTabIds = append(ws.PinnedTabIds[:tabIdxPinned], ws.PinnedTabIds[tabIdxPinned+1:]...)
	} else {
		return "", fmt.Errorf("tab %s not found in workspace %s", tabId, workspaceId)
	}

	// close blocks (sends events + stops block controllers)
	tab, _ := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if tab != nil {
		for _, blockId := range tab.BlockIds {
			err := DeleteBlock(ctx, blockId, false)
			if err != nil {
				return "", fmt.Errorf("error deleting block %s: %w", blockId, err)
			}
		}
	}

	// if the tab is active, determine new active tab
	newActiveTabId := ws.ActiveTabId
	if ws.ActiveTabId == tabId {
		if len(ws.TabIds) > 0 {
			if tabIdx != -1 {
				newActiveTabId = ws.TabIds[max(0, min(tabIdx-1, len(ws.TabIds)-1))]
			} else {
				newActiveTabId = ws.TabIds[0]
			}
		} else if len(ws.PinnedTabIds) > 0 {
			newActiveTabId = ws.PinnedTabIds[0]
		} else {
			newActiveTabId = ""
		}
	}
	ws.ActiveTabId = newActiveTabId

	wstore.DBUpdate(ctx, ws)
	wstore.DBDelete(ctx, waveobj.OType_Tab, tabId)
	if tab != nil {
		wstore.DBDelete(ctx, waveobj.OType_LayoutState, tab.LayoutState)
	}

	// if no tabs remaining, close window
	if recursive && newActiveTabId == "" {
		log.Printf("no tabs remaining in workspace %s, closing window\n", workspaceId)
		windowId, err := wstore.DBFindWindowForWorkspaceId(ctx, workspaceId)
		if err != nil {
			return newActiveTabId, fmt.Errorf("unable to find window for workspace id %v: %w", workspaceId, err)
		}
		err = CloseWindow(ctx, windowId, false)
		if err != nil {
			return newActiveTabId, err
		}
	}
	return newActiveTabId, nil
}

func SetActiveTab(ctx context.Context, workspaceId string, tabId string) error {
	if tabId != "" && workspaceId != "" {
		workspace, err := GetWorkspace(ctx, workspaceId)
		if err != nil {
			return fmt.Errorf("workspace %s not found: %w", workspaceId, err)
		}
		tab, _ := wstore.DBGet[*waveobj.Tab](ctx, tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		workspace.ActiveTabId = tabId
		wstore.DBUpdate(ctx, workspace)
	}
	return nil
}

func ChangeTabPinning(ctx context.Context, workspaceId string, tabId string, pinned bool) error {
	if tabId != "" && workspaceId != "" {
		workspace, err := GetWorkspace(ctx, workspaceId)
		if err != nil {
			return fmt.Errorf("workspace %s not found: %w", workspaceId, err)
		}
		if pinned && utilfn.FindStringInSlice(workspace.PinnedTabIds, tabId) == -1 {
			if utilfn.FindStringInSlice(workspace.TabIds, tabId) == -1 {
				return fmt.Errorf("tab %s not found in workspace %s", tabId, workspaceId)
			}
			workspace.TabIds = utilfn.RemoveElemFromSlice(workspace.TabIds, tabId)
			workspace.PinnedTabIds = append(workspace.PinnedTabIds, tabId)
		} else if !pinned && utilfn.FindStringInSlice(workspace.PinnedTabIds, tabId) != -1 {
			if utilfn.FindStringInSlice(workspace.PinnedTabIds, tabId) == -1 {
				return fmt.Errorf("tab %s not found in workspace %s", tabId, workspaceId)
			}
			workspace.PinnedTabIds = utilfn.RemoveElemFromSlice(workspace.PinnedTabIds, tabId)
			workspace.TabIds = append([]string{tabId}, workspace.TabIds...)
		}
		wstore.DBUpdate(ctx, workspace)
	}
	return nil
}

func SendActiveTabUpdate(ctx context.Context, workspaceId string, newActiveTabId string) {
	eventbus.SendEventToElectron(eventbus.WSEventType{
		EventType: eventbus.WSEvent_ElectronUpdateActiveTab,
		Data:      &waveobj.ActiveTabUpdate{WorkspaceId: workspaceId, NewActiveTabId: newActiveTabId},
	})
}

func UpdateWorkspaceTabIds(ctx context.Context, workspaceId string, tabIds []string, pinnedTabIds []string) error {
	ws, _ := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if ws == nil {
		return fmt.Errorf("workspace not found: %q", workspaceId)
	}
	ws.TabIds = tabIds
	ws.PinnedTabIds = pinnedTabIds
	wstore.DBUpdate(ctx, ws)
	return nil
}

func ListWorkspaces(ctx context.Context) (waveobj.WorkspaceList, error) {
	workspaces, err := wstore.DBGetAllObjsByType[*waveobj.Workspace](ctx, waveobj.OType_Workspace)
	if err != nil {
		return nil, err
	}
	windows, err := wstore.DBGetAllObjsByType[*waveobj.Window](ctx, waveobj.OType_Window)
	if err != nil {
		return nil, err
	}
	workspaceToWindow := make(map[string]string)
	for _, window := range windows {
		workspaceToWindow[window.WorkspaceId] = window.OID
	}

	var wl waveobj.WorkspaceList
	for _, workspace := range workspaces {
		if workspace.Name == "" || workspace.Icon == "" || workspace.Color == "" {
			continue
		}
		windowId, ok := workspaceToWindow[workspace.OID]
		if !ok {
			windowId = ""
		}
		wl = append(wl, &waveobj.WorkspaceListEntry{
			WorkspaceId: workspace.OID,
			WindowId:    windowId,
		})
	}
	return wl, nil
}

func SetIcon(workspaceId string, icon string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ws, e := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if e != nil {
		return e
	}
	if ws == nil {
		return fmt.Errorf("workspace not found: %q", workspaceId)
	}
	ws.Icon = icon
	wstore.DBUpdate(ctx, ws)
	return nil
}

func SetColor(workspaceId string, color string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ws, e := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if e != nil {
		return e
	}
	if ws == nil {
		return fmt.Errorf("workspace not found: %q", workspaceId)
	}
	ws.Color = color
	wstore.DBUpdate(ctx, ws)
	return nil
}

func SetName(workspaceId string, name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ws, e := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if e != nil {
		return e
	}
	if ws == nil {
		return fmt.Errorf("workspace not found: %q", workspaceId)
	}
	ws.Name = name
	wstore.DBUpdate(ctx, ws)
	return nil
}
