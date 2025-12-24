// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	DefaultRoute  = "wavesrv"
	UpstreamRoute = "upstream"
	SysRoute      = "sys" // this route doesn't exist, just a placeholder for system messages
	ElectronRoute = "electron"
	ControlRoute  = "$control" // control plane route

	ControlPrefix = "$"

	RoutePrefix_Conn       = "conn:"
	RoutePrefix_Controller = "controller:"
	RoutePrefix_Proc       = "proc:"
	RoutePrefix_Tab        = "tab:"
	RoutePrefix_FeBlock    = "feblock:"
	RoutePrefix_Builder    = "builder:"
)

// this works like a network switch

// TODO maybe move the wps integration here instead of in wshserver

type routeInfo struct {
	RpcId         string
	SourceRouteId string
	DestRouteId   string
}

type LinkId int32

const NoLinkId = 0

const LinkKind_Leaf = "leaf"
const LinkKind_Router = "router"

type msgAndRoute struct {
	msgBytes    []byte
	fromRouteId string
}

type routerMsg struct {
	msgBytes    []byte
	ingressLink LinkId
}

type linkMeta struct {
	linkId        LinkId
	trusted       bool
	linkKind      string
	sourceRouteId string
	client        AbstractRpcClient
}

func (lm *linkMeta) Name() string {
	return fmt.Sprintf("%d#[%s]", lm.linkId, lm.client.GetPeerInfo())
}

type rpcRoutingInfo struct {
	rpcId        string
	sourceLinkId LinkId
	destRouteId  string
}

type messageWrap struct {
	msgBytes []byte
	debugStr string
}

type WshRouter struct {
	lock           *sync.Mutex
	isRootRouter   bool
	nextLinkId     LinkId
	upstreamLinkId LinkId
	inputCh        chan routerMsg
	rpcMap         map[string]rpcRoutingInfo // rpcid => routeinfo
	routeMap       map[string]LinkId         // routeid => linkid
	linkMap        map[LinkId]*linkMeta

	upstreamBufLock     sync.Mutex
	upstreamBufCond     *sync.Cond
	upstreamBuf         []messageWrap
	upstreamLoopStarted bool
}

func MakeConnectionRouteId(connId string) string {
	return "conn:" + connId
}

func MakeControllerRouteId(blockId string) string {
	return "controller:" + blockId
}

func MakeProcRouteId(procId string) string {
	return "proc:" + procId
}

func MakeTabRouteId(tabId string) string {
	return "tab:" + tabId
}

func MakeFeBlockRouteId(blockId string) string {
	return "feblock:" + blockId
}

func MakeBuilderRouteId(builderId string) string {
	return "builder:" + builderId
}

var DefaultRouter = NewWshRouter()

func NewWshRouter() *WshRouter {
	rtn := &WshRouter{
		lock:           &sync.Mutex{},
		nextLinkId:     0,
		upstreamLinkId: NoLinkId,
		inputCh:        make(chan routerMsg),
		rpcMap:         make(map[string]rpcRoutingInfo),
		linkMap:        make(map[LinkId]*linkMeta),
		routeMap:       make(map[string]LinkId),
	}
	rtn.upstreamBufCond = sync.NewCond(&rtn.upstreamBufLock)
	go rtn.runServer()
	return rtn
}

func (router *WshRouter) IsRootRouter() bool {
	router.lock.Lock()
	defer router.lock.Unlock()
	return router.isRootRouter
}

func (router *WshRouter) SetAsRootRouter() {
	router.lock.Lock()
	defer router.lock.Unlock()
	router.isRootRouter = true
}

func noRouteErr(routeId string) error {
	if routeId == "" {
		return errors.New("no default route")
	}
	return fmt.Errorf("no route for %q", routeId)
}

func (router *WshRouter) SendEvent(routeId string, event wps.WaveEvent) {
	defer func() {
		panichandler.PanicHandler("WshRouter.SendEvent", recover())
	}()
	lm := router.getLinkForRoute(routeId)
	if lm == nil {
		return
	}
	msg := RpcMessage{
		Command: wshrpc.Command_EventRecv,
		Route:   routeId,
		Data:    event,
	}
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		// nothing to do
		return
	}
	lm.client.SendRpcMessage(msgBytes, "eventrecv")
}

