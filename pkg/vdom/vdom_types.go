// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

const TextTag = "#text"
const WaveTextTag = "wave:text"
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

type AsyncInitiationRequest struct {
	Type string `json:"type" static:"asyncinitiationrequest"`
	Ts   int64  `json:"ts"`
}

type VDomFrontendUpdate struct {
	Type          string            `json:"type" static:"frontendupdate"`
	Ts            int64             `json:"ts"`
	RequestId     string            `json:"requestid"`
	Initialize    bool              `json:"initialize,omitempty"` // initialize the app
	Resync        bool              `json:"resync,omitempty"`     // resync (send all backend data).  useful when the FE reloads
	RenderContext VDomRenderContext `json:"rendercontext,omitempty"`
	Events        []VDomEvent       `json:"events,omitempty"`
	StateSync     []VDomStateSync   `json:"statesync,omitempty"`
	RefUpdates    []VDomRefUpdate   `json:"refupdates,omitempty"`
	Messages      []VDomMessage     `json:"messages,omitempty"`
}

type VDomBackendUpdate struct {
	Type          string             `json:"type" static:"backendupdate"`
	Ts            int64              `json:"ts"`
	ResponseId    string             `json:"responseid"`
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
	Top    int `json:"top"`
	Left   int `json:"left"`
	Right  int `json:"right"`
	Bottom int `json:"bottom"`
	Width  int `json:"width"`
	Height int `json:"height"`
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
	WaveId    string `json:"waveid"`
	EventType string `json:"eventtype"`
	EventData any    `json:"eventdata"`
}

type VDomRenderContext struct {
	BlockId   string `json:"blockid"`
	Focused   bool   `json:"focused"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	ViewRefId string `json:"viewrefid"`
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

type VDomRenderUpdate struct {
	UpdateType string   `json:"updatetype" tstype:"\"root\"|\"append\"|\"replace\"|\"remove\"|\"insert\""`
	WaveId     string   `json:"waveid"`
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
