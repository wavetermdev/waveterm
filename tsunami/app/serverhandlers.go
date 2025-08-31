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
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
)

const SSEKeepAliveDuration = 5 * time.Second

type HTTPHandlers struct {
	Client     *Client
	renderLock sync.Mutex
}

func NewHTTPHandlers(client *Client) *HTTPHandlers {
	return &HTTPHandlers{
		Client: client,
	}
}

func (h *HTTPHandlers) RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/api/render", h.handleRender)
	mux.HandleFunc("/api/updates", h.handleSSE)
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

	if feUpdate.ForceTakeover {
		h.Client.ClientTakeover(feUpdate.ClientId)
	}

	if err := h.Client.CheckClientId(feUpdate.ClientId); err != nil {
		http.Error(w, fmt.Sprintf("client id error: %v", err), http.StatusBadRequest)
		return
	}

	update, err := h.processFrontendUpdate(&feUpdate)
	if err != nil {
		http.Error(w, fmt.Sprintf("render error: %v", err), http.StatusInternalServerError)
		return
	}
	if update == nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(update); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

func (h *HTTPHandlers) processFrontendUpdate(feUpdate *rpctypes.VDomFrontendUpdate) (*rpctypes.VDomBackendUpdate, error) {
	h.renderLock.Lock()
	defer h.renderLock.Unlock()

	if feUpdate.Dispose {
		log.Printf("got dispose from frontend\n")
		h.Client.doShutdown("got dispose from frontend")
		return nil, nil
	}

	if h.Client.GetIsDone() {
		return nil, nil
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
		return nil, renderErr
	}

	update.CreateTransferElems()
	return update, nil
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

func (h *HTTPHandlers) handleSSE(w http.ResponseWriter, r *http.Request) {
	defer func() {
		panicErr := util.PanicHandler("handleSSE", recover())
		if panicErr != nil {
			http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
		}
	}()

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientId := r.URL.Query().Get("clientId")
	if err := h.Client.CheckClientId(clientId); err != nil {
		http.Error(w, fmt.Sprintf("client id error: %v", err), http.StatusBadRequest)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	// Flush headers immediately
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	flusher.Flush()

	// Create a ticker for keepalive packets
	keepaliveTicker := time.NewTicker(SSEKeepAliveDuration)
	defer keepaliveTicker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepaliveTicker.C:
			// Send keepalive comment
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		case event := <-h.Client.SSEventCh:
			if event.Event == "" {
				break
			}
			fmt.Fprintf(w, "event: %s\n", event.Event)
			if len(event.Data) > 0 {
				fmt.Fprintf(w, "data: %s\n", string(event.Data))
			}
			fmt.Fprintf(w, "\n")
			flusher.Flush()
		}
	}
}
