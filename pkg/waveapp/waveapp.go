// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveapp

import (
	"context"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type AppOpts struct {
	CloseOnCtrlC         bool
	GlobalKeyboardEvents bool
	GlobalStyles         []byte
	RootComponentName    string // defaults to "App"
	NewBlockFlag         string // defaults to "n" (set to "-" to disable)
	TargetNewBlock       bool
	TargetToolbar        *vdom.VDomTargetToolbar
}

type Client struct {
	Lock               *sync.Mutex
	AppOpts            AppOpts
	Root               *vdom.RootElem
	RootElem           *vdom.VDomElem
	RpcClient          *wshutil.WshRpc
	RpcContext         *wshrpc.RpcContext
	ServerImpl         *WaveAppServerImpl
	IsDone             bool
	RouteId            string
	VDomContextBlockId string
	DoneReason         string
	DoneCh             chan struct{}
	Opts               vdom.VDomBackendOpts
	GlobalEventHandler func(client *Client, event vdom.VDomEvent)
	GlobalStylesOption *FileHandlerOption
	UrlHandlerMux      *mux.Router
	OverrideUrlHandler http.Handler
	NewBlockFlag       bool
	SetupFn            func()
}

func (c *Client) GetIsDone() bool {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	return c.IsDone
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
	if appOpts.NewBlockFlag == "" {
		appOpts.NewBlockFlag = "n"
	}
	client := &Client{
		Lock:          &sync.Mutex{},
		AppOpts:       appOpts,
		Root:          vdom.MakeRoot(),
		DoneCh:        make(chan struct{}),
		UrlHandlerMux: mux.NewRouter(),
		Opts: vdom.VDomBackendOpts{
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

func (client *Client) runMainE() error {
	if client.SetupFn != nil {
		client.SetupFn()
	}
	err := client.Connect()
	if err != nil {
		return err
	}
	target := &vdom.VDomTarget{}
	if client.AppOpts.TargetNewBlock || client.NewBlockFlag {
		target.NewBlock = client.NewBlockFlag
	}
	if client.AppOpts.TargetToolbar != nil {
		target.Toolbar = client.AppOpts.TargetToolbar
	}
	if target.NewBlock && target.Toolbar != nil {
		return fmt.Errorf("cannot specify both new block and toolbar target")
	}
	err = client.CreateVDomContext(target)
	if err != nil {
		return err
	}
	<-client.DoneCh
	return nil
}

func (client *Client) AddSetupFn(fn func()) {
	client.SetupFn = fn
}

func (client *Client) RegisterDefaultFlags() {
	if client.AppOpts.NewBlockFlag != "-" {
		flag.BoolVar(&client.NewBlockFlag, client.AppOpts.NewBlockFlag, false, "new block")
	}
}

func (client *Client) RunMain() {
	if !flag.Parsed() {
		client.RegisterDefaultFlags()
		flag.Parse()
	}
	err := client.runMainE()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func (client *Client) Connect() error {
	jwtToken := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwtToken == "" {
		return fmt.Errorf("no %s env var set", wshutil.WaveJwtTokenVarName)
	}
	rpcCtx, err := wshutil.ExtractUnverifiedRpcContext(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting rpc context from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	client.RpcContext = rpcCtx
	if client.RpcContext == nil || client.RpcContext.BlockId == "" {
		return fmt.Errorf("no block id in rpc context")
	}
	client.ServerImpl = &WaveAppServerImpl{BlockId: client.RpcContext.BlockId, Client: client}
	sockName, err := wshutil.ExtractUnverifiedSocketName(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting socket name from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	rpcClient, err := wshutil.SetupDomainSocketRpcClient(sockName, client.ServerImpl, "vdomclient")
	if err != nil {
		return fmt.Errorf("error setting up domain socket rpc client: %v", err)
	}
	client.RpcClient = rpcClient
	authRtnData, err := wshclient.AuthenticateCommand(client.RpcClient, jwtToken, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		return fmt.Errorf("error authenticating rpc connection: %v", err)
	}
	client.RouteId = authRtnData.RouteId
	return nil
}

func (c *Client) SetRootElem(elem *vdom.VDomElem) {
	c.RootElem = elem
}

func (c *Client) CreateVDomContext(target *vdom.VDomTarget) error {
	blockORef, err := wshclient.VDomCreateContextCommand(
		c.RpcClient,
		vdom.VDomCreateContext{Target: target},
		&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(c.RpcContext.BlockId)},
	)
	if err != nil {
		return err
	}
	c.VDomContextBlockId = blockORef.OID
	log.Printf("created vdom context: %v\n", blockORef)
	gotRoute, err := wshclient.WaitForRouteCommand(c.RpcClient, wshrpc.CommandWaitForRouteData{
		RouteId: wshutil.MakeFeBlockRouteId(blockORef.OID),
		WaitMs:  4000,
	}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("error waiting for vdom context route: %v", err)
	}
	if !gotRoute {
		return fmt.Errorf("vdom context route could not be established")
	}
	wshclient.EventSubCommand(c.RpcClient, wps.SubscriptionRequest{Event: wps.Event_BlockClose, Scopes: []string{
		blockORef.String(),
	}}, nil)
	c.RpcClient.EventListener.On("blockclose", func(event *wps.WaveEvent) {
		c.doShutdown("got blockclose event")
	})
	return nil
}

func (c *Client) SendAsyncInitiation() error {
	if c.VDomContextBlockId == "" {
		return fmt.Errorf("no vdom context block id")
	}
	if c.GetIsDone() {
		return fmt.Errorf("client is done")
	}
	return wshclient.VDomAsyncInitiationCommand(
		c.RpcClient,
		vdom.MakeAsyncInitiationRequest(c.RpcContext.BlockId),
		&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(c.VDomContextBlockId)},
	)
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

func (c *Client) fullRender() (*vdom.VDomBackendUpdate, error) {
	c.Root.RunWork()
	c.Root.Render(c.RootElem)
	renderedVDom := c.Root.MakeVDom()
	if renderedVDom == nil {
		renderedVDom = makeNullVDom()
	}
	return &vdom.VDomBackendUpdate{
		Type:    "backendupdate",
		Ts:      time.Now().UnixMilli(),
		BlockId: c.RpcContext.BlockId,
		HasWork: len(c.Root.EffectWorkQueue) > 0,
		Opts:    &c.Opts,
		RenderUpdates: []vdom.VDomRenderUpdate{
			{UpdateType: "root", VDom: renderedVDom},
		},
		RefOperations: c.Root.GetRefOperations(),
		StateSync:     c.Root.GetStateSync(true),
	}, nil
}

func (c *Client) incrementalRender() (*vdom.VDomBackendUpdate, error) {
	c.Root.RunWork()
	renderedVDom := c.Root.MakeVDom()
	if renderedVDom == nil {
		renderedVDom = makeNullVDom()
	}
	return &vdom.VDomBackendUpdate{
		Type:    "backendupdate",
		Ts:      time.Now().UnixMilli(),
		BlockId: c.RpcContext.BlockId,
		RenderUpdates: []vdom.VDomRenderUpdate{
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
		filePath := wavebase.ExpandHomeDirSafe(option.FilePath)
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
		filePath := wavebase.ExpandHomeDirSafe(option.FilePath)
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
