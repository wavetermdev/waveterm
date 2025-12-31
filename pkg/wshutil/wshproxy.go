// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"fmt"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WshRpcProxy struct {
	Lock         *sync.Mutex
	RpcContext   *wshrpc.RpcContext
	ToRemoteCh   chan []byte
	FromRemoteCh chan []byte
	PeerInfo     string
}

func MakeRpcProxy(peerInfo string) *WshRpcProxy {
	return &WshRpcProxy{
		Lock:         &sync.Mutex{},
		ToRemoteCh:   make(chan []byte, DefaultInputChSize),
		FromRemoteCh: make(chan []byte, DefaultOutputChSize),
		PeerInfo:     peerInfo,
	}
}

func (p *WshRpcProxy) GetPeerInfo() string {
	return p.PeerInfo
}

func (p *WshRpcProxy) SetPeerInfo(peerInfo string) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	p.PeerInfo = peerInfo
}

// TODO: Figure out who is sending to closed routes and why we're not catching it
func (p *WshRpcProxy) SendRpcMessage(msg []byte, debugStr string) {
	defer func() {
		panicCtx := "WshRpcProxy.SendRpcMessage"
		if debugStr != "" {
			panicCtx = fmt.Sprintf("%s:%s", panicCtx, debugStr)
		}
		panichandler.PanicHandler(panicCtx, recover())
	}()
	p.ToRemoteCh <- msg
}

func (p *WshRpcProxy) RecvRpcMessage() ([]byte, bool) {
	msgBytes, more := <-p.FromRemoteCh
	return msgBytes, more
}
