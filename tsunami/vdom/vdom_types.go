// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdom

const TextTag = "#text"
const WaveTextTag = "wave:text"
const WaveNullTag = "wave:null"
const FragmentTag = "#fragment"

const KeyPropKey = "key"

const ObjectType_Ref = "ref"
const ObjectType_Func = "func"

// vdom element
type VDomElem struct {
	Tag      string         `json:"tag"`
	Props    map[string]any `json:"props,omitempty"`
	Children []VDomElem     `json:"children,omitempty"`
	Text     string         `json:"text,omitempty"`
}

// used in props
type VDomFunc struct {
	Fn              any      `json:"-"` // server side function (called with reflection)
	Type            string   `json:"type" tstype:"\"func\""`
	StopPropagation bool     `json:"stoppropagation,omitempty"` // set to call e.stopPropagation() on the client side
	PreventDefault  bool     `json:"preventdefault,omitempty"`  // set to call e.preventDefault() on the client side
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

type VDomSimpleRef[T any] struct {
	Current T `json:"current"`
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

type VDomEvent struct {
	WaveId          string             `json:"waveid"`
	EventType       string             `json:"eventtype"` // usually the prop name (e.g. onClick, onKeyDown)
	GlobalEventType string             `json:"globaleventtype,omitempty"`
	TargetValue     string             `json:"targetvalue,omitempty"` // set for onChange events on input/textarea/select
	TargetChecked   bool               `json:"targetchecked,omitempty"` // set for onChange events on checkbox/radio inputs
	TargetName      string             `json:"targetname,omitempty"` // target element's name attribute
	TargetId        string             `json:"targetid,omitempty"` // target element's id attribute
	TargetFiles     []VDomFileData     `json:"targetfiles,omitempty"` // set for onChange events on file inputs
	KeyData         *VDomKeyboardEvent `json:"keydata,omitempty"` // set for onKeyDown events
	MouseData       *VDomPointerData   `json:"mousedata,omitempty"` // set for onClick, onMouseDown, onMouseUp, onDoubleClick events
	FormData        *VDomFormData      `json:"formdata,omitempty"` // set for onSubmit events on forms
}

type VDomKeyboardEvent struct {
	Type     string `json:"type" tstype:"\"keydown\"|\"keyup\"|\"keypress\"|\"unknown\""`
	Key      string `json:"key"`  // KeyboardEvent.key
	Code     string `json:"code"` // KeyboardEvent.code
	Repeat   bool   `json:"repeat,omitempty"`
	Location int    `json:"location,omitempty"` // KeyboardEvent.location

	// modifiers
	Shift   bool `json:"shift,omitempty"`
	Control bool `json:"control,omitempty"`
	Alt     bool `json:"alt,omitempty"`
	Meta    bool `json:"meta,omitempty"`
	Cmd     bool `json:"cmd,omitempty"`    // special (on mac it is meta, on windows/linux it is alt)
	Option  bool `json:"option,omitempty"` // special (on mac it is alt, on windows/linux it is meta)
}

type VDomPointerData struct {
	Button  int `json:"button"`
	Buttons int `json:"buttons"`

	ClientX   int `json:"clientx,omitempty"`
	ClientY   int `json:"clienty,omitempty"`
	PageX     int `json:"pagex,omitempty"`
	PageY     int `json:"pagey,omitempty"`
	ScreenX   int `json:"screenx,omitempty"`
	ScreenY   int `json:"screeny,omitempty"`
	MovementX int `json:"movementx,omitempty"`
	MovementY int `json:"movementy,omitempty"`

	// Modifiers
	Shift   bool `json:"shift,omitempty"`
	Control bool `json:"control,omitempty"`
	Alt     bool `json:"alt,omitempty"`
	Meta    bool `json:"meta,omitempty"`
	Cmd     bool `json:"cmd,omitempty"`    // special (on mac it is meta, on windows/linux it is alt)
	Option  bool `json:"option,omitempty"` // special (on mac it is alt, on windows/linux it is meta)
}

type VDomFormData struct {
	Action   string                     `json:"action,omitempty"`
	Method   string                     `json:"method"`
	Enctype  string                     `json:"enctype"`
	FormId   string                     `json:"formid,omitempty"`
	FormName string                     `json:"formname,omitempty"`
	Fields   map[string][]string        `json:"fields"`
	Files    map[string][]VDomFileData  `json:"files"`
}

func (f *VDomFormData) GetField(fieldName string) string {
	if f.Fields == nil {
		return ""
	}
	values := f.Fields[fieldName]
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

type VDomFileData struct {
	FieldName string `json:"fieldname"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Type      string `json:"type"`
	Data64    []byte `json:"data64,omitempty"`
	Error     string `json:"error,omitempty"`
}

type VDomRefOperation struct {
	RefId     string `json:"refid"`
	Op        string `json:"op"`
	Params    []any  `json:"params,omitempty"`
	OutputRef string `json:"outputref,omitempty"`
}
