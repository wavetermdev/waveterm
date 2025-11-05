// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
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
	p.SendRpcMessage(respBytes, "resp-error")
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
	p.SendRpcMessage(respBytes, "auth-resp")
}

func (p *WshRpcProxy) sendAuthenticateTokenResponse(msg RpcMessage, entry *shellutil.TokenSwapEntry) {
	if msg.ReqId == "" {
		// no response needed
		return
	}
	routeId, _ := MakeRouteIdFromCtx(entry.RpcContext) // already validated so don't need to check error
	resp := RpcMessage{
		ResId: msg.ReqId,
		Route: msg.Source,
		Data: wshrpc.CommandAuthenticateRtnData{
			RouteId:        routeId,
			Env:            entry.Env,
			InitScriptText: entry.ScriptText,
		},
	}
	respBytes, _ := json.Marshal(resp)
	p.SendRpcMessage(respBytes, "auth-token-resp")
}

func validateRpcContextFromAuth(newCtx *wshrpc.RpcContext) (string, error) {
	if newCtx == nil {
		return "", fmt.Errorf("no context found in jwt token")
	}
	if newCtx.BlockId == "" && newCtx.Conn == "" {
		return "", fmt.Errorf("no blockid or conn found in jwt token")
	}
	if newCtx.BlockId != "" {
		if _, err := uuid.Parse(newCtx.BlockId); err != nil {
			return "", fmt.Errorf("invalid blockId in jwt token")
		}
	}
	routeId, err := MakeRouteIdFromCtx(newCtx)
	if err != nil {
		return "", fmt.Errorf("error making routeId from context: %w", err)
	}
	return routeId, nil
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
	routeId, err := validateRpcContextFromAuth(newCtx)
	if err != nil {
		return nil, "", err
	}
	return newCtx, routeId, nil
}

func handleAuthenticateTokenCommand(msg RpcMessage) (*shellutil.TokenSwapEntry, error) {
	if msg.Data == nil {
		return nil, fmt.Errorf("no data in authenticatetoken message")
	}
	var tokenData wshrpc.CommandAuthenticateTokenData
	err := utilfn.ReUnmarshal(&tokenData, msg.Data)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling token data: %w", err)
	}
	if tokenData.Token == "" {
		return nil, fmt.Errorf("no token in authenticatetoken message")
	}
	entry := shellutil.GetAndRemoveTokenSwapEntry(tokenData.Token)
	if entry == nil {
		return nil, fmt.Errorf("no token entry found")
	}
	_, err = validateRpcContextFromAuth(entry.RpcContext)
	if err != nil {
		return nil, err
	}
	return entry, nil
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
		if origMsg.Command == wshrpc.Command_Authenticate {
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
		if origMsg.Command == wshrpc.Command_AuthenticateToken {
			// TODO implement authenticatetoken for proxyauth
		}
		respErr := fmt.Errorf("connection not authenticated")
		p.sendResponseError(origMsg, respErr)
		continue
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
		if msg.Command == wshrpc.Command_Authenticate {
			newCtx, routeId, err := handleAuthenticationCommand(msg)
			if err != nil {
				p.sendResponseError(msg, err)
				continue
			}
			p.sendAuthenticateResponse(msg, routeId)
			return newCtx, nil
		}
		if msg.Command == wshrpc.Command_AuthenticateToken {
			entry, err := handleAuthenticateTokenCommand(msg)
			if err != nil {
				p.sendResponseError(msg, err)
				continue
			}
			p.sendAuthenticateTokenResponse(msg, entry)
			return entry.RpcContext, nil
		}
		respErr := fmt.Errorf("connection not authenticated")
		p.sendResponseError(msg, respErr)
		continue
	}
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
