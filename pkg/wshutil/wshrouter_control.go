// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"log"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func sendControlUnauthenticatedErrorResponse(cmdMsg RpcMessage, linkMeta linkMeta) {
	if cmdMsg.ReqId == "" {
		return
	}
	rtnMsg := RpcMessage{
		Source: ControlRoute,
		ResId:  cmdMsg.ReqId,
		Error:  fmt.Sprintf("link is unauthenticated, cannot call %q", cmdMsg.Command),
	}
	rtnBytes, _ := json.Marshal(rtnMsg)
	linkMeta.client.SendRpcMessage(rtnBytes, "unauthenticated")
}

func sendControlErrorResponse(cmdMsg RpcMessage, linkMeta linkMeta, errorMsg string, debugStr string) {
	if cmdMsg.ReqId == "" {
		return
	}
	rtnMsg := RpcMessage{
		Source: ControlRoute,
		ResId:  cmdMsg.ReqId,
		Error:  errorMsg,
	}
	rtnBytes, _ := json.Marshal(rtnMsg)
	linkMeta.client.SendRpcMessage(rtnBytes, debugStr)
}

func sendControlDataResponse(cmdMsg RpcMessage, linkMeta linkMeta, data any, debugStr string) error {
	if cmdMsg.ReqId == "" {
		return nil
	}
	rtnMsg := RpcMessage{
		Source: ControlRoute,
		ResId:  cmdMsg.ReqId,
		Data:   data,
	}
	rtnBytes, err := json.Marshal(rtnMsg)
	if err != nil {
		return err
	}
	linkMeta.client.SendRpcMessage(rtnBytes, debugStr)
	return nil
}

func (router *WshRouter) handleControlMessage(m RpcMessage, linkMeta linkMeta) {
	defer func() {
		panichandler.PanicHandler("WshRouter:handleControlMessage", recover())
	}()
	if m.Command == wshrpc.Command_RouteAnnounce {
		if !linkMeta.trusted {
			sendControlUnauthenticatedErrorResponse(m, linkMeta)
			return
		}
		if m.Source == "" {
			sendControlErrorResponse(m, linkMeta, "no source in routeannounce", "control-error")
			return
		}
		router.bindRoute(linkMeta.linkId, m.Source, false)
		sendControlDataResponse(m, linkMeta, nil, "control-response")
		return
	} else if m.Command == wshrpc.Command_RouteUnannounce {
		if !linkMeta.trusted {
			sendControlUnauthenticatedErrorResponse(m, linkMeta)
			return
		}
		if m.Source == "" {
			sendControlErrorResponse(m, linkMeta, "no source in routeunannounce", "control-error")
			return
		}
		router.unbindRoute(linkMeta.linkId, m.Source)
		sendControlDataResponse(m, linkMeta, nil, "control-response")
		return
	} else if m.Command == wshrpc.Command_SetPeerInfo {
		if !linkMeta.trusted {
			sendControlUnauthenticatedErrorResponse(m, linkMeta)
			return
		}
		if proxy, ok := linkMeta.client.(*WshRpcProxy); ok {
			var peerInfo string
			if err := utilfn.ReUnmarshal(&peerInfo, m.Data); err != nil {
				sendControlErrorResponse(m, linkMeta, fmt.Sprintf("error unmarshaling setpeerinfo data: %v", err), "control-error")
				return
			}
			proxy.SetPeerInfo(peerInfo)
			sendControlDataResponse(m, linkMeta, nil, "control-response")
		} else {
			sendControlErrorResponse(m, linkMeta, "setpeerinfo only valid for proxy connections", "control-error")
		}
		return
	} else if m.Command == wshrpc.Command_Authenticate {
		router.handleControlAuthenticate(m, linkMeta)
	} else if m.Command == wshrpc.Command_AuthenticateToken {
		router.handleControlAuthenticateToken(m, linkMeta)
		return
	} else if m.Command == wshrpc.Command_GetJwtPublicKey {
		publicKey := wavejwt.GetPublicKeyBase64()
		sendControlDataResponse(m, linkMeta, publicKey, "getjwtpublickey-response")
		return
	}
}

func (router *WshRouter) handleControlAuthenticateToken(m RpcMessage, linkMeta linkMeta) {
	entry, err := handleAuthenticateTokenCommand(m)
	if err != nil {
		log.Printf("wshrouter authenticate-token error %s: %v", linkMeta.Name(), err)
		sendControlErrorResponse(m, linkMeta, err.Error(), "auth-error")
		return
	}
	if entry.RpcContext.IsRouter {
		log.Printf("wshrouter authenticate-token error (cannot auth router via token)")
		sendControlErrorResponse(m, linkMeta, "cannot auth router via token", "auth-error")
		return
	}
	if entry.RpcContext.RouteId == "" {
		log.Printf("wshrouter authenticate-token error (no routeid)")
		sendControlErrorResponse(m, linkMeta, "no routeid", "auth-error")
		return
	}
	rtnData := wshrpc.CommandAuthenticateRtnData{
		PublicKey:      wavejwt.GetPublicKeyBase64(),
		Env:            entry.Env,
		InitScriptText: entry.ScriptText,
	}
	sendControlDataResponse(m, linkMeta, rtnData, "auth-rtn")
	log.Printf("wshrouter authenticate-token success %s routeid=%q", linkMeta.Name(), entry.RpcContext.RouteId)
	router.trustLink(linkMeta.linkId, LinkKind_Leaf)
	router.bindRoute(linkMeta.linkId, entry.RpcContext.RouteId, true)
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

func validateRpcContextFromAuth(newCtx *wshrpc.RpcContext) (string, error) {
	if newCtx == nil {
		return "", fmt.Errorf("no context found in jwt token")
	}
	if newCtx.IsRouter && newCtx.RouteId != "" {
		return "", fmt.Errorf("invalid context, router cannot have a routeid")
	}
	if !newCtx.IsRouter && newCtx.RouteId == "" {
		return "", fmt.Errorf("invalid context, must have a routeid")
	}
	if newCtx.IsRouter {
		return "", nil
	}
	return newCtx.RouteId, nil
}

func (router *WshRouter) handleControlAuthenticate(m RpcMessage, linkMeta linkMeta) {
	rpcCtx, routeId, err := handleAuthenticationCommand(m)
	if err != nil {
		log.Printf("wshrouter authenticate error %s: %v", linkMeta.Name(), err)
		sendControlErrorResponse(m, linkMeta, err.Error(), "auth-error")
		return
	}
	rtnData := wshrpc.CommandAuthenticateRtnData{
		PublicKey: wavejwt.GetPublicKeyBase64(),
	}
	sendControlDataResponse(m, linkMeta, rtnData, "auth-rtn")
	if rpcCtx.IsRouter {
		log.Printf("wshrouter authenticate success %s (router)", linkMeta.Name())
		router.trustLink(linkMeta.linkId, LinkKind_Router)
	} else {
		log.Printf("wshrouter authenticate success %s routeid=%q", linkMeta.Name(), routeId)
		router.trustLink(linkMeta.linkId, LinkKind_Leaf)
		router.bindRoute(linkMeta.linkId, routeId, true)
	}
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
