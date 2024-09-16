// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const DefaultRoute = "wavesrv"
const SysRoute = "sys" // this route doesn't exist, just a placeholder for system messages

// this works like a network switch

// TODO maybe move the wps integration here instead of in wshserver

type routeInfo struct {
	RpcId         string
	SourceRouteId string
	DestRouteId   string
}

type msgAndRoute struct {
	msgBytes    []byte
	fromRouteId string
}

type WshRouter struct {
	Lock            *sync.Mutex
	RouteMap        map[string]AbstractRpcClient // routeid => client
	UpstreamClient  AbstractRpcClient            // upstream client (if we are not the terminal router)
	AnnouncedRoutes map[string]string            // routeid => local routeid
	RpcMap          map[string]*routeInfo        // rpcid => routeinfo
	InputCh         chan msgAndRoute
}

func MakeConnectionRouteId(connId string) string {
	return "conn:" + connId
}

func MakeControllerRouteId(blockId string) string {
	return "controller:" + blockId
}

func MakeWindowRouteId(windowId string) string {
	return "window:" + windowId
}

func MakeProcRouteId(procId string) string {
	return "proc:" + procId
}

var DefaultRouter = NewWshRouter()

func NewWshRouter() *WshRouter {
	rtn := &WshRouter{
		Lock:            &sync.Mutex{},
		RouteMap:        make(map[string]AbstractRpcClient),
		AnnouncedRoutes: make(map[string]string),
		RpcMap:          make(map[string]*routeInfo),
		InputCh:         make(chan msgAndRoute, DefaultInputChSize),
	}
	go rtn.runServer()
	return rtn
}

func noRouteErr(routeId string) error {
	if routeId == "" {
		return errors.New("no default route")
	}
	return fmt.Errorf("no route for %q", routeId)
}

