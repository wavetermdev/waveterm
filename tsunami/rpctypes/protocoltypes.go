// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpctypes

import (
	"fmt"

	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// rendered element (output from rendering pipeline)
type RenderedElem struct {
	WaveId   string         `json:"waveid,omitempty"` // required, except for #text nodes
	Tag      string         `json:"tag"`
	Props    map[string]any `json:"props,omitempty"`
	Children []RenderedElem `json:"children,omitempty"`
	Text     string         `json:"text,omitempty"`
}

type VDomUrlRequestResponse struct {
	StatusCode int               `json:"statuscode,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       []byte            `json:"body,omitempty"`
}

type VDomFrontendUpdate struct {
	Type          string            `json:"type" tstype:"\"frontendupdate\""`
	Ts            int64             `json:"ts"`
	ClientId      string            `json:"clientid"`
	ForceTakeover bool              `json:"forcetakeover,omitempty"`
	CorrelationId string            `json:"correlationid,omitempty"`
	Dispose       bool              `json:"dispose,omitempty"` // the vdom context was closed
	Resync        bool              `json:"resync,omitempty"`  // resync (send all backend data).  useful when the FE reloads
	RenderContext VDomRenderContext `json:"rendercontext,omitempty"`
	Events        []vdom.VDomEvent  `json:"events,omitempty"`
	RefUpdates    []VDomRefUpdate   `json:"refupdates,omitempty"`
	Messages      []VDomMessage     `json:"messages,omitempty"`
}

type VDomBackendUpdate struct {
	Type          string                  `json:"type" tstype:"\"backendupdate\""`
	Ts            int64                   `json:"ts"`
	ServerId      string                  `json:"serverid"`
	Opts          *VDomBackendOpts        `json:"opts,omitempty"`
	HasWork       bool                    `json:"haswork,omitempty"`
	FullUpdate    bool                    `json:"fullupdate,omitempty"`
	RenderUpdates []VDomRenderUpdate      `json:"renderupdates,omitempty"`
	TransferElems []VDomTransferElem      `json:"transferelems,omitempty"`
	RefOperations []vdom.VDomRefOperation `json:"refoperations,omitempty"`
	Messages      []VDomMessage           `json:"messages,omitempty"`
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
	var renderedElems []RenderedElem
	for idx, reUpdate := range beUpdate.RenderUpdates {
		if reUpdate.VDom == nil {
			continue
		}
		renderedElems = append(renderedElems, *reUpdate.VDom)
		beUpdate.RenderUpdates[idx].VDomWaveId = reUpdate.VDom.WaveId
		beUpdate.RenderUpdates[idx].VDom = nil
	}
	transferElems := ConvertElemsToTransferElems(renderedElems)
	transferElems = DedupTransferElems(transferElems)
	beUpdate.TransferElems = transferElems
}

func ConvertElemsToTransferElems(elems []RenderedElem) []VDomTransferElem {
	var transferElems []VDomTransferElem
	textCounter := 0 // Counter for generating unique IDs for #text nodes

	// Helper function to recursively process each RenderedElem in preorder
	var processElem func(elem RenderedElem) string
	processElem = func(elem RenderedElem) string {
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

type VDomRenderContext struct {
	Focused    bool   `json:"focused"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	RootRefId  string `json:"rootrefid"`
	Background bool   `json:"background,omitempty"`
}

type VDomRefUpdate struct {
	RefId      string                `json:"refid"`
	HasCurrent bool                  `json:"hascurrent"`
	Position   *vdom.VDomRefPosition `json:"position,omitempty"`
}

type VDomBackendOpts struct {
	Title                string `json:"title,omitempty"`
	GlobalKeyboardEvents bool   `json:"globalkeyboardevents,omitempty"`
	FaviconPath          string `json:"faviconpath,omitempty"`
}

type VDomRenderUpdate struct {
	UpdateType string        `json:"updatetype" tstype:"\"root\"|\"append\"|\"replace\"|\"remove\"|\"insert\""`
	WaveId     string        `json:"waveid,omitempty"`
	VDomWaveId string        `json:"vdomwaveid,omitempty"`
	VDom       *RenderedElem `json:"vdom,omitempty"` // these get removed for transfer (encoded to transferelems)
	Index      *int          `json:"index,omitempty"`
}

type VDomMessage struct {
	MessageType string `json:"messagetype"`
	Message     string `json:"message"`
	StackTrace  string `json:"stacktrace,omitempty"`
	Params      []any  `json:"params,omitempty"`
}
