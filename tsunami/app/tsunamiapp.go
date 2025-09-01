// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/wavetermdev/waveterm/tsunami/comp"
	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const TsunamiListenAddrEnvVar = "TSUNAMI_LISTENADDR"
const DefaultListenAddr = "localhost:0"

type SSEvent struct {
	Event string
	Data  []byte
}

type AppOpts struct {
	CloseOnCtrlC         bool
	GlobalKeyboardEvents bool
	GlobalStyles         []byte
	RootComponentName    string // defaults to "App"
}

type Client struct {
	Lock               *sync.Mutex
	AppOpts            AppOpts
	Root               *comp.RootElem
	RootElem           *vdom.VDomElem
	CurrentClientId    string
	IsDone             bool
	DoneReason         string
	DoneCh             chan struct{}
	SSEventCh          chan SSEvent
	Opts               rpctypes.VDomBackendOpts
	GlobalEventHandler func(client *Client, event vdom.VDomEvent)
	GlobalStylesOption *FileHandlerOption
	UrlHandlerMux      *mux.Router
	OverrideUrlHandler http.Handler
	SetupFn            func()
}

func (c *Client) GetIsDone() bool {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	return c.IsDone
}

func (c *Client) CheckClientId(clientId string) error {
	if clientId == "" {
		return fmt.Errorf("client id cannot be empty")
	}
	c.Lock.Lock()
	defer c.Lock.Unlock()
	if c.CurrentClientId == "" || c.CurrentClientId == clientId {
		c.CurrentClientId = clientId
		return nil
	}
	return fmt.Errorf("client id mismatch: expected %s, got %s", c.CurrentClientId, clientId)
}

func (c *Client) ClientTakeover(clientId string) {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	c.CurrentClientId = clientId
}

func (c *Client) doShutdown(reason string) {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	if c.IsDone {
		return
	}
	c.DoneReason = reason
	c.IsDone = true
	close(c.DoneCh)
}

func (c *Client) SetGlobalEventHandler(handler func(client *Client, event vdom.VDomEvent)) {
	c.GlobalEventHandler = handler
}

func (c *Client) SetOverrideUrlHandler(handler http.Handler) {
	c.OverrideUrlHandler = handler
}

func MakeClient(appOpts AppOpts) *Client {
	if appOpts.RootComponentName == "" {
		appOpts.RootComponentName = "App"
	}
	client := &Client{
		Lock:          &sync.Mutex{},
		AppOpts:       appOpts,
		Root:          comp.MakeRoot(),
		DoneCh:        make(chan struct{}),
		SSEventCh:     make(chan SSEvent, 100),
		UrlHandlerMux: mux.NewRouter(),
		Opts: rpctypes.VDomBackendOpts{
			CloseOnCtrlC:         appOpts.CloseOnCtrlC,
			GlobalKeyboardEvents: appOpts.GlobalKeyboardEvents,
		},
	}
	if len(appOpts.GlobalStyles) > 0 {
		client.Opts.GlobalStyles = true
		client.GlobalStylesOption = &FileHandlerOption{Data: appOpts.GlobalStyles, MimeType: "text/css"}
	}
	client.SetRootElem(vdom.E(appOpts.RootComponentName))
	return client
}

func (c *Client) runMainE() error {
	if c.SetupFn != nil {
		c.SetupFn()
	}
	err := c.ListenAndServe(context.Background())
	if err != nil {
		return err
	}
	<-c.DoneCh
	return nil
}

func (c *Client) AddSetupFn(fn func()) {
	c.SetupFn = fn
}

func (c *Client) RunMain() {
	err := c.runMainE()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func (c *Client) ListenAndServe(ctx context.Context) error {
	// Create HTTP handlers
	handlers := NewHTTPHandlers(c)

	// Create a new ServeMux and register handlers
	mux := http.NewServeMux()
	handlers.RegisterHandlers(mux)

	// Determine listen address from environment variable or use default
	listenAddr := os.Getenv(TsunamiListenAddrEnvVar)
	if listenAddr == "" {
		listenAddr = DefaultListenAddr
	}

	// Create server and listen on specified address
	server := &http.Server{
		Addr:    listenAddr,
		Handler: mux,
	}

	// Start listening
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen: %v", err)
	}

	// Log the port we're listening on
	port := listener.Addr().(*net.TCPAddr).Port
	log.Printf("Wave app server listening on port %d", port)

	// Serve in a goroutine so we don't block
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP server error: %v", err)
		}
	}()

	// Wait for context cancellation and shutdown server gracefully
	go func() {
		<-ctx.Done()
		log.Printf("Context canceled, shutting down server...")
		if err := server.Shutdown(context.Background()); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
	}()

	return nil
}

