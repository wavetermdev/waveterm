// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdomclient

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type Client struct {
	Root       *vdom.RootElem
	RootElem   *vdom.VDomElem
	RpcClient  *wshutil.WshRpc
	RpcContext *wshrpc.RpcContext
	ServerImpl *VDomServerImpl
	IsDone     bool
	DoneCh     chan struct{}
}

type VDomServerImpl struct {
	Client  *Client
	BlockId string
}

func (*VDomServerImpl) WshServerImpl() {}

func (impl *VDomServerImpl) VDomRenderCommand(ctx context.Context, data vdom.VDomFrontendUpdate) (*vdom.VDomBackendUpdate, error) {
	if data.Dispose {
		close(impl.Client.DoneCh)
		return nil, nil
	}
	if impl.Client.IsDone {
		return nil, nil
	}
	// set atoms
	for _, ss := range data.StateSync {
		impl.Client.Root.SetAtomVal(ss.Atom, ss.Value, false)
	}
	// run events
	for _, event := range data.Events {
		impl.Client.Root.Event(event.WaveId, event.PropName, event.EventData)
	}
	if data.Initialize || data.Resync {
		return impl.Client.fullRender()
	}
	return impl.Client.incrementalRender()
}

func MakeClient() (*Client, error) {
	client := &Client{
		Root:   vdom.MakeRoot(),
		DoneCh: make(chan struct{}),
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
	return client, nil
}

func (c *Client) CreateContext(blockId string) error {
	err := wshclient.VDomCreateContextCommand(c.RpcClient, vdom.VDomCreateContext{}, &wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(c.RpcContext.BlockId)})
	if err != nil {
		return err
	}
	return nil
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