func (router *WshRouter) handleNoRoute(msg RpcMessage, ingressLinkId LinkId) {
	lm := router.getLinkMeta(ingressLinkId)
	if lm == nil {
		return
	}
	nrErr := noRouteErr(msg.Route)
	if msg.ReqId == "" {
		if msg.Command == wshrpc.Command_Message {
			// to prevent infinite loops
			return
		}
		// no response needed, but send message back to source
		respMsg := RpcMessage{
			Command: wshrpc.Command_Message,
			Route:   msg.Source,
			Source:  ControlRoute,
			Data:    wshrpc.CommandMessageData{Message: nrErr.Error()},
		}
		respBytes, _ := json.Marshal(respMsg)
		lm.client.SendRpcMessage(respBytes, "no-route-err")
		return
	}
	// send error response
	response := RpcMessage{
		ResId: msg.ReqId,
		Error: nrErr.Error(),
	}
	respBytes, _ := json.Marshal(response)
	router.sendRoutedMessage(respBytes, msg.Source, msg.Command)
}

func (router *WshRouter) registerRouteInfo(rpcId string, sourceLinkId LinkId, destRouteId string) {
	if rpcId == "" {
		return
	}
	router.lock.Lock()
	defer router.lock.Unlock()
	router.rpcMap[rpcId] = rpcRoutingInfo{
		rpcId:        rpcId,
		sourceLinkId: sourceLinkId,
		destRouteId:  destRouteId,
	}
}

func (router *WshRouter) unregisterRouteInfo(rpcId string) {
	router.lock.Lock()
	defer router.lock.Unlock()
	delete(router.rpcMap, rpcId)
}

func (router *WshRouter) getRouteInfo(rpcId string) *rpcRoutingInfo {
	router.lock.Lock()
	defer router.lock.Unlock()
	rtn, ok := router.rpcMap[rpcId]
	if !ok {
		return nil
	}
	return &rtn
}

// returns true if message was sent, false if failed
func (router *WshRouter) sendRoutedMessage(msgBytes []byte, routeId string, commandName string) bool {
	lm := router.getLinkForRoute(routeId)
	if lm != nil {
		lm.client.SendRpcMessage(msgBytes, "route")
		return true
	}
	upstream := router.getUpstreamClient()
	if upstream != nil {
		upstream.SendRpcMessage(msgBytes, "route-upstream")
		return true
	}
	if commandName != "" {
		log.Printf("[router] no rpc for route id %q command:%s\n", routeId, commandName)
	} else {
		log.Printf("[router] no rpc for route id %q\n", routeId)
	}
	return false
}

func (router *WshRouter) sendMessageToLink(msgBytes []byte, linkId LinkId) bool {
	lm := router.getLinkMeta(linkId)
	if lm == nil {
		return false
	}
	lm.client.SendRpcMessage(msgBytes, "link")
	return true
}

func (router *WshRouter) runServer() {
	for input := range router.inputCh {
		msgBytes := input.msgBytes
		var msg RpcMessage
		err := json.Unmarshal(msgBytes, &msg)
		if err != nil {
			fmt.Println("error unmarshalling message: ", err)
			continue
		}
		routeId := msg.Route
		if msg.Command != "" {
			// new comand, setup new rpc
			ok := router.sendRoutedMessage(msgBytes, routeId, msg.Command)
			if !ok {
				router.handleNoRoute(msg, input.ingressLink)
				continue
			}
			router.registerRouteInfo(msg.ReqId, input.ingressLink, routeId)
			continue
		}
		// look at reqid or resid to route correctly
		if msg.ReqId != "" {
			routeInfo := router.getRouteInfo(msg.ReqId)
			if routeInfo == nil {
				// no route info, nothing to do
				continue
			}
			// no need to check the return value here (noop if failed)
			router.sendRoutedMessage(msgBytes, routeInfo.destRouteId, "")
			continue
		} else if msg.ResId != "" {
			routeInfo := router.getRouteInfo(msg.ResId)
			if routeInfo == nil {
				// no route info, nothing to do
				continue
			}
			router.sendMessageToLink(msgBytes, routeInfo.sourceLinkId)
			if !msg.Cont {
				router.unregisterRouteInfo(msg.ResId)
			}
			continue
		} else {
			// this is a bad message (no command, reqid, or resid)
			continue
		}
	}
}

func (router *WshRouter) WaitForRegister(ctx context.Context, routeId string) error {
	for {
		if router.getLinkForRoute(routeId) != nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(30 * time.Millisecond):
			continue
		}
	}
}

