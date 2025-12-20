// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionmanager

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var (
	sessionManagerClient_Once      sync.Once
	sessionManagerClient_Singleton *wshutil.WshRpc
)

const (
	DefaultInputChSize  = 32
	DefaultOutputChSize = 32
)

type ServerImpl struct {
	LogWriter io.Writer
}

func (*ServerImpl) WshServerImpl() {}

func (impl *ServerImpl) Log(format string, args ...interface{}) {
	if impl.LogWriter != nil {
		fmt.Fprintf(impl.LogWriter, format, args...)
	} else {
		log.Printf(format, args...)
	}
}

func (impl *ServerImpl) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	impl.Log("[sessionmanager][message] %q\n", data.Message)
	return nil
}

func GetSessionManagerRpcClient() *wshutil.WshRpc {
	sessionManagerClient_Once.Do(func() {
		inputCh := make(chan []byte, DefaultInputChSize)
		outputCh := make(chan []byte, DefaultOutputChSize)
		sessionManagerClient_Singleton = wshutil.MakeWshRpc(
			inputCh,
			outputCh,
			wshrpc.RpcContext{},
			&ServerImpl{},
			"sessionmanager-client",
		)
	})
	return sessionManagerClient_Singleton
}

func registerSessionManagerRoute() {
	rpc := GetSessionManagerRpcClient()
	wshutil.DefaultRouter.RegisterRoute(wshutil.DefaultRoute, rpc, true)
}
