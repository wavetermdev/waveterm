// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"log"
	"net"
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

func handleDomainSocketClient(conn net.Conn) {
	proxy := wshutil.MakeRpcProxy()
	go func() {
		writeErr := wshutil.AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("error writing to domain socket: %v\n", writeErr)
		}
	}()
	go func() {
		// when input is closed, close the connection
		defer conn.Close()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()
	rpcCtx, err := proxy.HandleAuthentication()
	if err != nil {
		conn.Close()
		log.Printf("error handling authentication: %v\n", err)
		return
	}
	// now that we're authenticated, set the ctx and attach to the router
	log.Printf("domain socket connection authenticated: %#v\n", rpcCtx)
	proxy.SetRpcContext(rpcCtx)
	wshutil.DefaultRouter.RegisterRoute("controller:"+rpcCtx.BlockId, proxy)
}

func RunWshRpcOverListener(listener net.Listener) {
	defer log.Printf("domain socket listener shutting down\n")
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("error accepting connection: %v\n", err)
			continue
		}
		log.Print("got domain socket connection\n")
		go handleDomainSocketClient(conn)
	}
}

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
