// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

var waveSrvClient_Singleton *wshutil.WshRpc
var waveSrvClient_Once = &sync.Once{}

// returns the wavesrv main rpc client singleton
func GetMainRpcClient() *wshutil.WshRpc {
	waveSrvClient_Once.Do(func() {
		inputCh := make(chan []byte, DefaultInputChSize)
		outputCh := make(chan []byte, DefaultOutputChSize)
		waveSrvClient_Singleton = wshutil.MakeWshRpc(inputCh, outputCh, wshrpc.RpcContext{}, &WshServerImpl)
	})
	return waveSrvClient_Singleton
}