func (c *Client) SetRootElem(elem *vdom.VDomElem) {
	c.RootElem = elem
}

func (c *Client) SendAsyncInitiation() error {
	if c.GetIsDone() {
		return fmt.Errorf("client is done")
	}

	select {
	case c.SSEventCh <- SSEvent{Event: "asyncinitiation", Data: nil}:
		return nil
	default:
		return fmt.Errorf("SSEvent channel is full")
	}
}

func (c *Client) SetAtomVals(m map[string]any) {
	for k, v := range m {
		c.Root.SetAtomVal(k, v, true)
	}
}

func (c *Client) SetAtomVal(name string, val any) {
	c.Root.SetAtomVal(name, val, true)
}

func (c *Client) GetAtomVal(name string) any {
	return c.Root.GetAtomVal(name)
}

func makeNullVDom() *vdom.VDomElem {
	return &vdom.VDomElem{WaveId: uuid.New().String(), Tag: vdom.WaveNullTag}
}

func DefineComponent[P any](client *Client, name string, renderFn func(ctx context.Context, props P) any) vdom.Component[P] {
	if name == "" {
		panic("Component name cannot be empty")
	}
	if !unicode.IsUpper(rune(name[0])) {
		panic("Component name must start with an uppercase letter")
	}
	err := client.RegisterComponent(name, renderFn)
	if err != nil {
		panic(err)
	}
	return func(props P) *vdom.VDomElem {
		return vdom.E(name, vdom.Props(props))
	}
}

func (c *Client) RegisterComponent(name string, cfunc any) error {
	return c.Root.RegisterComponent(name, cfunc)
}

func (c *Client) fullRender() (*rpctypes.VDomBackendUpdate, error) {
	c.Root.RunWork()
	c.Root.Render(c.RootElem)
	renderedVDom := c.Root.MakeVDom()
	if renderedVDom == nil {
		renderedVDom = makeNullVDom()
	}
	return &rpctypes.VDomBackendUpdate{
		Type:    "backendupdate",
		Ts:      time.Now().UnixMilli(),
		HasWork: len(c.Root.EffectWorkQueue) > 0,
		Opts:    &c.Opts,
		RenderUpdates: []rpctypes.VDomRenderUpdate{
			{UpdateType: "root", VDom: renderedVDom},
		},
		RefOperations: c.Root.GetRefOperations(),
		StateSync:     c.Root.GetStateSync(true),
	}, nil
}

func (c *Client) incrementalRender() (*rpctypes.VDomBackendUpdate, error) {
	c.Root.RunWork()
	renderedVDom := c.Root.MakeVDom()
	if renderedVDom == nil {
		renderedVDom = makeNullVDom()
	}
	return &rpctypes.VDomBackendUpdate{
		Type: "backendupdate",
		Ts:   time.Now().UnixMilli(),
		RenderUpdates: []rpctypes.VDomRenderUpdate{
			{UpdateType: "root", VDom: renderedVDom},
		},
		RefOperations: c.Root.GetRefOperations(),
		StateSync:     c.Root.GetStateSync(false),
	}, nil
}

func (c *Client) RegisterUrlPathHandler(path string, handler http.Handler) {
	c.UrlHandlerMux.Handle(path, handler)
}

type FileHandlerOption struct {
	FilePath string    // optional file path on disk
	Data     []byte    // optional byte slice content
	Reader   io.Reader // optional reader for content
	File     fs.File   // optional embedded or opened file
	MimeType string    // optional mime type
	ETag     string    // optional ETag (if set, resource may be cached)
}

