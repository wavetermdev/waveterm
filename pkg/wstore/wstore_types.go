// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"encoding/json"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

type UIContext struct {
	WindowId    string `json:"windowid"`
	ActiveTabId string `json:"activetabid"`
}

const (
	UpdateType_Update = "update"
	UpdateType_Delete = "delete"
)

type WaveObjUpdate struct {
	UpdateType string          `json:"updatetype"`
	OType      string          `json:"otype"`
	OID        string          `json:"oid"`
	Obj        waveobj.WaveObj `json:"obj,omitempty"`
}

func (update WaveObjUpdate) MarshalJSON() ([]byte, error) {
	rtn := make(map[string]any)
	rtn["updatetype"] = update.UpdateType
	rtn["otype"] = update.OType
	rtn["oid"] = update.OID
	if update.Obj != nil {
		var err error
		rtn["obj"], err = waveobj.ToJsonMap(update.Obj)
		if err != nil {
			return nil, err
		}
	}
	return json.Marshal(rtn)
}

type Client struct {
	OID          string         `json:"oid"`
	Version      int            `json:"version"`
	MainWindowId string         `json:"mainwindowid"`
	Meta         map[string]any `json:"meta"`
}

func (*Client) GetOType() string {
	return "client"
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
	Meta           map[string]any    `json:"meta"`
}

func (*Window) GetOType() string {
	return "window"
}

type Workspace struct {
	OID     string         `json:"oid"`
	Version int            `json:"version"`
	Name    string         `json:"name"`
	TabIds  []string       `json:"tabids"`
	Meta    map[string]any `json:"meta"`
}

func (*Workspace) GetOType() string {
	return "workspace"
}

type Tab struct {
	OID      string         `json:"oid"`
	Version  int            `json:"version"`
	Name     string         `json:"name"`
	BlockIds []string       `json:"blockids"`
	Meta     map[string]any `json:"meta"`
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
	Controller string              `json:"controller,omitempty"`
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
	RuntimeOpts *RuntimeOpts   `json:"runtimeopts,omitempty"`
	Meta        map[string]any `json:"meta"`
}

func (*Block) GetOType() string {
	return "block"
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
