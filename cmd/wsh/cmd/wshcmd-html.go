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

func (impl *VDomServerImpl) VDomRenderCommand(ctx context.Context, data vdom.VDomFrontendUpdate) (*vdom.VDomBackendUpdate, error) {
	WriteStderr("VDomRenderCommand: %v\n", data)
	vdomStr := `
	<div>
	  <h1>hello vdom world</h1>
	</div>
	`
	elem := vdom.Bind(vdomStr, nil)
	if elem == nil {
		return nil, fmt.Errorf("error binding vdom")
	}
	root := vdom.MakeRoot()
	root.Render(elem)
	renderedVDom := root.MakeVDom()
	if renderedVDom == nil {
		return nil, fmt.Errorf("error rendering vdom")
	}
	return &vdom.VDomBackendUpdate{
		Type:    "backendupdate",
		Ts:      time.Now().UnixMilli(),
		BlockId: impl.BlockId,
		RenderUpdates: []vdom.VDomRenderUpdate{
			{UpdateType: "root", VDom: *renderedVDom},
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