func determineMimeType(option FileHandlerOption) (string, []byte) {
	// If MimeType is set, use it directly
	if option.MimeType != "" {
		return option.MimeType, nil
	}

	// Detect from Data if available, no need to buffer
	if option.Data != nil {
		return http.DetectContentType(option.Data), nil
	}

	// Detect from FilePath, no buffering necessary
	if option.FilePath != "" {
		filePath := util.ExpandHomeDirSafe(option.FilePath)
		file, err := os.Open(filePath)
		if err != nil {
			return "application/octet-stream", nil // Fallback on error
		}
		defer file.Close()

		// Read first 512 bytes for MIME detection
		buf := make([]byte, 512)
		_, err = file.Read(buf)
		if err != nil && err != io.EOF {
			return "application/octet-stream", nil
		}
		return http.DetectContentType(buf), nil
	}

	// Buffer for File (fs.File), since it lacks Seek
	if option.File != nil {
		buf := make([]byte, 512)
		n, err := option.File.Read(buf)
		if err != nil && err != io.EOF {
			return "application/octet-stream", nil
		}
		return http.DetectContentType(buf[:n]), buf[:n]
	}

	// Buffer for Reader (io.Reader), same as File
	if option.Reader != nil {
		buf := make([]byte, 512)
		n, err := option.Reader.Read(buf)
		if err != nil && err != io.EOF {
			return "application/octet-stream", nil
		}
		return http.DetectContentType(buf[:n]), buf[:n]
	}

	// Default MIME type if none specified
	return "application/octet-stream", nil
}

// ServeFileOption handles serving content based on the provided FileHandlerOption
func ServeFileOption(w http.ResponseWriter, r *http.Request, option FileHandlerOption) error {
	// Determine MIME type and get buffered data if needed
	contentType, bufferedData := determineMimeType(option)
	w.Header().Set("Content-Type", contentType)
	// Handle ETag
	if option.ETag != "" {
		w.Header().Set("ETag", option.ETag)

		// Check If-None-Match header
		if inm := r.Header.Get("If-None-Match"); inm != "" {
			// Strip W/ prefix and quotes if present
			inm = strings.Trim(inm, `"`)
			inm = strings.TrimPrefix(inm, "W/")
			etag := strings.Trim(option.ETag, `"`)
			etag = strings.TrimPrefix(etag, "W/")

			if inm == etag {
				// Resource not modified
				w.WriteHeader(http.StatusNotModified)
				return nil
			}
		}
	}

	// Handle the content based on the option type
	switch {
	case option.FilePath != "":
		filePath := util.ExpandHomeDirSafe(option.FilePath)
		http.ServeFile(w, r, filePath)

	case option.Data != nil:
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(option.Data)))
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(option.Data); err != nil {
			return fmt.Errorf("failed to write data: %v", err)
		}

	case option.File != nil:
		if bufferedData != nil {
			if _, err := w.Write(bufferedData); err != nil {
				return fmt.Errorf("failed to write buffered data: %v", err)
			}
		}
		if _, err := io.Copy(w, option.File); err != nil {
			return fmt.Errorf("failed to copy from file: %v", err)
		}

	case option.Reader != nil:
		if bufferedData != nil {
			if _, err := w.Write(bufferedData); err != nil {
				return fmt.Errorf("failed to write buffered data: %v", err)
			}
		}
		if _, err := io.Copy(w, option.Reader); err != nil {
			return fmt.Errorf("failed to copy from reader: %v", err)
		}

	default:
		return fmt.Errorf("no content available")
	}

	return nil
}

func (c *Client) RegisterFilePrefixHandler(prefix string, optionProvider func(path string) (*FileHandlerOption, error)) {
	c.UrlHandlerMux.PathPrefix(prefix).HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		option, err := optionProvider(r.URL.Path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if option == nil {
			http.Error(w, "no content available", http.StatusNotFound)
			return
		}
		if err := ServeFileOption(w, r, *option); err != nil {
			http.Error(w, fmt.Sprintf("Failed to serve content: %v", err), http.StatusInternalServerError)
		}
	})
}

func (c *Client) RegisterFileHandler(path string, option FileHandlerOption) {
	c.UrlHandlerMux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		if err := ServeFileOption(w, r, option); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
}
