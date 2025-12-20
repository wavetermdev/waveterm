// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type multiProxyRouteInfo struct {
	RouteId    string
	AuthToken  string
	Proxy      *WshRpcProxy
	RpcContext *wshrpc.RpcContext
}

// handles messages from multiple unauthenitcated clients
type WshRpcMultiProxy struct {
	Lock            *sync.Mutex
	RouteInfo       map[string]*multiProxyRouteInfo // authtoken to info
	ToRemoteCh      chan []byte
	FromRemoteRawCh chan []byte // raw message from the remote
}

func MakeRpcMultiProxy() *WshRpcMultiProxy {
	return &WshRpcMultiProxy{
		Lock:            &sync.Mutex{},
		RouteInfo:       make(map[string]*multiProxyRouteInfo),
		ToRemoteCh:      make(chan []byte, DefaultInputChSize),
		FromRemoteRawCh: make(chan []byte, DefaultOutputChSize),
	}
}

func (p *WshRpcMultiProxy) DisposeRoutes() {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	for authToken, routeInfo := range p.RouteInfo {
		DefaultRouter.UnregisterRoute(routeInfo.RouteId)
		delete(p.RouteInfo, authToken)
	}
}

func (p *WshRpcMultiProxy) getRouteInfo(authToken string) *multiProxyRouteInfo {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	return p.RouteInfo[authToken]
}

func (p *WshRpcMultiProxy) setRouteInfo(authToken string, routeInfo *multiProxyRouteInfo) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	p.RouteInfo[authToken] = routeInfo
}

func (p *WshRpcMultiProxy) removeRouteInfo(authToken string) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	delete(p.RouteInfo, authToken)
}

func (p *WshRpcMultiProxy) sendResponseError(msg RpcMessage, sendErr error) {
	if msg.ReqId == "" {
		// no response needed
		return
	}
	resp := RpcMessage{
		ResId: msg.ReqId,
		Error: sendErr.Error(),
	}
	respBytes, _ := json.Marshal(resp)
	p.ToRemoteCh <- respBytes
}

func (p *WshRpcMultiProxy) sendAuthResponse(msg RpcMessage, routeId string, authToken string) {
	if msg.ReqId == "" {
		// no response needed
		return
	}
	resp := RpcMessage{
		ResId: msg.ReqId,
		Data:  wshrpc.CommandAuthenticateRtnData{RouteId: routeId, AuthToken: authToken},
	}
	respBytes, _ := json.Marshal(resp)
	p.ToRemoteCh <- respBytes
}

func (p *WshRpcMultiProxy) handleUnauthMessage(msgBytes []byte) {
	var msg RpcMessage
	err := json.Unmarshal(msgBytes, &msg)
	if err != nil {
		// nothing to do here, malformed message
		return
	}
	if msg.Command == wshrpc.Command_Authenticate {
		rpcContext, routeId, err := handleAuthenticationCommand(msg, wavebase.JwtSecret)
		if err != nil {
			p.sendResponseError(msg, err)
			return
		}
		routeInfo := &multiProxyRouteInfo{
			RouteId:    routeId,
			AuthToken:  uuid.New().String(),
			RpcContext: rpcContext,
		}
		routeInfo.Proxy = MakeRpcProxy()
		routeInfo.Proxy.SetRpcContext(rpcContext)
		p.setRouteInfo(routeInfo.AuthToken, routeInfo)
		p.sendAuthResponse(msg, routeId, routeInfo.AuthToken)
		go func() {
			defer func() {
				panichandler.PanicHandler("WshRpcMultiProxy:handleUnauthMessage", recover())
			}()
			for msgBytes := range routeInfo.Proxy.ToRemoteCh {
				p.ToRemoteCh <- msgBytes
			}
		}()
		DefaultRouter.RegisterRoute(routeId, routeInfo.Proxy, true)
		return
	}
	// TODO implement authenticatetoken for multiproxy unauth message
	if msg.AuthToken == "" {
		p.sendResponseError(msg, fmt.Errorf("no auth token"))
		return
	}
	routeInfo := p.getRouteInfo(msg.AuthToken)
	if routeInfo == nil {
		p.sendResponseError(msg, fmt.Errorf("invalid auth token"))
		return
	}
	if msg.Command != "" && msg.Source != routeInfo.RouteId {
		p.sendResponseError(msg, fmt.Errorf("invalid source route for auth token"))
		return
	}
	if msg.Command == wshrpc.Command_Dispose {
		DefaultRouter.UnregisterRoute(routeInfo.RouteId)
		p.removeRouteInfo(msg.AuthToken)
		close(routeInfo.Proxy.ToRemoteCh)
		close(routeInfo.Proxy.FromRemoteCh)
		return
	}
	routeInfo.Proxy.FromRemoteCh <- msgBytes
}

func (p *WshRpcMultiProxy) RunUnauthLoop() {
	// loop over unauthenticated message
	// handle Authenicate commands, and pass authenticated messages to the AuthCh
	for msgBytes := range p.FromRemoteRawCh {
		p.handleUnauthMessage(msgBytes)
	}
}