// this will never block, can be called while holding router.Lock
func (router *WshRouter) queueUpstreamMessage(msgBytes []byte, debugStr string) {
	if router.getUpstreamClient() == nil {
		return
	}
	router.upstreamBufLock.Lock()
	defer router.upstreamBufLock.Unlock()
	router.upstreamBuf = append(router.upstreamBuf, messageWrap{msgBytes: msgBytes, debugStr: debugStr})
	if !router.upstreamLoopStarted {
		router.upstreamLoopStarted = true
		go router.runUpstreamBufferLoop()
	}
	router.upstreamBufCond.Signal()
}

func (router *WshRouter) runUpstreamBufferLoop() {
	defer func() {
		panichandler.PanicHandler("WshRouter:runUpstreamBufferLoop", recover())
	}()
	for {
		router.upstreamBufLock.Lock()
		for len(router.upstreamBuf) == 0 {
			router.upstreamBufCond.Wait()
		}
		msg := router.upstreamBuf[0]
		router.upstreamBuf = router.upstreamBuf[1:]
		router.upstreamBufLock.Unlock()

		upstream := router.getUpstreamClient()
		if upstream != nil {
			upstream.SendRpcMessage(msg.msgBytes, msg.debugStr)
		}
	}
}

func (router *WshRouter) RegisterUntrustedLink(client AbstractRpcClient) LinkId {
	router.lock.Lock()
	defer router.lock.Unlock()
	router.nextLinkId++
	linkId := router.nextLinkId
	lm := &linkMeta{
		linkId:  linkId,
		trusted: false,
		client:  client,
	}
	log.Printf("wshrouter register link %s", lm.Name())
	router.linkMap[linkId] = lm
	go router.runLinkClientRecvLoop(linkId, client)
	return linkId
}

func (router *WshRouter) trustLink(linkId LinkId, linkKind string) {
	router.lock.Lock()
	defer router.lock.Unlock()
	lm := router.linkMap[linkId]
	if lm == nil {
		return
	}
	log.Printf("wshrouter trust link %s kind=%s", lm.Name(), linkKind)
	lm.trusted = true
	lm.linkKind = linkKind
}

func (router *WshRouter) runLinkClientRecvLoop(linkId LinkId, client AbstractRpcClient) {
	defer func() {
		panichandler.PanicHandler("WshRouter:runLinkClientRecvLoop", recover())
	}()
	exitReason := "unknown"
	lmForLog := router.getLinkMeta(linkId)
	linkName := fmt.Sprintf("%d", linkId)
	if lmForLog != nil {
		linkName = lmForLog.Name()
	}
	log.Printf("link recvloop start for %s", linkName)
	defer log.Printf("link recvloop done for %s (%s)", linkName, exitReason)
	for {
		msgBytes, ok := client.RecvRpcMessage()
		if !ok {
			exitReason = "recv-eof"
			break
		}
		var rpcMsg RpcMessage
		err := json.Unmarshal(msgBytes, &rpcMsg)
		if err != nil {
			continue
		}
		lm := router.getLinkMeta(linkId)
		if lm == nil {
			exitReason = "link-gone"
			break
		}
		if rpcMsg.IsRpcRequest() {
			if lm.sourceRouteId != "" {
				rpcMsg.Source = lm.sourceRouteId
			}
			if rpcMsg.Route == "" {
				rpcMsg.Route = DefaultRoute
			}
			if rpcMsg.Route == ControlRoute {
				router.handleControlMessage(rpcMsg, *lm)
				continue
			}
			msgBytes, err = json.Marshal(rpcMsg)
			if err != nil {
				continue
			}
			if !lm.trusted {
				sendControlUnauthenticatedErrorResponse(rpcMsg, *lm)
				continue
			}
		}
		if !lm.trusted {
			continue
		}
		router.inputCh <- routerMsg{msgBytes: msgBytes, ingressLink: linkId}
	}
}

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

// synchronized, returns a copy
func (router *WshRouter) getLinkMeta(linkId LinkId) *linkMeta {
	if linkId == NoLinkId {
		return nil
	}
	router.lock.Lock()
	defer router.lock.Unlock()
	lm := router.linkMap[linkId]
	if lm == nil {
		return nil
	}
	lmCopy := *lm
	return &lmCopy
}

// synchronized, returns a copy
func (router *WshRouter) getLinkForRoute(routeId string) *linkMeta {
	if routeId == "" {
		return nil
	}
	router.lock.Lock()
	defer router.lock.Unlock()
	linkId := router.routeMap[routeId]
	if linkId == NoLinkId {
		return nil
	}
	lm := router.linkMap[linkId]
	if lm == nil {
		return nil
	}
	lmCopy := *lm
	return &lmCopy
}

