// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpctypes

import (
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const (
	BackendUpdate_InitialChunkSize = 50  // Size for initial chunks that contain both TransferElems and StateSync
	BackendUpdate_ChunkSize        = 100 // Size for subsequent chunks
)

type VDomUrlRequestData struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body,omitempty"`
}

type VDomUrlRequestResponse struct {
	StatusCode int               `json:"statuscode,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       []byte            `json:"body,omitempty"`
}

type CommandWaitForRouteData struct {
	RouteId string `json:"routeid"`
	WaitMs  int    `json:"waitms"`
}

type VDomCreateContext struct {
	Type    string         `json:"type" tstype:"\"createcontext\""`
	Ts      int64          `json:"ts"`
	Meta    map[string]any `json:"meta,omitempty"`
	Target  *VDomTarget    `json:"target,omitempty"`
	Persist bool           `json:"persist,omitempty"`
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
	HasWork       bool               `json:"haswork,omitempty"`
	RenderUpdates []VDomRenderUpdate `json:"renderupdates,omitempty"`
	TransferElems []VDomTransferElem `json:"transferelems,omitempty"`
	StateSync     []VDomStateSync    `json:"statesync,omitempty"`
	RefOperations []VDomRefOperation `json:"refoperations,omitempty"`
	Messages      []VDomMessage      `json:"messages,omitempty"`
}

// the over the wire format for a vdom element
type VDomTransferElem struct {
	WaveId   string         `json:"waveid,omitempty"` // required, except for #text nodes
	Tag      string         `json:"tag"`
	Props    map[string]any `json:"props,omitempty"`
	Children []string       `json:"children,omitempty"`
	Text     string         `json:"text,omitempty"`
}

func (beUpdate *VDomBackendUpdate) CreateTransferElems() {
	var allElems []vdom.VDomElem
	for _, renderUpdate := range beUpdate.RenderUpdates {
		if renderUpdate.VDom != nil {
			allElems = append(allElems, *renderUpdate.VDom)
		}
	}
	transferElems := ConvertElemsToTransferElems(allElems)
	beUpdate.TransferElems = DedupTransferElems(transferElems)
	for i := range beUpdate.RenderUpdates {
		beUpdate.RenderUpdates[i].VDom = nil
	}
}

func ConvertElemsToTransferElems(elems []vdom.VDomElem) []VDomTransferElem {
	var transferElems []VDomTransferElem
	textCounter := 0 // Counter for generating unique IDs for #text nodes

	// Helper function to recursively process each VDomElem in preorder
	var processElem func(elem vdom.VDomElem) string
	processElem = func(elem vdom.VDomElem) string {
		// Handle #text nodes by generating a unique placeholder ID
		if elem.Tag == "#text" {
			textId := fmt.Sprintf("text-%d", textCounter)
			textCounter++
			transferElems = append(transferElems, VDomTransferElem{
				WaveId:   textId,
				Tag:      elem.Tag,
				Text:     elem.Text,
				Props:    nil,
				Children: nil,
			})
			return textId
		}

		// Convert children to WaveId references, handling potential #text nodes
		childrenIds := make([]string, len(elem.Children))
		for i, child := range elem.Children {
			childrenIds[i] = processElem(child) // Children are not roots
		}

		// Create the VDomTransferElem for the current element
		transferElem := VDomTransferElem{
			WaveId:   elem.WaveId,
			Tag:      elem.Tag,
			Props:    elem.Props,
			Children: childrenIds,
			Text:     elem.Text,
		}
		transferElems = append(transferElems, transferElem)

		return elem.WaveId
	}

	// Start processing each top-level element, marking them as roots
	for _, elem := range elems {
		processElem(elem)
	}

	return transferElems
}

func DedupTransferElems(elems []VDomTransferElem) []VDomTransferElem {
	seen := make(map[string]int) // maps WaveId to its index in the result slice
	var result []VDomTransferElem

	for _, elem := range elems {
		if idx, exists := seen[elem.WaveId]; exists {
			// Overwrite the previous element with the latest one
			result[idx] = elem
		} else {
			// Add new element and store its index
			seen[elem.WaveId] = len(result)
			result = append(result, elem)
		}
	}

	return result
}

// SplitBackendUpdate splits a large VDomBackendUpdate into multiple smaller updates
// The first update contains all the core fields, while subsequent updates only contain
// array elements that need to be appended
func SplitBackendUpdate(update *VDomBackendUpdate) []*VDomBackendUpdate {
	if len(update.TransferElems) <= BackendUpdate_InitialChunkSize && len(update.StateSync) <= BackendUpdate_InitialChunkSize {
		return []*VDomBackendUpdate{update}
	}

	updates := make([]*VDomBackendUpdate, 0)
	transferElemChunks := util.ChunkSlice(update.TransferElems, BackendUpdate_ChunkSize)
	stateSyncChunks := util.ChunkSlice(update.StateSync, BackendUpdate_ChunkSize)

	maxChunks := len(transferElemChunks)
	if len(stateSyncChunks) > maxChunks {
		maxChunks = len(stateSyncChunks)
	}

	for i := 0; i < maxChunks; i++ {
		newUpdate := &VDomBackendUpdate{
			Type:    update.Type,
			Ts:      update.Ts,
			BlockId: update.BlockId,
		}

		if i == 0 {
			newUpdate.Opts = update.Opts
			newUpdate.HasWork = update.HasWork
			newUpdate.RenderUpdates = update.RenderUpdates
			newUpdate.RefOperations = update.RefOperations
			newUpdate.Messages = update.Messages
		}

		if i < len(transferElemChunks) {
			newUpdate.TransferElems = transferElemChunks[i]
		}

		if i < len(stateSyncChunks) {
			newUpdate.StateSync = stateSyncChunks[i]
		}

		updates = append(updates, newUpdate)
	}

	return updates
}

type VDomEvent struct {
	WaveId          string             `json:"waveid"`
	EventType       string             `json:"eventtype"` // usually the prop name (e.g. onClick, onKeyDown)
	GlobalEventType string             `json:"globaleventtype,omitempty"`
	TargetValue     string             `json:"targetvalue,omitempty"`
	TargetChecked   bool               `json:"targetchecked,omitempty"`
	TargetName      string             `json:"targetname,omitempty"`
	TargetId        string             `json:"targetid,omitempty"`
	KeyData         *WaveKeyboardEvent `json:"keydata,omitempty"`
	MouseData       *WavePointerData   `json:"mousedata,omitempty"`
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
	RefId      string                `json:"refid"`
	HasCurrent bool                  `json:"hascurrent"`
	Position   *vdom.VDomRefPosition `json:"position,omitempty"`
}

type VDomBackendOpts struct {
	CloseOnCtrlC         bool `json:"closeonctrlc,omitempty"`
	GlobalKeyboardEvents bool `json:"globalkeyboardevents,omitempty"`
	GlobalStyles         bool `json:"globalstyles,omitempty"`
}

type VDomRenderUpdate struct {
	UpdateType string         `json:"updatetype" tstype:"\"root\"|\"append\"|\"replace\"|\"remove\"|\"insert\""`
	WaveId     string         `json:"waveid,omitempty"`
	VDomWaveId string         `json:"vdomwaveid,omitempty"`
	VDom       *vdom.VDomElem `json:"vdom,omitempty"` // these get removed for transfer (encoded to transferelems)
	Index      *int           `json:"index,omitempty"`
}

type VDomRefOperation struct {
	RefId     string `json:"refid"`
	Op        string `json:"op"`
	Params    []any  `json:"params,omitempty"`
	OutputRef string `json:"outputref,omitempty"`
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
	NewBlock  bool               `json:"newblock,omitempty"`
	Magnified bool               `json:"magnified,omitempty"`
	Toolbar   *VDomTargetToolbar `json:"toolbar,omitempty"`
}

type VDomTargetToolbar struct {
	Toolbar bool   `json:"toolbar"`
	Height  string `json:"height,omitempty"`
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

type WaveKeyboardEvent struct {
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

type WavePointerData struct {
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
