// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
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

type ModalState struct {
	Config     rpctypes.ModalConfig
	ResultChan chan bool // Channel to receive the result (true = confirmed/ok, false = cancelled)
}

type ssEvent struct {
	Event string
	Data  []byte
}

var defaultClient = makeClient()

type AppMeta struct {
	Title     string `json:"title"`
	ShortDesc string `json:"shortdesc"`
	Icon      string `json:"icon"`      // for waveapps, the icon to use (fontawesome names)
	IconColor string `json:"iconcolor"` // for waveapps, the icon color to use (HTML color -- name, hex, rgb)
}

type SecretMeta struct {
	Desc     string `json:"desc"`
	Optional bool   `json:"optional"`
}

type AppManifest struct {
	AppMeta      AppMeta               `json:"appmeta"`
	ConfigSchema map[string]any        `json:"configschema"`
	DataSchema   map[string]any        `json:"dataschema"`
	Secrets      map[string]SecretMeta `json:"secrets"`
}

type ClientImpl struct {
	Lock               *sync.Mutex
	Root               *RootElem
	RootElem           *vdom.VDomElem
	CurrentClientId    string
	Meta               AppMeta
	ServerId           string
	IsDone             bool
	DoneReason         string
	DoneCh             chan struct{}
	SSEChannels        map[string]chan ssEvent // map of connectionId to SSE channel
	SSEChannelsLock    *sync.Mutex
	GlobalEventHandler func(event vdom.VDomEvent)
	UrlHandlerMux      *http.ServeMux
	SetupFn            func()
	AssetsFS           fs.FS
	StaticFS           fs.FS
	ManifestFileBytes  []byte

	// for modals
	OpenModals     map[string]*ModalState // map of modalId to modal state
	OpenModalsLock *sync.Mutex

	// for secrets
	Secrets     map[string]SecretMeta // map of secret name to metadata
	SecretsLock *sync.Mutex

	// for notification
	// Atomics so we never drop "last event" timing info even if wakeCh is full.
	// 0 means "no pending batch".
	notifyOnce         sync.Once
	notifyWakeCh       chan struct{}
	notifyBatchStartNs atomic.Int64 // ns of first event in current batch
	notifyLastEventNs  atomic.Int64 // ns of most recent event
}

