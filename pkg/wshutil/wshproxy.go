// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
)

type WshRpcProxy struct {
	Lock         *sync.Mutex
	RpcContext   *wshrpc.RpcContext
	ToRemoteCh   chan []byte
	FromRemoteCh chan []byte
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

func (p *WshRpcProxy) sendResponse(msg RpcMessage) {
	if msg.ReqId == "" {
		// no response needed
		return
	}
	resp := RpcMessage{
		ResId: msg.ReqId,
		Route: msg.Source,
	}
	respBytes, _ := json.Marshal(resp)
	p.SendRpcMessage(respBytes)
}

func handleAuthenticationCommand(msg RpcMessage) (*wshrpc.RpcContext, error) {
	if msg.Data == nil {
		return nil, fmt.Errorf("no data in authenticate message")
	}
	strData, ok := msg.Data.(string)
	if !ok {
		return nil, fmt.Errorf("data in authenticate message not a string")
	}
	newCtx, err := ValidateAndExtractRpcContextFromToken(strData)
	if err != nil {
		return nil, fmt.Errorf("error validating token: %w", err)
	}
	if newCtx == nil {
		return nil, fmt.Errorf("no context found in jwt token")
	}
	if newCtx.BlockId == "" {
		return nil, fmt.Errorf("no blockId found in jwt token")
	}
	if _, err := uuid.Parse(newCtx.BlockId); err != nil {
		return nil, fmt.Errorf("invalid blockId in jwt token")
	}
	return newCtx, nil
}

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
		newCtx, err := handleAuthenticationCommand(msg)
		if err != nil {
			p.sendResponseError(msg, err)
			continue
		}
		p.sendResponse(msg)
		return newCtx, nil
	}
}

func (p *WshRpcProxy) SendRpcMessage(msg []byte) {
	p.ToRemoteCh <- msg
}

func (p *WshRpcProxy) RecvRpcMessage() ([]byte, bool) {
	msgBytes, ok := <-p.FromRemoteCh
	if !ok || p.RpcContext == nil {
		return msgBytes, ok
	}
	var msg RpcMessage
	err := json.Unmarshal(msgBytes, &msg)
	if err != nil {
		// nothing to do here -- will error out at another level
		return msgBytes, true
	}
	msg.Data, err = recodeCommandData(msg.Command, msg.Data, p.RpcContext)
	if err != nil {
		// nothing to do here -- will error out at another level
		return msgBytes, true
	}
	newBytes, err := json.Marshal(msg)
	if err != nil {
		// nothing to do here
		return msgBytes, true
	}
	return newBytes, true
}
