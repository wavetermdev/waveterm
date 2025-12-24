// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshclient

import (
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type WshServer struct{}

func (*WshServer) WshServerImpl() {}

var WshServerImpl = WshServer{}

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

var waveSrvClient_Singleton *wshutil.WshRpc
var waveSrvClient_Once = &sync.Once{}

const BareClientRoute = "bare"

func GetBareRpcClient() *wshutil.WshRpc {
	waveSrvClient_Once.Do(func() {
		inputCh := make(chan []byte, DefaultInputChSize)
		outputCh := make(chan []byte, DefaultOutputChSize)
		waveSrvClient_Singleton = wshutil.MakeWshRpc(inputCh, outputCh, wshrpc.RpcContext{}, &WshServerImpl, "bare-client")
		wshutil.DefaultRouter.RegisterTrustedLeaf(waveSrvClient_Singleton, BareClientRoute)
		wps.Broker.SetClient(wshutil.DefaultRouter)
	})
	return waveSrvClient_Singleton
}
