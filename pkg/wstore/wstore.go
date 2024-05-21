// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/util/ds"
)

var WorkspaceMap = ds.NewSyncMap[*Workspace]()
var TabMap = ds.NewSyncMap[*Tab]()
var BlockMap = ds.NewSyncMap[*Block]()

type Client struct {
	DefaultWorkspaceId string `json:"defaultworkspaceid"`
}

type Workspace struct {
	Lock        *sync.Mutex `json:"-"`
	WorkspaceId string      `json:"workspaceid"`
	TabIds      []string    `json:"tabids"`
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

type WinSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Block struct {
	Lock             *sync.Mutex    `json:"-"`
	BlockId          string         `json:"blockid"`
	BlockDef         *BlockDef      `json:"blockdef"`
	Controller       string         `json:"controller"`
	ControllerStatus string         `json:"controllerstatus"`
	View             string         `json:"view"`
	Meta             map[string]any `json:"meta,omitempty"`
	RuntimeOpts      *RuntimeOpts   `json:"runtimeopts,omitempty"`
}

func (b *Block) WithLock(f func()) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
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
