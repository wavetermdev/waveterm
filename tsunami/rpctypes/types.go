// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpctypes

import (
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
	Type    string           `json:"type" tstype:"\"createcontext\""`
	Ts      int64            `json:"ts"`
	Meta    map[string]any   `json:"meta,omitempty"`
	Target  *vdom.VDomTarget `json:"target,omitempty"`
	Persist bool             `json:"persist,omitempty"`
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
	Type          string                 `json:"type" tstype:"\"frontendupdate\""`
	Ts            int64                  `json:"ts"`
	BlockId       string                 `json:"blockid"`
	CorrelationId string                 `json:"correlationid,omitempty"`
	Dispose       bool                   `json:"dispose,omitempty"` // the vdom context was closed
	Resync        bool                   `json:"resync,omitempty"`  // resync (send all backend data).  useful when the FE reloads
	RenderContext vdom.VDomRenderContext `json:"rendercontext,omitempty"`
	Events        []vdom.VDomEvent       `json:"events,omitempty"`
	StateSync     []vdom.VDomStateSync   `json:"statesync,omitempty"`
	RefUpdates    []vdom.VDomRefUpdate   `json:"refupdates,omitempty"`
	Messages      []vdom.VDomMessage     `json:"messages,omitempty"`
}

type VDomBackendUpdate struct {
	Type          string                  `json:"type" tstype:"\"backendupdate\""`
	Ts            int64                   `json:"ts"`
	BlockId       string                  `json:"blockid"`
	Opts          *vdom.VDomBackendOpts   `json:"opts,omitempty"`
	HasWork       bool                    `json:"haswork,omitempty"`
	RenderUpdates []vdom.VDomRenderUpdate `json:"renderupdates,omitempty"`
	TransferElems []vdom.VDomTransferElem `json:"transferelems,omitempty"`
	StateSync     []vdom.VDomStateSync    `json:"statesync,omitempty"`
	RefOperations []vdom.VDomRefOperation   `json:"refoperations,omitempty"`
	Messages      []vdom.VDomMessage        `json:"messages,omitempty"`
}

func (beUpdate *VDomBackendUpdate) CreateTransferElems() {
	var allElems []vdom.VDomElem
	for _, renderUpdate := range beUpdate.RenderUpdates {
		if renderUpdate.VDom != nil {
			allElems = append(allElems, *renderUpdate.VDom)
		}
	}
	transferElems := vdom.ConvertElemsToTransferElems(allElems)
	beUpdate.TransferElems = vdom.DedupTransferElems(transferElems)
	for i := range beUpdate.RenderUpdates {
		beUpdate.RenderUpdates[i].VDom = nil
	}
}

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