func makeClient() *ClientImpl {
	client := &ClientImpl{
		Lock:            &sync.Mutex{},
		DoneCh:          make(chan struct{}),
		SSEChannels:     make(map[string]chan ssEvent),
		SSEChannelsLock: &sync.Mutex{},
		OpenModals:      make(map[string]*ModalState),
		OpenModalsLock:  &sync.Mutex{},
		Secrets:         make(map[string]SecretMeta),
		SecretsLock:     &sync.Mutex{},
		UrlHandlerMux:   http.NewServeMux(),
		ServerId:        uuid.New().String(),
		RootElem:        vdom.H(DefaultComponentName, nil),
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
	appMeta := c.GetAppMeta()
	return &rpctypes.VDomBackendOpts{
		Title:                appMeta.Title,
		ShortDesc:            appMeta.ShortDesc,
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

func (c *ClientImpl) RegisterSSEChannel(connectionId string) chan ssEvent {
	c.SSEChannelsLock.Lock()
	defer c.SSEChannelsLock.Unlock()

	ch := make(chan ssEvent, 100)
	c.SSEChannels[connectionId] = ch
	return ch
}

func (c *ClientImpl) UnregisterSSEChannel(connectionId string) {
	c.SSEChannelsLock.Lock()
	defer c.SSEChannelsLock.Unlock()

	if ch, exists := c.SSEChannels[connectionId]; exists {
		close(ch)
		delete(c.SSEChannels, connectionId)
	}
}

func (c *ClientImpl) SendSSEvent(event ssEvent) error {
	if c.GetIsDone() {
		return fmt.Errorf("client is done")
	}

	c.SSEChannelsLock.Lock()
	defer c.SSEChannelsLock.Unlock()

	// Send to all registered SSE channels
	for _, ch := range c.SSEChannels {
		select {
		case ch <- event:
			// Successfully sent
		default:
			// silently drop (below is just for debugging).  this wont happen in general
			// log.Printf("SSEvent channel is full for connection %s, skipping event", connectionId)
		}
	}

	return nil
}

func (c *ClientImpl) SendAsyncInitiation() error {
	return c.SendSSEvent(ssEvent{Event: "asyncinitiation", Data: nil})
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

func (c *ClientImpl) GetAppMeta() AppMeta {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	return c.Meta
}

func (c *ClientImpl) SetAppMeta(m AppMeta) {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	c.Meta = m
}

// addModalToMap adds a modal to the map and returns the result channel
func (c *ClientImpl) addModalToMap(config rpctypes.ModalConfig) chan bool {
	c.OpenModalsLock.Lock()
	defer c.OpenModalsLock.Unlock()

	resultChan := make(chan bool, 1)
	c.OpenModals[config.ModalId] = &ModalState{
		Config:     config,
		ResultChan: resultChan,
	}
	return resultChan
}

// ShowModal displays a modal and returns a channel that will receive the result
func (c *ClientImpl) ShowModal(config rpctypes.ModalConfig) chan bool {
	resultChan := c.addModalToMap(config)

	data, err := json.Marshal(config)
	if err != nil {
		log.Printf("failed to marshal modal config: %v", err)
		c.CloseModal(config.ModalId, false)
		return resultChan
	}

	err = c.SendSSEvent(ssEvent{Event: "showmodal", Data: data})
	if err != nil {
		log.Printf("failed to send modal SSE event: %v", err)
		c.CloseModal(config.ModalId, false)
		return resultChan
	}

	return resultChan
}

// removeModalFromMap removes a modal from the map and returns its state
func (c *ClientImpl) removeModalFromMap(modalId string) *ModalState {
	c.OpenModalsLock.Lock()
	defer c.OpenModalsLock.Unlock()

	modalState, exists := c.OpenModals[modalId]
	if exists {
		delete(c.OpenModals, modalId)
	}
	return modalState
}

// CloseModal closes a modal with the given result
func (c *ClientImpl) CloseModal(modalId string, result bool) {
	modalState := c.removeModalFromMap(modalId)
	if modalState != nil {
		modalState.ResultChan <- result
		close(modalState.ResultChan)
	}
}

// CloseAllModals closes all open modals with cancelled result
// This is called when the FE requests a resync (page refresh or new client)
func (c *ClientImpl) CloseAllModals() {
	c.OpenModalsLock.Lock()
	modalIds := make([]string, 0, len(c.OpenModals))
	for modalId := range c.OpenModals {
		modalIds = append(modalIds, modalId)
	}
	c.OpenModalsLock.Unlock()

	for _, modalId := range modalIds {
		c.CloseModal(modalId, false)
	}
}

func (c *ClientImpl) DeclareSecret(name string, desc string, optional bool) {
	c.SecretsLock.Lock()
	defer c.SecretsLock.Unlock()
	if _, exists := c.Secrets[name]; exists {
		panic(fmt.Sprintf("secret '%s' already declared", name))
	}
	c.Secrets[name] = SecretMeta{
		Desc:     desc,
		Optional: optional,
	}
}

func (c *ClientImpl) GetSecrets() map[string]SecretMeta {
	c.SecretsLock.Lock()
	defer c.SecretsLock.Unlock()
	secretsCopy := make(map[string]SecretMeta, len(c.Secrets))
	for k, v := range c.Secrets {
		secretsCopy[k] = v
	}
	return secretsCopy
}

func (c *ClientImpl) GetAppManifest() AppManifest {
	appMeta := c.GetAppMeta()
	configSchema := GenerateConfigSchema(c.Root)
	dataSchema := GenerateDataSchema(c.Root)
	secrets := c.GetSecrets()

	return AppManifest{
		AppMeta:      appMeta,
		ConfigSchema: configSchema,
		DataSchema:   dataSchema,
		Secrets:      secrets,
	}
}

func (c *ClientImpl) PrintAppManifest() {
	manifest := c.GetAppManifest()
	manifestJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		fmt.Printf("Error marshaling manifest: %v\n", err)
		return
	}
	fmt.Println(string(manifestJSON))
}
