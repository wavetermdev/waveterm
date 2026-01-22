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
	Reason        string            `json:"reason,omitempty"`
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
	TransferText  []VDomText              `json:"transfertext,omitempty"`
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

type VDomText struct {
	Id   int    `json:"id"`
	Text string `json:"text"`
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
	transferElems, transferText := ConvertElemsToTransferElems(renderedElems)
	transferElems = DedupTransferElems(transferElems)
	beUpdate.TransferElems = transferElems
	beUpdate.TransferText = transferText
}

func ConvertElemsToTransferElems(elems []RenderedElem) ([]VDomTransferElem, []VDomText) {
	var transferElems []VDomTransferElem
	var transferText []VDomText
	textMap := make(map[string]int) // map text content to ID for deduplication

	// Helper function to recursively process each RenderedElem in preorder
	var processElem func(elem RenderedElem) string
	processElem = func(elem RenderedElem) string {
		// Handle #text nodes with deduplication
		if elem.Tag == "#text" {
			textId, exists := textMap[elem.Text]
			if !exists {
				// New text content, create new entry
				textId = len(textMap) + 1
				textMap[elem.Text] = textId
				transferText = append(transferText, VDomText{
					Id:   textId,
					Text: elem.Text,
				})
			}

			// Return sentinel string with ID (no VDomTransferElem created)
			textIdStr := fmt.Sprintf("t:%d", textId)
			return textIdStr
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

	return transferElems, transferText
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
	ShortDesc            string `json:"shortdesc,omitempty"`
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

// ModalConfig contains all configuration options for modals
type ModalConfig struct {
	ModalId    string `json:"modalid"`              // Unique identifier for the modal
	ModalType  string `json:"modaltype"`            // "alert" or "confirm"
	Icon       string `json:"icon,omitempty"`       // Optional icon to display (emoji or icon name)
	Title      string `json:"title"`                // Modal title
	Text       string `json:"text,omitempty"`       // Optional body text
	OkText     string `json:"oktext,omitempty"`     // Optional OK button text (defaults to "OK")
	CancelText string `json:"canceltext,omitempty"` // Optional Cancel button text for confirm modals (defaults to "Cancel")
}

// ModalResult contains the result of a modal interaction
type ModalResult struct {
	ModalId string `json:"modalid"` // ID of the modal
	Confirm bool   `json:"confirm"` // true = confirmed/ok, false = cancelled
}