func (router *WshRouter) GetLinkIdForRoute(routeId string) LinkId {
	lm := router.getLinkForRoute(routeId)
	if lm == nil {
		return NoLinkId
	}
	return lm.linkId
}

// only for leaves
func (router *WshRouter) RegisterTrustedLeaf(rpc AbstractRpcClient, routeId string) (LinkId, error) {
	if !isBindableRouteId(routeId) {
		return 0, fmt.Errorf("invalid routeid %q", routeId)
	}
	linkId := router.RegisterUntrustedLink(rpc)
	router.trustLink(linkId, LinkKind_Leaf)
	router.bindRoute(linkId, routeId, true)
	return linkId, nil
}

// only for routers
func (router *WshRouter) RegisterTrustedRouter(rpc AbstractRpcClient) LinkId {
	linkId := router.RegisterUntrustedLink(rpc)
	router.trustLink(linkId, LinkKind_Router)
	return linkId
}

func (router *WshRouter) RegisterUpstream(rpc AbstractRpcClient) LinkId {
	if router.IsRootRouter() {
		panic("cannot register upstream for root router")
	}
	linkId := router.RegisterUntrustedLink(rpc)
	router.trustLink(linkId, LinkKind_Router)
	router.lock.Lock()
	defer router.lock.Unlock()
	router.upstreamLinkId = linkId
	return linkId
}

func (router *WshRouter) announceUpstream(routeId string) {
	msg := RpcMessage{
		Command: wshrpc.Command_RouteAnnounce,
		Route:   ControlRoute,
		Source:  routeId,
	}
	msgBytes, _ := json.Marshal(msg)
	router.queueUpstreamMessage(msgBytes, "upstream-announce")
}

func (router *WshRouter) unannounceUpstream(routeId string) {
	msg := RpcMessage{
		Command: wshrpc.Command_RouteUnannounce,
		Route:   ControlRoute,
		Source:  routeId,
	}
	msgBytes, _ := json.Marshal(msg)
	router.queueUpstreamMessage(msgBytes, "upstream-unannounce")
}

func (router *WshRouter) getRoutesForLink(linkId LinkId) []string {
	router.lock.Lock()
	defer router.lock.Unlock()
	var routes []string
	for routeId, mappedLinkId := range router.routeMap {
		if mappedLinkId == linkId {
			routes = append(routes, routeId)
		}
	}
	return routes
}

func (router *WshRouter) UnregisterLink(linkId LinkId) {
	routes := router.getRoutesForLink(linkId)
	for _, routeId := range routes {
		router.unbindRoute(linkId, routeId)
	}
	router.lock.Lock()
	defer router.lock.Unlock()
	lm := router.linkMap[linkId]
	if lm != nil {
		log.Printf("wshrouter unregister link %s", lm.Name())
	}
	delete(router.linkMap, linkId)
	if router.upstreamLinkId == linkId {
		router.upstreamLinkId = NoLinkId
	}
}

func isBindableRouteId(routeId string) bool {
	if routeId == "" || strings.HasPrefix(routeId, ControlPrefix) {
		return false
	}
	return true
}

func (router *WshRouter) unbindRouteLocally(linkId LinkId, routeId string) error {
	if linkId == NoLinkId {
		return fmt.Errorf("cannot unbind %q to NoLinkId", routeId)
	}
	router.lock.Lock()
	defer router.lock.Unlock()
	if router.routeMap[routeId] == linkId {
		delete(router.routeMap, routeId)
	}
	return nil
}

func (router *WshRouter) unbindRoute(linkId LinkId, routeId string) error {
	err := router.unbindRouteLocally(linkId, routeId)
	if err != nil {
		return err
	}
	lm := router.getLinkMeta(linkId)
	if lm != nil {
		log.Printf("wshrouter unbind route %q from %s", routeId, lm.Name())
	}
	router.unannounceUpstream(routeId)
	if router.IsRootRouter() {
		router.unsubscribeFromBroker(routeId)
	}
	return nil
}

