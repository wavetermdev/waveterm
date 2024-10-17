// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func init() {
	rootCmd.AddCommand(htmlCmd)
}

var htmlCmd = &cobra.Command{
	Use:     "html",
	Hidden:  true,
	Short:   "Launch a demo html-mode terminal",
	Run:     htmlRun,
	PreRunE: preRunSetupRpcClient,
}

type VDomServerImpl struct {
	BlockId string
}

func (*VDomServerImpl) WshServerImpl() {}

func initialRender() *vdom.VDomBackendUpdate {
	vdomStr := `
	<div>
	  <h1 style="color:red; background-color: #bind:$.bgcolor; border-radius: 4px; padding: 5px;">hello vdom world</h1>
	  <div><bind key="$.text"/></div>
	</div>
	`
	elem := vdom.Bind(vdomStr, nil)
	if elem == nil {
		return nil
	}
	root := vdom.MakeRoot()
	root.Render(elem)
	renderedVDom := root.MakeVDom()
	if renderedVDom == nil {
		return nil
	}
	return &vdom.VDomBackendUpdate{
		Type:    "backendupdate",
		Ts:      time.Now().UnixMilli(),
		BlockId: RpcContext.BlockId,
		RenderUpdates: []vdom.VDomRenderUpdate{
			{UpdateType: "root", VDom: *renderedVDom},
		},
		StateSync: []vdom.VDomStateSync{
			{Atom: "bgcolor", Value: "#0000ff77"},
			{Atom: "text", Value: "bound text"},
		},
	}
}

func (impl *VDomServerImpl) VDomRenderCommand(ctx context.Context, data vdom.VDomFrontendUpdate) (*vdom.VDomBackendUpdate, error) {
	WriteStderr("VDomRenderCommand: %v\n", data)
	if data.Initialize {
		return initialRender(), nil
	}
	return &vdom.VDomBackendUpdate{
		Type:    "backendupdate",
		Ts:      time.Now().UnixMilli(),
		BlockId: RpcContext.BlockId,
		StateSync: []vdom.VDomStateSync{
			{Atom: "text", Value: "updated text"},
		},
	}, nil
}

func htmlRun(cmd *cobra.Command, args []string) {
	WriteStderr("running wsh html %q\n", RpcContext.BlockId)
	defer wshutil.DoShutdown("normal exit", 0, true)

	serverImpl := &VDomServerImpl{BlockId: RpcContext.BlockId}
	RpcClient.SetServerImpl(serverImpl)

	err := wshclient.VDomCreateContextCommand(RpcClient, vdom.VDomCreateContext{}, &wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(RpcContext.BlockId)})
	if err != nil {
		WriteStderr("error creating vdom context: %v\n", err)
		wshutil.DoShutdown(fmt.Sprintf("error creating vdom context: %v", err), 1, true)
	}
	wshclient.EventSubCommand(RpcClient, wps.SubscriptionRequest{Event: "blockclose", Scopes: []string{
		waveobj.MakeORef("block", RpcContext.BlockId).String(),
	}}, nil)
	RpcClient.EventListener.On("blockclose", func(event *wps.WaveEvent) {
		wshutil.DoShutdown("blockclosed", 0, true)
	})
	WriteStderr("created vdom context\n")
	go func() {
		time.Sleep(5 * time.Second)
		wshclient.VDomAsyncInitiationCommand(RpcClient, vdom.MakeAsyncInitiationRequest(RpcContext.BlockId), &wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(RpcContext.BlockId)})
	}()
	for {
		var buf [1]byte
		_, err := WrappedStdin.Read(buf[:])
		if err != nil {
			wshutil.DoShutdown(fmt.Sprintf("stdin closed/error (%v)", err), 1, true)
		}
		if buf[0] == 0x03 {
			wshutil.DoShutdown("read Ctrl-C from stdin", 1, true)
			break
		}
		if buf[0] == 'x' {
			wshutil.DoShutdown("read 'x' from stdin", 0, true)
			break
		}
	}
}
