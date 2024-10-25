// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdomclient

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/vdom"
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
}

type VDomServerImpl struct {
	Client  *Client
	BlockId string
}

func (*VDomServerImpl) WshServerImpl() {}

func (impl *VDomServerImpl) VDomRenderCommand(ctx context.Context, feUpdate vdom.VDomFrontendUpdate) (*vdom.VDomBackendUpdate, error) {
	if feUpdate.Dispose {
		log.Printf("got dispose from frontend\n")
		impl.Client.doShutdown("got dispose from frontend")
		return nil, nil
	}
	if impl.Client.GetIsDone() {
		return nil, nil
	}
	// set atoms
	for _, ss := range feUpdate.StateSync {
		impl.Client.Root.SetAtomVal(ss.Atom, ss.Value, false)
	}
	// run events
	for _, event := range feUpdate.Events {
		if event.WaveId == "" {
			if impl.Client.GlobalEventHandler != nil {
				impl.Client.GlobalEventHandler(impl.Client, event)
			}
		} else {
			impl.Client.Root.Event(event.WaveId, event.EventType, event.EventData)
		}
	}
	if feUpdate.Resync {
		return impl.Client.fullRender()
	}
	return impl.Client.incrementalRender()
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

func MakeClient(opts *vdom.VDomBackendOpts) (*Client, error) {
	client := &Client{
		Lock:   &sync.Mutex{},
		Root:   vdom.MakeRoot(),
		DoneCh: make(chan struct{}),
	}
	if opts != nil {
		client.Opts = *opts
	}
	jwtToken := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwtToken == "" {
		return nil, fmt.Errorf("no %s env var set", wshutil.WaveJwtTokenVarName)
	}
	rpcCtx, err := wshutil.ExtractUnverifiedRpcContext(jwtToken)
	if err != nil {
		return nil, fmt.Errorf("error extracting rpc context from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	client.RpcContext = rpcCtx
	if client.RpcContext == nil || client.RpcContext.BlockId == "" {
		return nil, fmt.Errorf("no block id in rpc context")
	}
	client.ServerImpl = &VDomServerImpl{BlockId: client.RpcContext.BlockId, Client: client}
	sockName, err := wshutil.ExtractUnverifiedSocketName(jwtToken)
	if err != nil {
		return nil, fmt.Errorf("error extracting socket name from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	rpcClient, err := wshutil.SetupDomainSocketRpcClient(sockName, client.ServerImpl)
	if err != nil {
		return nil, fmt.Errorf("error setting up domain socket rpc client: %v", err)
	}
	client.RpcClient = rpcClient
	authRtn, err := wshclient.AuthenticateCommand(client.RpcClient, jwtToken, &wshrpc.RpcOpts{NoResponse: true})
	if err != nil {
		return nil, fmt.Errorf("error authenticating rpc connection: %v", err)
	}
	client.RouteId = authRtn.RouteId
	return client, nil
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
		Opts:    &c.Opts,
		RenderUpdates: []vdom.VDomRenderUpdate{
			{UpdateType: "root", VDom: *renderedVDom},
		},
		StateSync: c.Root.GetStateSync(true),
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
			{UpdateType: "root", VDom: *renderedVDom},
		},
		StateSync: c.Root.GetStateSync(false),
	}, nil
}