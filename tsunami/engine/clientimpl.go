// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"context"
	"fmt"
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
	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const TsunamiListenAddrEnvVar = "TSUNAMI_LISTENADDR"
const DefaultListenAddr = "localhost:0"
const DefaultComponentName = "App"

const NotifyMaxCadence = 10 * time.Millisecond
const NotifyDebounceTime = 500 * time.Microsecond
const NotifyMaxDebounceTime = 2 * time.Millisecond

type ssEvent struct {
	Event string
	Data  []byte
}

var defaultClient = makeClient()

type ClientImpl struct {
	Lock               *sync.Mutex
	Root               *RootElem
	RootElem           *vdom.VDomElem
	CurrentClientId    string
	ServerId           string
	IsDone             bool
	DoneReason         string
	DoneCh             chan struct{}
	SSEventCh          chan ssEvent
	GlobalEventHandler func(event vdom.VDomEvent)
	UrlHandlerMux      *http.ServeMux
	SetupFn            func()
	AssetsFS           fs.FS
	StaticFS           fs.FS
	ManifestFileBytes  []byte
}

func makeClient() *ClientImpl {
	client := &ClientImpl{
		Lock:          &sync.Mutex{},
		DoneCh:        make(chan struct{}),
		SSEventCh:     make(chan ssEvent, 100),
		UrlHandlerMux: http.NewServeMux(),
		ServerId:      uuid.New().String(),
		RootElem:      vdom.H(DefaultComponentName, nil),
	}
	client.Root = MakeRoot(client)
	return client
}

func GetDefaultClient() *ClientImpl {
	return defaultClient
}

func (c *ClientImpl) GetIsDone() bool {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	return c.IsDone
}

func (c *ClientImpl) checkClientId(clientId string) error {
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

func (c *ClientImpl) clientTakeover(clientId string) {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	c.CurrentClientId = clientId
}

func (c *ClientImpl) doShutdown(reason string) {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	if c.IsDone {
		return
	}
	c.DoneReason = reason
	c.IsDone = true
	close(c.DoneCh)
}

func (c *ClientImpl) SetGlobalEventHandler(handler func(event vdom.VDomEvent)) {
	c.GlobalEventHandler = handler
}

func (c *ClientImpl) getFaviconPath() string {
	if c.StaticFS != nil {
		faviconNames := []string{"favicon.ico", "favicon.png", "favicon.svg", "favicon.gif", "favicon.jpg"}
		for _, name := range faviconNames {
			if _, err := c.StaticFS.Open(name); err == nil {
				return "/static/" + name
			}
		}
	}
	return "/wave-logo-256.png"
}

func (c *ClientImpl) makeBackendOpts() *rpctypes.VDomBackendOpts {
	return &rpctypes.VDomBackendOpts{
		Title:                c.Root.AppTitle,
		GlobalKeyboardEvents: c.GlobalEventHandler != nil,
		FaviconPath:          c.getFaviconPath(),
	}
}

func (c *ClientImpl) runMainE() error {
	if c.SetupFn != nil {
		c.SetupFn()
	}
	err := c.listenAndServe(context.Background())
	if err != nil {
		return err
	}
	<-c.DoneCh
	return nil
}

func (c *ClientImpl) RegisterSetupFn(fn func()) {
	c.SetupFn = fn
}

func (c *ClientImpl) RunMain() {
	err := c.runMainE()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func (c *ClientImpl) listenAndServe(ctx context.Context) error {
	// Create HTTP handlers
	handlers := newHTTPHandlers(c)

	// Create a new ServeMux and register handlers
	mux := http.NewServeMux()
	handlers.registerHandlers(mux, handlerOpts{
		AssetsFS:     c.AssetsFS,
		StaticFS:     c.StaticFS,
		ManifestFile: c.ManifestFileBytes,
	})

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

	// Log the address we're listening on
	port := listener.Addr().(*net.TCPAddr).Port
	log.Printf("[tsunami] listening at http://localhost:%d", port)

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

func (c *ClientImpl) SendAsyncInitiation() error {
	if c.GetIsDone() {
		return fmt.Errorf("client is done")
	}

	select {
	case c.SSEventCh <- ssEvent{Event: "asyncinitiation", Data: nil}:
		return nil
	default:
		return fmt.Errorf("SSEvent channel is full")
	}
}

func (c *ClientImpl) notifyAsyncRenderWork() {
	// TODO
}

func makeNullRendered() *rpctypes.RenderedElem {
	return &rpctypes.RenderedElem{WaveId: uuid.New().String(), Tag: vdom.WaveNullTag}
}

func structToProps(props any) map[string]any {
	m, err := util.StructToMap(props)
	if err != nil {
		return nil
	}
	return m
}

func DefineComponentEx[P any](client *ClientImpl, name string, renderFn func(props P) any) vdom.Component[P] {
	if name == "" {
		panic("Component name cannot be empty")
	}
	if !unicode.IsUpper(rune(name[0])) {
		panic("Component name must start with an uppercase letter")
	}
	err := client.registerComponent(name, renderFn)
	if err != nil {
		panic(err)
	}
	return func(props P) *vdom.VDomElem {
		return vdom.H(name, structToProps(props))
	}
}

func (c *ClientImpl) registerComponent(name string, cfunc any) error {
	return c.Root.RegisterComponent(name, cfunc)
}

func (c *ClientImpl) fullRender() (*rpctypes.VDomBackendUpdate, error) {
	opts := &RenderOpts{Resync: true}
	c.Root.RunWork(opts)
	c.Root.Render(c.RootElem, opts)
	renderedVDom := c.Root.MakeRendered()
	if renderedVDom == nil {
		renderedVDom = makeNullRendered()
	}
	return &rpctypes.VDomBackendUpdate{
		Type:       "backendupdate",
		Ts:         time.Now().UnixMilli(),
		ServerId:   c.ServerId,
		HasWork:    len(c.Root.EffectWorkQueue) > 0,
		FullUpdate: true,
		Opts:       c.makeBackendOpts(),
		RenderUpdates: []rpctypes.VDomRenderUpdate{
			{UpdateType: "root", VDom: renderedVDom},
		},
		RefOperations: c.Root.GetRefOperations(),
	}, nil
}

func (c *ClientImpl) incrementalRender() (*rpctypes.VDomBackendUpdate, error) {
	opts := &RenderOpts{Resync: false}
	c.Root.RunWork(opts)
	renderedVDom := c.Root.MakeRendered()
	if renderedVDom == nil {
		renderedVDom = makeNullRendered()
	}
	return &rpctypes.VDomBackendUpdate{
		Type:       "backendupdate",
		Ts:         time.Now().UnixMilli(),
		ServerId:   c.ServerId,
		HasWork:    len(c.Root.EffectWorkQueue) > 0,
		FullUpdate: false,
		Opts:       c.makeBackendOpts(),
		RenderUpdates: []rpctypes.VDomRenderUpdate{
			{UpdateType: "root", VDom: renderedVDom},
		},
		RefOperations: c.Root.GetRefOperations(),
	}, nil
}

func (c *ClientImpl) HandleDynFunc(pattern string, fn func(http.ResponseWriter, *http.Request)) {
	if !strings.HasPrefix(pattern, "/dyn/") {
		log.Printf("invalid dyn pattern: %s (must start with /dyn/)", pattern)
		return
	}
	c.UrlHandlerMux.HandleFunc(pattern, fn)
}

func (c *ClientImpl) RunEvents(events []vdom.VDomEvent) {
	for _, event := range events {
		c.Root.Event(event, c.GlobalEventHandler)
	}
}
