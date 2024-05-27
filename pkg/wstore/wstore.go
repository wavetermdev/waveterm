// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"reflect"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/util/ds"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

var WorkspaceMap = ds.NewSyncMap[*Workspace]()
var TabMap = ds.NewSyncMap[*Tab]()
var BlockMap = ds.NewSyncMap[*Block]()

func init() {
	for _, rtype := range AllWaveObjTypes() {
		waveobj.RegisterType(rtype)
	}
}

type Client struct {
	OID          string `json:"oid"`
	Version      int    `json:"version"`
	MainWindowId string `json:"mainwindowid"`
}

func (*Client) GetOType() string {
	return "client"
}

func AllWaveObjTypes() []reflect.Type {
	return []reflect.Type{
		reflect.TypeOf(&Client{}),
		reflect.TypeOf(&Window{}),
		reflect.TypeOf(&Workspace{}),
		reflect.TypeOf(&Tab{}),
		reflect.TypeOf(&Block{}),
	}
}

// stores the ui-context of the window
// workspaceid, active tab, active block within each tab, window size, etc.
type Window struct {
	OID            string            `json:"oid"`
	Version        int               `json:"version"`
	WorkspaceId    string            `json:"workspaceid"`
	ActiveTabId    string            `json:"activetabid"`
	ActiveBlockMap map[string]string `json:"activeblockmap"` // map from tabid to blockid
	Pos            Point             `json:"pos"`
	WinSize        WinSize           `json:"winsize"`
	LastFocusTs    int64             `json:"lastfocusts"`
}

func (*Window) GetOType() string {
	return "window"
}

type Workspace struct {
	OID     string   `json:"oid"`
	Version int      `json:"version"`
	Name    string   `json:"name"`
	TabIds  []string `json:"tabids"`
}

func (*Workspace) GetOType() string {
	return "workspace"
}

type Tab struct {
	OID      string   `json:"oid"`
	Version  int      `json:"version"`
	Name     string   `json:"name"`
	BlockIds []string `json:"blockids"`
}

func (*Tab) GetOType() string {
	return "tab"
}

type FileDef struct {
	FileType string         `json:"filetype,omitempty"`
	Path     string         `json:"path,omitempty"`
	Url      string         `json:"url,omitempty"`
	Content  string         `json:"content,omitempty"`
	Meta     map[string]any `json:"meta,omitempty"`
}

type BlockDef struct {
	Controller string              `json:"controller"`
	View       string              `json:"view,omitempty"`
	Files      map[string]*FileDef `json:"files,omitempty"`
	Meta       map[string]any      `json:"meta,omitempty"`
}

type RuntimeOpts struct {
	TermSize shellexec.TermSize `json:"termsize,omitempty"`
	WinSize  WinSize            `json:"winsize,omitempty"`
}

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type WinSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Block struct {
	OID         string         `json:"oid"`
	Version     int            `json:"version"`
	BlockDef    *BlockDef      `json:"blockdef"`
	Controller  string         `json:"controller"`
	View        string         `json:"view"`
	Meta        map[string]any `json:"meta,omitempty"`
	RuntimeOpts *RuntimeOpts   `json:"runtimeopts,omitempty"`
}

func (*Block) GetOType() string {
	return "block"
}

func CreateTab(workspaceId string, name string) (*Tab, error) {
	tab := &Tab{
		OID:      uuid.New().String(),
		Name:     name,
		BlockIds: []string{},
	}
	TabMap.Set(tab.OID, tab)
	ws := WorkspaceMap.Get(workspaceId)
	if ws == nil {
		return nil, fmt.Errorf("workspace not found: %q", workspaceId)
	}
	ws.TabIds = append(ws.TabIds, tab.OID)
	return tab, nil
}

func CreateWorkspace() (*Workspace, error) {
	ws := &Workspace{
		OID:    uuid.New().String(),
		TabIds: []string{},
	}
	WorkspaceMap.Set(ws.OID, ws)
	_, err := CreateTab(ws.OID, "Tab 1")
	if err != nil {
		return nil, err
	}
	return ws, nil
}

func GetObject(otype string, oid string) (waveobj.WaveObj, error) {
	return nil, nil
}

func EnsureInitialData() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	clientCount, err := DBGetCount[*Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client count: %w", err)
	}
	if clientCount > 0 {
		return nil
	}
	windowId := uuid.New().String()
	workspaceId := uuid.New().String()
	tabId := uuid.New().String()
	client := &Client{
		OID:          uuid.New().String(),
		MainWindowId: windowId,
	}
	err = DBInsert(ctx, client)
	if err != nil {
		return fmt.Errorf("error inserting client: %w", err)
	}
	window := &Window{
		OID:            windowId,
		WorkspaceId:    workspaceId,
		ActiveTabId:    tabId,
		ActiveBlockMap: make(map[string]string),
		Pos: Point{
			X: 100,
			Y: 100,
		},
		WinSize: WinSize{
			Width:  800,
			Height: 600,
		},
	}
	err = DBInsert(ctx, window)
	if err != nil {
		return fmt.Errorf("error inserting window: %w", err)
	}
	ws := &Workspace{
		OID:    workspaceId,
		Name:   "default",
		TabIds: []string{tabId},
	}
	err = DBInsert(ctx, ws)
	if err != nil {
		return fmt.Errorf("error inserting workspace: %w", err)
	}
	tab := &Tab{
		OID:      tabId,
		Name:     "Tab-1",
		BlockIds: []string{},
	}
	err = DBInsert(ctx, tab)
	if err != nil {
		return fmt.Errorf("error inserting tab: %w", err)
	}
	return nil
}