func (router *WshRouter) SendEvent(routeId string, event wps.WaveEvent) {
	rpc := router.GetRpc(routeId)
	if rpc == nil {
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
	rpc.SendRpcMessage(msgBytes)
}

func (router *WshRouter) handleNoRoute(msg RpcMessage) {
	nrErr := noRouteErr(msg.Route)
	if msg.ReqId == "" {
		if msg.Command == wshrpc.Command_Message {
			// to prevent infinite loops
			return
		}
		// no response needed, but send message back to source
		respMsg := RpcMessage{Command: wshrpc.Command_Message, Route: msg.Source, Data: wshrpc.CommandMessageData{Message: nrErr.Error()}}
		respBytes, _ := json.Marshal(respMsg)
		router.InputCh <- msgAndRoute{msgBytes: respBytes, fromRouteId: SysRoute}
		return
	}
	// send error response
	response := RpcMessage{
		ResId: msg.ReqId,
		Error: nrErr.Error(),
	}
	respBytes, _ := json.Marshal(response)
	router.sendRoutedMessage(respBytes, msg.Source)
}

func (router *WshRouter) registerRouteInfo(rpcId string, sourceRouteId string, destRouteId string) {
	if rpcId == "" {
		return
	}
	router.Lock.Lock()
	defer router.Lock.Unlock()
	router.RpcMap[rpcId] = &routeInfo{RpcId: rpcId, SourceRouteId: sourceRouteId, DestRouteId: destRouteId}
}

func (router *WshRouter) unregisterRouteInfo(rpcId string) {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	delete(router.RpcMap, rpcId)
}

func (router *WshRouter) getRouteInfo(rpcId string) *routeInfo {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	return router.RpcMap[rpcId]
}

func (router *WshRouter) handleAnnounceMessage(msg RpcMessage, input msgAndRoute) {
	// if we have an upstream, send it there
	// if we don't (we are the terminal router), then add it to our announced route map
	upstream := router.GetUpstreamClient()
	if upstream != nil {
		upstream.SendRpcMessage(input.msgBytes)
		return
	}
	if msg.Source == input.fromRouteId {
		// not necessary to save the id mapping
		return
	}
	router.Lock.Lock()
	defer router.Lock.Unlock()
	router.AnnouncedRoutes[msg.Source] = input.fromRouteId
}

func (router *WshRouter) handleUnannounceMessage(msg RpcMessage) {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	delete(router.AnnouncedRoutes, msg.Source)
}

func (router *WshRouter) getAnnouncedRoute(routeId string) string {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	return router.AnnouncedRoutes[routeId]
}

// returns true if message was sent, false if failed
func (router *WshRouter) sendRoutedMessage(msgBytes []byte, routeId string) bool {
	rpc := router.GetRpc(routeId)
	if rpc != nil {
		rpc.SendRpcMessage(msgBytes)
		return true
	}
	upstream := router.GetUpstreamClient()
	if upstream != nil {
		upstream.SendRpcMessage(msgBytes)
		return true
	} else {
		// we are the upstream, so consult our announced routes map
		localRouteId := router.getAnnouncedRoute(routeId)
		rpc := router.GetRpc(localRouteId)
		if rpc == nil {
			return false
		}
		rpc.SendRpcMessage(msgBytes)
		return true
	}
}

func (router *WshRouter) runServer() {
	for input := range router.InputCh {
		msgBytes := input.msgBytes
		var msg RpcMessage
		err := json.Unmarshal(msgBytes, &msg)
		if err != nil {
			fmt.Println("error unmarshalling message: ", err)
			continue
		}
		routeId := msg.Route
		if msg.Command == wshrpc.Command_RouteAnnounce {
			router.handleAnnounceMessage(msg, input)
			continue
		}
		if msg.Command == wshrpc.Command_RouteUnannounce {
			router.handleUnannounceMessage(msg)
			continue
		}
		if msg.Command != "" {
			// new comand, setup new rpc
			ok := router.sendRoutedMessage(msgBytes, routeId)
			if !ok {
				router.handleNoRoute(msg)
				continue
			}
			router.registerRouteInfo(msg.ReqId, msg.Source, routeId)
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
			router.sendRoutedMessage(msgBytes, routeInfo.DestRouteId)
			continue
		} else if msg.ResId != "" {
			routeInfo := router.getRouteInfo(msg.ResId)
			if routeInfo == nil {
				// no route info, nothing to do
				continue
			}
			router.sendRoutedMessage(msgBytes, routeInfo.SourceRouteId)
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
		if router.GetRpc(routeId) != nil {
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

// this will also consume the output channel of the abstract client
func (router *WshRouter) RegisterRoute(routeId string, rpc AbstractRpcClient) {
	if routeId == SysRoute {
		// cannot register sys route
		log.Printf("error: WshRouter cannot register sys route\n")
		return
	}
	log.Printf("[router] registering wsh route %q\n", routeId)
	router.Lock.Lock()
	defer router.Lock.Unlock()
	router.RouteMap[routeId] = rpc
	go func() {
		// announce
		if router.GetUpstreamClient() != nil {
			announceMsg := RpcMessage{Command: wshrpc.Command_RouteAnnounce, Source: routeId}
			announceBytes, _ := json.Marshal(announceMsg)
			router.GetUpstreamClient().SendRpcMessage(announceBytes)
		}
		for {
			msgBytes, ok := rpc.RecvRpcMessage()
			if !ok {
				break
			}
			var rpcMsg RpcMessage
			err := json.Unmarshal(msgBytes, &rpcMsg)
			if err != nil {
				continue
			}
			if rpcMsg.Command != "" {
				if rpcMsg.Source == "" {
					rpcMsg.Source = routeId
				}
				if rpcMsg.Route == "" {
					rpcMsg.Route = DefaultRoute
				}
				msgBytes, err = json.Marshal(rpcMsg)
				if err != nil {
					continue
				}
			}
			router.InputCh <- msgAndRoute{msgBytes: msgBytes, fromRouteId: routeId}
		}
	}()
}

func (router *WshRouter) UnregisterRoute(routeId string) {
	log.Printf("[router] unregistering wsh route %q\n", routeId)
	router.Lock.Lock()
	defer router.Lock.Unlock()
	delete(router.RouteMap, routeId)
	// clear out announced routes
	for routeId, localRouteId := range router.AnnouncedRoutes {
		if localRouteId == routeId {
			delete(router.AnnouncedRoutes, routeId)
		}
	}
	go func() {
		wps.Broker.UnsubscribeAll(routeId)
	}()
}

// this may return nil (returns default only for empty routeId)
func (router *WshRouter) GetRpc(routeId string) AbstractRpcClient {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	return router.RouteMap[routeId]
}

func (router *WshRouter) SetUpstreamClient(rpc AbstractRpcClient) {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	router.UpstreamClient = rpc
}

func (router *WshRouter) GetUpstreamClient() AbstractRpcClient {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	return router.UpstreamClient
}
