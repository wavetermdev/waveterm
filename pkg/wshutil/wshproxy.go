// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WshRpcProxy struct {
	Lock         *sync.Mutex
	RpcContext   *wshrpc.RpcContext
	ToRemoteCh   chan []byte
	FromRemoteCh chan []byte
	AuthToken    string
}

func MakeRpcProxy() *WshRpcProxy {
	return &WshRpcProxy{
		Lock:         &sync.Mutex{},
		ToRemoteCh:   make(chan []byte, DefaultInputChSize),
		FromRemoteCh: make(chan []byte, DefaultOutputChSize),
	}
}

func (p *WshRpcProxy) SetRpcContext(rpcCtx *wshrpc.RpcContext) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	p.RpcContext = rpcCtx
}

func (p *WshRpcProxy) GetRpcContext() *wshrpc.RpcContext {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	return p.RpcContext
}

func (p *WshRpcProxy) SetAuthToken(authToken string) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	p.AuthToken = authToken
}

func (p *WshRpcProxy) GetAuthToken() string {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	return p.AuthToken
}

func (p *WshRpcProxy) sendResponseError(msg RpcMessage, sendErr error) {
	if msg.ReqId == "" {
		// no response needed
		return
	}
	resp := RpcMessage{
		ResId: msg.ReqId,
		Route: msg.Source,
		Error: sendErr.Error(),
	}
	respBytes, _ := json.Marshal(resp)
	p.SendRpcMessage(respBytes)
}

func (p *WshRpcProxy) sendAuthenticateResponse(msg RpcMessage, routeId string) {
	if msg.ReqId == "" {
		// no response needed
		return
	}
	resp := RpcMessage{
		ResId: msg.ReqId,
		Route: msg.Source,
		Data:  wshrpc.CommandAuthenticateRtnData{RouteId: routeId},
	}
	respBytes, _ := json.Marshal(resp)
	p.SendRpcMessage(respBytes)
}

func handleAuthenticationCommand(msg RpcMessage) (*wshrpc.RpcContext, string, error) {
	if msg.Data == nil {
		return nil, "", fmt.Errorf("no data in authenticate message")
	}
	strData, ok := msg.Data.(string)
	if !ok {
		return nil, "", fmt.Errorf("data in authenticate message not a string")
	}
	newCtx, err := ValidateAndExtractRpcContextFromToken(strData)
	if err != nil {
		return nil, "", fmt.Errorf("error validating token: %w", err)
	}
	if newCtx == nil {
		return nil, "", fmt.Errorf("no context found in jwt token")
	}
	if newCtx.BlockId == "" && newCtx.Conn == "" {
		return nil, "", fmt.Errorf("no blockid or conn found in jwt token")
	}
	if newCtx.BlockId != "" {
		if _, err := uuid.Parse(newCtx.BlockId); err != nil {
			return nil, "", fmt.Errorf("invalid blockId in jwt token")
		}
	}
	routeId, err := MakeRouteIdFromCtx(newCtx)
	if err != nil {
		return nil, "", fmt.Errorf("error making routeId from context: %w", err)
	}
	return newCtx, routeId, nil
}

// runs on the client (stdio client)
func (p *WshRpcProxy) HandleClientProxyAuth(router *WshRouter) (string, error) {
	for {
		msgBytes, ok := <-p.FromRemoteCh
		if !ok {
			return "", fmt.Errorf("remote closed, not authenticated")
		}
		var origMsg RpcMessage
		err := json.Unmarshal(msgBytes, &origMsg)
		if err != nil {
			// nothing to do, can't even send a response since we don't have Source or ReqId
			continue
		}
		if origMsg.Command == "" {
			// this message is not allowed (protocol error at this point), ignore
			continue
		}
		// we only allow one command "authenticate", everything else returns an error
		if origMsg.Command != wshrpc.Command_Authenticate {
			respErr := fmt.Errorf("connection not authenticated")
			p.sendResponseError(origMsg, respErr)
			continue
		}
		authRtn, err := router.HandleProxyAuth(origMsg.Data)
		if err != nil {
			respErr := fmt.Errorf("error handling proxy auth: %w", err)
			p.sendResponseError(origMsg, respErr)
			return "", respErr
		}
		p.SetAuthToken(authRtn.AuthToken)
		announceMsg := RpcMessage{
			Command:   wshrpc.Command_RouteAnnounce,
			Source:    authRtn.RouteId,
			AuthToken: authRtn.AuthToken,
		}
		announceBytes, _ := json.Marshal(announceMsg)
		router.InjectMessage(announceBytes, authRtn.RouteId)
		p.sendAuthenticateResponse(origMsg, authRtn.RouteId)
		return authRtn.RouteId, nil
	}
}

// runs on the server
func (p *WshRpcProxy) HandleAuthentication() (*wshrpc.RpcContext, error) {
	for {
		msgBytes, ok := <-p.FromRemoteCh
		if !ok {
			return nil, fmt.Errorf("remote closed, not authenticated")
		}
		var msg RpcMessage
		err := json.Unmarshal(msgBytes, &msg)
		if err != nil {
			// nothing to do, can't even send a response since we don't have Source or ReqId
			continue
		}
		if msg.Command == "" {
			// this message is not allowed (protocol error at this point), ignore
			continue
		}
		// we only allow one command "authenticate", everything else returns an error
		if msg.Command != wshrpc.Command_Authenticate {
			respErr := fmt.Errorf("connection not authenticated")
			p.sendResponseError(msg, respErr)
			continue
		}
		newCtx, routeId, err := handleAuthenticationCommand(msg)
		if err != nil {
			p.sendResponseError(msg, err)
			continue
		}
		p.sendAuthenticateResponse(msg, routeId)
		return newCtx, nil
	}
}

func (p *WshRpcProxy) SendRpcMessage(msg []byte) {
	p.ToRemoteCh <- msg
}

func (p *WshRpcProxy) RecvRpcMessage() ([]byte, bool) {
	msgBytes, more := <-p.FromRemoteCh
	authToken := p.GetAuthToken()
	if !more || (p.RpcContext == nil && authToken == "") {
		return msgBytes, more
	}
	var msg RpcMessage
	err := json.Unmarshal(msgBytes, &msg)
	if err != nil {
		// nothing to do here -- will error out at another level
		return msgBytes, true
	}
	if p.RpcContext != nil {
		msg.Data, err = recodeCommandData(msg.Command, msg.Data, p.RpcContext)
		if err != nil {
			// nothing to do here -- will error out at another level
			return msgBytes, true
		}
	}
	if msg.AuthToken == "" {
		msg.AuthToken = authToken
	}
	newBytes, err := json.Marshal(msg)
	if err != nil {
		// nothing to do here
		return msgBytes, true
	}
	return newBytes, true
}
