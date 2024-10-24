// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

import (
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const TextTag = "#text"
const WaveTextTag = "wave:text"
const WaveNullTag = "wave:null"
const FragmentTag = "#fragment"
const BindTag = "#bind"

const ChildrenPropKey = "children"
const KeyPropKey = "key"

const ObjectType_Ref = "ref"
const ObjectType_Binding = "binding"
const ObjectType_Func = "func"

// vdom element
type VDomElem struct {
	WaveId   string         `json:"waveid,omitempty"` // required, except for #text nodes
	Tag      string         `json:"tag"`
	Props    map[string]any `json:"props,omitempty"`
	Children []VDomElem     `json:"children,omitempty"`
	Text     string         `json:"text,omitempty"`
}

//// protocol messages

type VDomCreateContext struct {
	Type    string              `json:"type" tstype:"\"createcontext\""`
	Ts      int64               `json:"ts"`
	Meta    waveobj.MetaMapType `json:"meta,omitempty"`
	Target  *VDomTarget         `json:"target,omitempty"`
	Persist bool                `json:"persist,omitempty"`
}

type VDomAsyncInitiationRequest struct {
	Type    string `json:"type" tstype:"\"asyncinitiationrequest\""`
	Ts      int64  `json:"ts"`
	BlockId string `json:"blockid,omitempty"`
}

func MakeAsyncInitiationRequest(blockId string) VDomAsyncInitiationRequest {
	return VDomAsyncInitiationRequest{
		Type:    "asyncinitiationrequest",
		Ts:      time.Now().UnixMilli(),
		BlockId: blockId,
	}
}

type VDomFrontendUpdate struct {
	Type          string            `json:"type" tstype:"\"frontendupdate\""`
	Ts            int64             `json:"ts"`
	BlockId       string            `json:"blockid"`
	CorrelationId string            `json:"correlationid,omitempty"`
	Dispose       bool              `json:"dispose,omitempty"` // the vdom context was closed
	Resync        bool              `json:"resync,omitempty"`  // resync (send all backend data).  useful when the FE reloads
	RenderContext VDomRenderContext `json:"rendercontext,omitempty"`
	Events        []VDomEvent       `json:"events,omitempty"`
	StateSync     []VDomStateSync   `json:"statesync,omitempty"`
	RefUpdates    []VDomRefUpdate   `json:"refupdates,omitempty"`
	Messages      []VDomMessage     `json:"messages,omitempty"`
}

type VDomBackendUpdate struct {
	Type          string             `json:"type" tstype:"\"backendupdate\""`
	Ts            int64              `json:"ts"`
	BlockId       string             `json:"blockid"`
	Opts          *VDomBackendOpts   `json:"opts,omitempty"`
	RenderUpdates []VDomRenderUpdate `json:"renderupdates,omitempty"`
	StateSync     []VDomStateSync    `json:"statesync,omitempty"`
	RefOperations []VDomRefOperation `json:"refoperations,omitempty"`
	Messages      []VDomMessage      `json:"messages,omitempty"`
}

///// prop types

// used in props
type VDomBinding struct {
	Type string `json:"type" tstype:"\"binding\""`
	Bind string `json:"bind"`
}

// used in props
type VDomFunc struct {
	Fn              any      `json:"-"` // server side function (called with reflection)
	Type            string   `json:"type" tstype:"\"func\""`
	StopPropagation bool     `json:"stoppropagation,omitempty"`
	PreventDefault  bool     `json:"preventdefault,omitempty"`
	GlobalEvent     string   `json:"globalevent,omitempty"`
	Keys            []string `json:"keys,omitempty"` // special for keyDown events a list of keys to "capture"
}

// used in props
type VDomRef struct {
	Type          string           `json:"type" tstype:"\"ref\""`
	RefId         string           `json:"refid"`
	TrackPosition bool             `json:"trackposition,omitempty"`
	Position      *VDomRefPosition `json:"position,omitempty"`
	HasCurrent    bool             `json:"hascurrent,omitempty"`
}

type DomRect struct {
	Top    float64 `json:"top"`
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
	Bottom float64 `json:"bottom"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type VDomRefPosition struct {
	OffsetHeight       int     `json:"offsetheight"`
	OffsetWidth        int     `json:"offsetwidth"`
	ScrollHeight       int     `json:"scrollheight"`
	ScrollWidth        int     `json:"scrollwidth"`
	ScrollTop          int     `json:"scrolltop"`
	BoundingClientRect DomRect `json:"boundingclientrect"`
}

///// subbordinate protocol types

type VDomEvent struct {
	WaveId    string `json:"waveid"` // empty for global events
	EventType string `json:"eventtype"`
	EventData any    `json:"eventdata"`
}

type VDomRenderContext struct {
	BlockId    string `json:"blockid"`
	Focused    bool   `json:"focused"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	RootRefId  string `json:"rootrefid"`
	Background bool   `json:"background,omitempty"`
}

type VDomStateSync struct {
	Atom  string `json:"atom"`
	Value any    `json:"value"`
}

type VDomRefUpdate struct {
	RefId      string           `json:"refid"`
	HasCurrent bool             `json:"hascurrent"`
	Position   *VDomRefPosition `json:"position,omitempty"`
}

type VDomBackendOpts struct {
	CloseOnCtrlC         bool `json:"closeonctrlc,omitempty"`
	GlobalKeyboardEvents bool `json:"globalkeyboardevents,omitempty"`
}

type VDomRenderUpdate struct {
	UpdateType string   `json:"updatetype" tstype:"\"root\"|\"append\"|\"replace\"|\"remove\"|\"insert\""`
	WaveId     string   `json:"waveid,omitempty"`
	VDom       VDomElem `json:"vdom"`
	Index      *int     `json:"index,omitempty"`
}

type VDomRefOperation struct {
	RefId  string `json:"refid"`
	Op     string `json:"op" tsype:"\"focus\""`
	Params []any  `json:"params,omitempty"`
}

type VDomMessage struct {
	MessageType string `json:"messagetype"`
	Message     string `json:"message"`
	StackTrace  string `json:"stacktrace,omitempty"`
	Params      []any  `json:"params,omitempty"`
}

// target -- to support new targets in the future, like toolbars, partial blocks, splits, etc.
// default is vdom context inside of a terminal block
type VDomTarget struct {
	NewBlock  bool `json:"newblock,omitempty"`
	Magnified bool `json:"magnified,omitempty"`
}

// matches WaveKeyboardEvent
type VDomKeyboardEvent struct {
	Type     string `json:"type"`
	Key      string `json:"key"`
	Code     string `json:"code"`
	Shift    bool   `json:"shift,omitempty"`
	Control  bool   `json:"ctrl,omitempty"`
	Alt      bool   `json:"alt,omitempty"`
	Meta     bool   `json:"meta,omitempty"`
	Cmd      bool   `json:"cmd,omitempty"`
	Option   bool   `json:"option,omitempty"`
	Repeat   bool   `json:"repeat,omitempty"`
	Location int    `json:"location,omitempty"`
}
