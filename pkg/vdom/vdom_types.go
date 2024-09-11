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
type VElem struct {
	WaveId   string         `json:"waveid"`
	Tag      string         `json:"tag"`
	Props    map[string]any `json:"props,omitempty"`
	Children []VElem        `json:"children,omitempty"`
	Text     string         `json:"text,omitempty"`
}

//// protocol messages

type AsyncInitiationRequest struct {
	Type string `json:"type" static:"asyncinitiationrequest"`
	Ts   int64  `json:"ts"`
}

type FrontendUpdate struct {
	Type       string         `json:"type" static:"frontendupdate"`
	Ts         int64          `json:"ts"`
	RequestId  string         `json:"requestid"`
	Events     []Event        `json:"events,omitempty"`
	StateSync  []StateSync    `json:"statesync,omitempty"`
	RefUpdates []RefUpdate    `json:"refupdates,omitempty"`
	Messages   []MessageEvent `json:"messages,omitempty"`
}

type BackendUpdate struct {
	Type          string         `json:"type" static:"backendupdate"`
	Ts            int64          `json:"ts"`
	ResponseId    string         `json:"responseid"`
	RenderUpdates []RenderUpdate `json:"renderupdates,omitempty"`
	StateSync     []StateSync    `json:"statesync,omitempty"`
	RefOperations []RefOperation `json:"refoperations,omitempty"`
	Messages      []MessageEvent `json:"messages,omitempty"`
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
	Keys            []string `json:"#keys,omitempty"` // special for keyDown events a list of keys to "capture"
}

// used in props
type VDomRef struct {
	Type    string `json:"type" tstype:"\"ref\""`
	RefId   string `json:"refid"`
	Current any    `json:"current,omitempty"`
}

///// subbordinate protocol types

type Event struct {
	WaveId    string `json:"waveid"`
	EventType string `json:"eventtype"`
	EventData any    `json:"eventdata"`
}

type StateSync struct {
	Atom  string `json:"atom"`
	Value any    `json:"value"`
}

type RefUpdate struct {
	RefId   string `json:"refid"`
	Current any    `json:"current"`
}

type RenderUpdate struct {
	WaveId string `json:"waveid"`
	VDom   VElem  `json:"vdom"`
}

type RefOperation struct {
	RefId     string `json:"refid"`
	Operation string `json:"operation"`
	Params    []any  `json:"params,omitempty"`
}

type MessageEvent struct {
	MessageType string `json:"messagetype"`
	Message     string `json:"content"`
	StackTrace  string `json:"stacktrace,omitempty"`
	Params      []any  `json:"params,omitempty"`
}
