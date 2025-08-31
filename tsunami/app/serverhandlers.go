// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveapp

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
)

type HTTPHandlers struct {
	Client  *Client
	BlockId string
}

func NewHTTPHandlers(client *Client, blockId string) *HTTPHandlers {
	return &HTTPHandlers{
		Client:  client,
		BlockId: blockId,
	}
}

func (h *HTTPHandlers) RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/api/render", h.handleRender)
	mux.HandleFunc("/vdom/", h.handleVDomUrl)
}

func (h *HTTPHandlers) handleRender(w http.ResponseWriter, r *http.Request) {
	defer func() {
		panicErr := util.PanicHandler("handleRender", recover())
		if panicErr != nil {
			http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
		}
	}()

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read request body: %v", err), http.StatusBadRequest)
		return
	}

	var feUpdate rpctypes.VDomFrontendUpdate
	if err := json.Unmarshal(body, &feUpdate); err != nil {
		http.Error(w, fmt.Sprintf("failed to parse JSON: %v", err), http.StatusBadRequest)
		return
	}

	if feUpdate.Dispose {
		log.Printf("got dispose from frontend\n")
		h.Client.doShutdown("got dispose from frontend")
		w.WriteHeader(http.StatusOK)
		return
	}

	if h.Client.GetIsDone() {
		w.WriteHeader(http.StatusOK)
		return
	}

	h.Client.Root.RenderTs = feUpdate.Ts

	// set atoms
	for _, ss := range feUpdate.StateSync {
		h.Client.Root.SetAtomVal(ss.Atom, ss.Value, false)
	}
	// run events
	for _, event := range feUpdate.Events {
		if event.GlobalEventType != "" {
			if h.Client.GlobalEventHandler != nil {
				h.Client.GlobalEventHandler(h.Client, event)
			}
		} else {
			h.Client.Root.Event(event.WaveId, event.EventType, event)
		}
	}
	// update refs
	for _, ref := range feUpdate.RefUpdates {
		h.Client.Root.UpdateRef(ref)
	}

	var update *rpctypes.VDomBackendUpdate
	var renderErr error

	if feUpdate.Resync || true {
		update, renderErr = h.Client.fullRender()
	} else {
		update, renderErr = h.Client.incrementalRender()
	}

	if renderErr != nil {
		http.Error(w, fmt.Sprintf("render error: %v", renderErr), http.StatusInternalServerError)
		return
	}

	update.CreateTransferElems()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(update); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

func (h *HTTPHandlers) handleVDomUrl(w http.ResponseWriter, r *http.Request) {
	defer func() {
		panicErr := util.PanicHandler("handleVDomUrl", recover())
		if panicErr != nil {
			http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
		}
	}()

	// Strip /vdom prefix and update the request URL
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/vdom")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}

	if r.URL.Path == "/wave/global.css" && h.Client.GlobalStylesOption != nil {
		ServeFileOption(w, r, *h.Client.GlobalStylesOption)
		return
	}
	if h.Client.OverrideUrlHandler != nil {
		h.Client.OverrideUrlHandler.ServeHTTP(w, r)
		return
	}
	h.Client.UrlHandlerMux.ServeHTTP(w, r)
}
