// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/tsunami/comp"
	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const TsunamiListenAddrEnvVar = "TSUNAMI_LISTENADDR"
const DefaultListenAddr = "localhost:0"
const DefaultComponentName = "App"

type ssEvent struct {
	Event string
	Data  []byte
}

type clientImpl struct {
	Lock               *sync.Mutex
	Root               *comp.RootElem
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
}

func makeClient() *clientImpl {
	client := &clientImpl{
		Lock:          &sync.Mutex{},
		Root:          comp.MakeRoot(),
		DoneCh:        make(chan struct{}),
		SSEventCh:     make(chan ssEvent, 100),
		UrlHandlerMux: http.NewServeMux(),
		ServerId:      uuid.New().String(),
		RootElem:      vdom.H(DefaultComponentName, nil),
	}
	return client
}

func (c *clientImpl) GetIsDone() bool {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	return c.IsDone
}

func (c *clientImpl) checkClientId(clientId string) error {
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

func (c *clientImpl) clientTakeover(clientId string) {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	c.CurrentClientId = clientId
}

func (c *clientImpl) doShutdown(reason string) {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	if c.IsDone {
		return
	}
	c.DoneReason = reason
	c.IsDone = true
	close(c.DoneCh)
}

func (c *clientImpl) SetGlobalEventHandler(handler func(event vdom.VDomEvent)) {
	c.GlobalEventHandler = handler
}

func getFaviconPath() string {
	if staticFS != nil {
		faviconNames := []string{"favicon.ico", "favicon.png", "favicon.svg", "favicon.gif", "favicon.jpg"}
		for _, name := range faviconNames {
			if _, err := staticFS.Open(name); err == nil {
				return "/static/" + name
			}
		}
	}
	return "/wave-logo-256.png"
}

func (c *clientImpl) makeBackendOpts() *rpctypes.VDomBackendOpts {
	return &rpctypes.VDomBackendOpts{
		Title:                c.Root.AppTitle,
		GlobalKeyboardEvents: c.GlobalEventHandler != nil,
		FaviconPath:          getFaviconPath(),
	}
}

func (c *clientImpl) runMainE() error {
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

func (c *clientImpl) RegisterSetupFn(fn func()) {
	c.SetupFn = fn
}

func (c *clientImpl) RunMain() {
	err := c.runMainE()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func (c *clientImpl) listenAndServe(ctx context.Context) error {
	// Create HTTP handlers
	handlers := newHTTPHandlers(c)

	// Create a new ServeMux and register handlers
	mux := http.NewServeMux()
	handlers.registerHandlers(mux, handlerOpts{
		AssetsFS:     assetsFS,
		StaticFS:     staticFS,
		ManifestFile: manifestFileBytes,
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

func (c *clientImpl) SendAsyncInitiation() error {
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

func (c *clientImpl) SetAtomVals(m map[string]any) {
	for k, v := range m {
		c.Root.SetAtomVal(k, v, true)
	}
}

func (c *clientImpl) SetAtomVal(name string, val any) {
	c.Root.SetAtomVal(name, val, true)
}

func (c *clientImpl) GetAtomVal(name string) any {
	return c.Root.GetAtomVal(name)
}

func makeNullVDom() *vdom.VDomElem {
	return &vdom.VDomElem{WaveId: uuid.New().String(), Tag: vdom.WaveNullTag}
}

func structToProps(props any) map[string]any {
	m, err := util.StructToMap(props)
	if err != nil {
		return nil
	}
	return m
}

func defineComponentEx[P any](client *clientImpl, name string, renderFn func(ctx context.Context, props P) any) vdom.Component[P] {
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

func (c *clientImpl) registerComponent(name string, cfunc any) error {
	return c.Root.RegisterComponent(name, cfunc)
}

func (c *clientImpl) fullRender() (*rpctypes.VDomBackendUpdate, error) {
	opts := &comp.RenderOpts{Resync: true}
	c.Root.RunWork(opts)
	c.Root.Render(c.RootElem, opts)
	renderedVDom := c.Root.MakeVDom()
	if renderedVDom == nil {
		renderedVDom = makeNullVDom()
	}
	return &rpctypes.VDomBackendUpdate{
		Type:     "backendupdate",
		Ts:       time.Now().UnixMilli(),
		ServerId: c.ServerId,
		HasWork:  len(c.Root.EffectWorkQueue) > 0,
		Opts:     c.makeBackendOpts(),
		RenderUpdates: []rpctypes.VDomRenderUpdate{
			{UpdateType: "root", VDom: renderedVDom},
		},
		RefOperations: c.Root.GetRefOperations(),
		StateSync:     c.Root.GetStateSync(true),
	}, nil
}

func (c *clientImpl) incrementalRender() (*rpctypes.VDomBackendUpdate, error) {
	opts := &comp.RenderOpts{Resync: false}
	c.Root.RunWork(opts)
	renderedVDom := c.Root.MakeVDom()
	if renderedVDom == nil {
		renderedVDom = makeNullVDom()
	}
	return &rpctypes.VDomBackendUpdate{
		Type:     "backendupdate",
		Ts:       time.Now().UnixMilli(),
		ServerId: c.ServerId,
		Opts:     c.makeBackendOpts(),
		RenderUpdates: []rpctypes.VDomRenderUpdate{
			{UpdateType: "root", VDom: renderedVDom},
		},
		RefOperations: c.Root.GetRefOperations(),
		StateSync:     c.Root.GetStateSync(false),
	}, nil
}

func (c *clientImpl) HandleDynFunc(pattern string, fn func(http.ResponseWriter, *http.Request)) {
	if !strings.HasPrefix(pattern, "/dyn/") {
		log.Printf("invalid dyn pattern: %s (must start with /dyn/)", pattern)
		return
	}
	c.UrlHandlerMux.HandleFunc(pattern, fn)
}
