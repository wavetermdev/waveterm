// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshclient

import (
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type WshServer struct{}

func (*WshServer) WshServerImpl() {}

var WshServerImpl = WshServer{}

var waveSrvClient_Singleton *wshutil.WshRpc
var waveSrvClient_Once = &sync.Once{}

func GetBareRpcClient() *wshutil.WshRpc {
	waveSrvClient_Once.Do(func() {
		waveSrvClient_Singleton = wshutil.MakeWshRpc(wshrpc.RpcContext{}, &WshServerImpl, "bare-client")
		bareClientRoute := fmt.Sprintf("bare:%s", uuid.New().String())
		wshutil.DefaultRouter.RegisterTrustedLeaf(waveSrvClient_Singleton, bareClientRoute)
		wps.Broker.SetClient(wshutil.DefaultRouter)
	})
	return waveSrvClient_Singleton
}
