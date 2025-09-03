// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
)

const SSEKeepAliveDuration = 5 * time.Second

func init() {
	// Add explicit mapping for .json files
	mime.AddExtensionType(".json", "application/json")
}

type HandlerOpts struct {
	AssetsFS     fs.FS
	StaticFS     fs.FS
	ManifestFile *FileHandlerOption
}

type HTTPHandlers struct {
	Client     *Client
	renderLock sync.Mutex
}

func NewHTTPHandlers(client *Client) *HTTPHandlers {
	return &HTTPHandlers{
		Client: client,
	}
}

func (h *HTTPHandlers) RegisterHandlers(mux *http.ServeMux, opts HandlerOpts) {
	mux.HandleFunc("/api/render", h.handleRender)
	mux.HandleFunc("/api/updates", h.handleSSE)
	mux.HandleFunc("/api/data", h.handleData)
	mux.HandleFunc("/api/config", h.handleConfig)
	mux.HandleFunc("/api/manifest", h.handleManifest(opts.ManifestFile))
	mux.HandleFunc("/files/", h.handleAssetsUrl)

	// Add handler for static files at /static/ path
	if opts.StaticFS != nil {
		mux.HandleFunc("/static/", h.handleStaticPathFiles(opts.StaticFS))
	}

	// Add fallback handler for embedded static files in production mode
	if opts.AssetsFS != nil {
		mux.HandleFunc("/", h.handleStaticFiles(opts.AssetsFS))
	}
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
		h.Client.clientTakeover(feUpdate.ClientId)
	}

	if err := h.Client.checkClientId(feUpdate.ClientId); err != nil {
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

func (h *HTTPHandlers) handleData(w http.ResponseWriter, r *http.Request) {
	defer func() {
		panicErr := util.PanicHandler("handleData", recover())
		if panicErr != nil {
			http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
		}
	}()

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	result := h.Client.Root.GetDataMap()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		log.Printf("failed to encode data response: %v", err)
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (h *HTTPHandlers) handleConfig(w http.ResponseWriter, r *http.Request) {
	defer func() {
		panicErr := util.PanicHandler("handleConfig", recover())
		if panicErr != nil {
			http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
		}
	}()

	switch r.Method {
	case http.MethodGet:
		h.handleConfigGet(w, r)
	case http.MethodPost:
		h.handleConfigPost(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *HTTPHandlers) handleConfigGet(w http.ResponseWriter, _ *http.Request) {
	result := h.Client.Root.GetConfigMap()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		log.Printf("failed to encode config response: %v", err)
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func (h *HTTPHandlers) handleConfigPost(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read request body: %v", err), http.StatusBadRequest)
		return
	}

	var configData map[string]any
	if err := json.Unmarshal(body, &configData); err != nil {
		http.Error(w, fmt.Sprintf("failed to parse JSON: %v", err), http.StatusBadRequest)
		return
	}

	for key, value := range configData {
		atomName := "$config." + key
		h.Client.Root.SetAtomVal(atomName, value, true)
	}

	w.WriteHeader(http.StatusOK)
}

func (h *HTTPHandlers) handleAssetsUrl(w http.ResponseWriter, r *http.Request) {
	defer func() {
		panicErr := util.PanicHandler("handleAssetsUrl", recover())
		if panicErr != nil {
			http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
		}
	}()

	// Strip /assets prefix and update the request URL
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/assets")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}

	if r.URL.Path == "/global.css" && h.Client.GlobalStylesOption != nil {
		ServeFileOption(w, r, *h.Client.GlobalStylesOption)
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
	if err := h.Client.checkClientId(clientId); err != nil {
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

// serveFileDirectly serves a file directly from an embed.FS to avoid redirect loops
// when serving directory paths that end with "/"
func serveFileDirectly(w http.ResponseWriter, r *http.Request, embeddedFS fs.FS, requestPath, fileName string) bool {
	if !strings.HasSuffix(requestPath, "/") {
		return false
	}
	
	// Try to serve the specified file from that directory
	var filePath string
	if requestPath == "/" {
		filePath = fileName
	} else {
		filePath = strings.TrimPrefix(requestPath, "/") + fileName
	}
	
	file, err := embeddedFS.Open(filePath)
	if err != nil {
		return false
	}
	defer file.Close()
	
	// Get file info for modification time
	fileInfo, err := file.Stat()
	if err != nil {
		return false
	}
	
	// Serve the file directly with proper mod time
	http.ServeContent(w, r, fileName, fileInfo.ModTime(), file.(io.ReadSeeker))
	return true
}

func (h *HTTPHandlers) handleStaticFiles(embeddedFS fs.FS) http.HandlerFunc {
	fileServer := http.FileServer(http.FS(embeddedFS))

	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			panicErr := util.PanicHandler("handleStaticFiles", recover())
			if panicErr != nil {
				http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
			}
		}()

		// Skip if this is an API, files, or static request (already handled by other handlers)
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/files/") || strings.HasPrefix(r.URL.Path, "/static/") {
			http.NotFound(w, r)
			return
		}

		// Handle any path ending with "/" to avoid redirect loops
		if serveFileDirectly(w, r, embeddedFS, r.URL.Path, "index.html") {
			return
		}

		// For other files, check if they exist before serving
		filePath := strings.TrimPrefix(r.URL.Path, "/")
		_, err := embeddedFS.Open(filePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		// Serve the file using the file server
		fileServer.ServeHTTP(w, r)
	}
}

func (h *HTTPHandlers) handleManifest(manifestFile *FileHandlerOption) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			panicErr := util.PanicHandler("handleManifest", recover())
			if panicErr != nil {
				http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
			}
		}()

		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if manifestFile == nil {
			http.NotFound(w, r)
			return
		}

		ServeFileOption(w, r, *manifestFile)
	}
}

func (h *HTTPHandlers) handleStaticPathFiles(staticFS fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			panicErr := util.PanicHandler("handleStaticPathFiles", recover())
			if panicErr != nil {
				http.Error(w, fmt.Sprintf("internal server error: %v", panicErr), http.StatusInternalServerError)
			}
		}()

		// Strip /static/ prefix from the path
		filePath := strings.TrimPrefix(r.URL.Path, "/static/")
		if filePath == "" {
			// Handle requests to "/static/" directly
			if serveFileDirectly(w, r, staticFS, "/", "index.html") {
				return
			}
			http.NotFound(w, r)
			return
		}

		// Handle directory paths ending with "/" to avoid redirect loops
		strippedPath := "/" + filePath
		if serveFileDirectly(w, r, staticFS, strippedPath, "index.html") {
			return
		}

		// Check if file exists in staticFS
		_, err := staticFS.Open(filePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		// Create a file server and serve the file
		fileServer := http.FileServer(http.FS(staticFS))

		// Temporarily modify the URL path for the file server
		originalPath := r.URL.Path
		r.URL.Path = "/" + filePath
		fileServer.ServeHTTP(w, r)
		r.URL.Path = originalPath
	}
}