func (router *WshRouter) bindRouteLocally(linkId LinkId, routeId string, isSourceRoute bool) error {
	if linkId == NoLinkId {
		return fmt.Errorf("cannot bindroute %q to NoLinkId", routeId)
	}
	if !isBindableRouteId(routeId) {
		return fmt.Errorf("router cannot register %q route (invalid routeid)", routeId)
	}
	router.lock.Lock()
	defer router.lock.Unlock()
	lm := router.linkMap[linkId]
	if lm == nil {
		return fmt.Errorf("cannot bind route %q, no link with id %d found", routeId, linkId)
	}
	if !lm.trusted {
		return fmt.Errorf("cannot bind route %q, link %d is not trusted", routeId, linkId)
	}
	if isSourceRoute {
		if lm.linkKind != LinkKind_Leaf {
			return fmt.Errorf("cannot bind source route %q to link %d (link is not a leaf)", routeId, linkId)
		}
		if lm.sourceRouteId != "" && lm.sourceRouteId != routeId {
			return fmt.Errorf("cannot bind source route %q to link %d (link already has source route %q)", routeId, linkId, lm.sourceRouteId)
		}
		lm.sourceRouteId = routeId
	} else {
		if lm.linkKind != LinkKind_Router {
			return fmt.Errorf("cannot bind route %q to link %d (link is not a router)", routeId, linkId)
		}
	}
	router.routeMap[routeId] = linkId
	return nil
}

func (router *WshRouter) bindRoute(linkId LinkId, routeId string, isSourceRoute bool) error {
	err := router.bindRouteLocally(linkId, routeId, isSourceRoute)
	if err != nil {
		return err
	}
	lm := router.getLinkMeta(linkId)
	if lm != nil {
		log.Printf("wshrouter bind route %q to %s", routeId, lm.Name())
	}
	router.announceUpstream(routeId)
	return nil
}

func (router *WshRouter) getUpstreamClient() AbstractRpcClient {
	router.lock.Lock()
	defer router.lock.Unlock()
	if router.upstreamLinkId == NoLinkId {
		return nil
	}
	lm := router.linkMap[router.upstreamLinkId]
	if lm == nil {
		return nil
	}
	return lm.client
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
	}
}

func (router *WshRouter) handleControlAuthenticateToken(m RpcMessage, linkMeta linkMeta) {
	entry, err := handleAuthenticateTokenCommand(m)
	if err != nil {
		log.Printf("wshrouter authenticate-token error %s: %v", linkMeta.Name(), err)
		sendControlErrorResponse(m, linkMeta, err.Error(), "auth-error")
		return
	}
	routeId, _ := MakeRouteIdFromCtx(entry.RpcContext)
	rtnData := wshrpc.CommandAuthenticateRtnData{
		RouteId:        routeId,
		PublicKey:      wavejwt.GetPublicKeyBase64(),
		Env:            entry.Env,
		InitScriptText: entry.ScriptText,
	}
	sendControlDataResponse(m, linkMeta, rtnData, "auth-rtn")
	log.Printf("wshrouter authenticate-token success %s routeid=%q", linkMeta.Name(), routeId)
	router.trustLink(linkMeta.linkId, LinkKind_Leaf)
	router.bindRoute(linkMeta.linkId, routeId, true)
}

func (router *WshRouter) handleControlAuthenticate(m RpcMessage, linkMeta linkMeta) {
	_, routeId, err := handleAuthenticationCommand(m)
	if err != nil {
		log.Printf("wshrouter authenticate error %s: %v", linkMeta.Name(), err)
		sendControlErrorResponse(m, linkMeta, err.Error(), "auth-error")
		return
	}
	rtnData := wshrpc.CommandAuthenticateRtnData{
		RouteId:   routeId,
		PublicKey: wavejwt.GetPublicKeyBase64(),
	}
	sendControlDataResponse(m, linkMeta, rtnData, "auth-rtn")
	log.Printf("wshrouter authenticate success %s routeid=%q", linkMeta.Name(), routeId)
	router.trustLink(linkMeta.linkId, LinkKind_Leaf)
	router.bindRoute(linkMeta.linkId, routeId, true)
}

func (router *WshRouter) unsubscribeFromBroker(routeId string) {
	defer func() {
		panichandler.PanicHandler("WshRouter:unregisterRoute:routegone", recover())
	}()
	wps.Broker.UnsubscribeAll(routeId)
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_RouteGone, Scopes: []string{routeId}})
}

// TODO remove
func (router *WshRouter) HandleProxyAuth(authData any) (wshrpc.CommandAuthenticateRtnData, error) {
	return wshrpc.CommandAuthenticateRtnData{}, nil
}

// TODO remove
func (router *WshRouter) InjectMessage(msgBytes []byte, routeId string) {
	// nothing
}
