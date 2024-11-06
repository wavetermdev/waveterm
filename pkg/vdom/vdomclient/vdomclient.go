// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdomclient

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
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

type Client struct {
	Lock               *sync.Mutex
	Root               *vdom.RootElem
	RootElem           *vdom.VDomElem
	RpcClient          *wshutil.WshRpc
	RpcContext         *wshrpc.RpcContext
	ServerImpl         *VDomServerImpl
	IsDone             bool
	RouteId            string
	VDomContextBlockId string
	DoneReason         string
	DoneCh             chan struct{}
	Opts               vdom.VDomBackendOpts
	GlobalEventHandler func(client *Client, event vdom.VDomEvent)
	UrlHandlerMux      *mux.Router
	OverrideUrlHandler http.Handler
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

func MakeClient(opts *vdom.VDomBackendOpts) *Client {
	client := &Client{
		Lock:          &sync.Mutex{},
		Root:          vdom.MakeRoot(),
		DoneCh:        make(chan struct{}),
		UrlHandlerMux: mux.NewRouter(),
	}
	if opts != nil {
		client.Opts = *opts
	}
	return client
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
	client.ServerImpl = &VDomServerImpl{BlockId: client.RpcContext.BlockId, Client: client}
	sockName, err := wshutil.ExtractUnverifiedSocketName(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting socket name from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	rpcClient, err := wshutil.SetupDomainSocketRpcClient(sockName, client.ServerImpl)
	if err != nil {
		return fmt.Errorf("error setting up domain socket rpc client: %v", err)
	}
	client.RpcClient = rpcClient
	authRtn, err := wshclient.AuthenticateCommand(client.RpcClient, jwtToken, &wshrpc.RpcOpts{NoResponse: true})
	if err != nil {
		return fmt.Errorf("error authenticating rpc connection: %v", err)
	}
	client.RouteId = authRtn.RouteId
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
	client.RegisterComponent(name, renderFn)
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

func (c *Client) RegisterFileHandler(path string, option FileHandlerOption) {
	c.UrlHandlerMux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		// Determine MIME type and get buffered data if needed
		contentType, bufferedData := determineMimeType(option)
		w.Header().Set("Content-Type", contentType)

		if option.FilePath != "" {
			// Serve file from path
			filePath := wavebase.ExpandHomeDirSafe(option.FilePath)
			http.ServeFile(w, r, filePath)
		} else if option.Data != nil {
			// Set content length and serve content from in-memory data
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(option.Data)))
			w.WriteHeader(http.StatusOK) // Ensure headers are sent before writing body
			if _, err := w.Write(option.Data); err != nil {
				http.Error(w, "Failed to serve content", http.StatusInternalServerError)
			}
		} else if option.File != nil {
			// Write buffered data if available, then continue with remaining File content
			if bufferedData != nil {
				w.Header().Set("Content-Length", fmt.Sprintf("%d", len(bufferedData)))
				if _, err := w.Write(bufferedData); err != nil {
					http.Error(w, "Failed to serve content", http.StatusInternalServerError)
					return
				}
			}
			// Serve remaining content from File
			if _, err := io.Copy(w, option.File); err != nil {
				http.Error(w, "Failed to serve content", http.StatusInternalServerError)
			}
		} else if option.Reader != nil {
			// Write buffered data if available, then continue with remaining Reader content
			if bufferedData != nil {
				if _, err := w.Write(bufferedData); err != nil {
					http.Error(w, "Failed to serve content", http.StatusInternalServerError)
					return
				}
			}
			// Serve remaining content from Reader
			if _, err := io.Copy(w, option.Reader); err != nil {
				http.Error(w, "Failed to serve content", http.StatusInternalServerError)
			}
		} else {
			http.Error(w, "No content available", http.StatusNotFound)
		}
	})
}
