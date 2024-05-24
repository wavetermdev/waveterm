// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/util/ds"
)

var WorkspaceMap = ds.NewSyncMap[*Workspace]()
var TabMap = ds.NewSyncMap[*Tab]()
var BlockMap = ds.NewSyncMap[*Block]()

type Client struct {
	ClientId     string `json:"clientid"`
	MainWindowId string `json:"mainwindowid"`
}

func (c Client) GetId() string {
	return c.ClientId
}

// stores the ui-context of the window
// workspaceid, active tab, active block within each tab, window size, etc.
type Window struct {
	WindowId       string            `json:"windowid"`
	WorkspaceId    string            `json:"workspaceid"`
	ActiveTabId    string            `json:"activetabid"`
	ActiveBlockMap map[string]string `json:"activeblockmap"` // map from tabid to blockid
	Pos            Point             `json:"pos"`
	WinSize        WinSize           `json:"winsize"`
	LastFocusTs    int64             `json:"lastfocusts"`
}

func (w Window) GetId() string {
	return w.WindowId
}

type Workspace struct {
	Lock        *sync.Mutex `json:"-"`
	WorkspaceId string      `json:"workspaceid"`
	Name        string      `json:"name"`
	TabIds      []string    `json:"tabids"`
}

func (ws Workspace) GetId() string {
	return ws.WorkspaceId
}

func (ws *Workspace) WithLock(f func()) {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	f()
}

type Tab struct {
	Lock     *sync.Mutex `json:"-"`
	TabId    string      `json:"tabid"`
	Name     string      `json:"name"`
	BlockIds []string    `json:"blockids"`
}

func (tab Tab) GetId() string {
	return tab.TabId
}

func (tab *Tab) WithLock(f func()) {
	tab.Lock.Lock()
	defer tab.Lock.Unlock()
	f()
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
	BlockId     string         `json:"blockid"`
	BlockDef    *BlockDef      `json:"blockdef"`
	Controller  string         `json:"controller"`
	View        string         `json:"view"`
	Meta        map[string]any `json:"meta,omitempty"`
	RuntimeOpts *RuntimeOpts   `json:"runtimeopts,omitempty"`
}

func (b Block) GetId() string {
	return b.BlockId
}

// TODO remove
func (b *Block) WithLock(f func()) {
	f()
}

func CreateTab(workspaceId string, name string) (*Tab, error) {
	tab := &Tab{
		Lock:     &sync.Mutex{},
		TabId:    uuid.New().String(),
		Name:     name,
		BlockIds: []string{},
	}
	TabMap.Set(tab.TabId, tab)
	ws := WorkspaceMap.Get(workspaceId)
	if ws == nil {
		return nil, fmt.Errorf("workspace not found: %q", workspaceId)
	}
	ws.WithLock(func() {
		ws.TabIds = append(ws.TabIds, tab.TabId)
	})
	return tab, nil
}

func CreateWorkspace() (*Workspace, error) {
	ws := &Workspace{
		Lock:        &sync.Mutex{},
		WorkspaceId: uuid.New().String(),
		TabIds:      []string{},
	}
	WorkspaceMap.Set(ws.WorkspaceId, ws)
	_, err := CreateTab(ws.WorkspaceId, "Tab 1")
	if err != nil {
		return nil, err
	}
	return ws, nil
}

func EnsureInitialData() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	clientCount, err := DBGetCount[Client](ctx)
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
		ClientId:     uuid.New().String(),
		MainWindowId: windowId,
	}
	err = DBInsert(ctx, client)
	if err != nil {
		return fmt.Errorf("error inserting client: %w", err)
	}
	window := &Window{
		WindowId:       windowId,
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
		WorkspaceId: workspaceId,
		Name:        "default",
		TabIds:      []string{tabId},
	}
	err = DBInsert(ctx, ws)
	if err != nil {
		return fmt.Errorf("error inserting workspace: %w", err)
	}
	tab := &Tab{
		TabId:    uuid.New().String(),
		Name:     "Tab 1",
		BlockIds: []string{},
	}
	err = DBInsert(ctx, tab)
	if err != nil {
		return fmt.Errorf("error inserting tab: %w", err)
	}
	return nil
}
