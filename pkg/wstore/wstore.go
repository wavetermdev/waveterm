// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/util/ds"
)

var WorkspaceMap = ds.NewSyncMap[*Workspace]()
var TabMap = ds.NewSyncMap[*Tab]()
var BlockMap = ds.NewSyncMap[*Block]()

type Workspace struct {
	WorkspaceId string   `json:"workspaceid"`
	TabIds      []string `json:"tabids"`
}

type Tab struct {
	TabId    string   `json:"tabid"`
	Name     string   `json:"name"`
	BlockIds []string `json:"blockids"`
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
