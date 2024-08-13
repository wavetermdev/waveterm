// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
)

type routeInfo struct {
	RpcId         string
	SourceRouteId string
	DestRouteId   string
}

type WshRouter struct {
	Lock         *sync.Mutex
	DefaultRoute string
	RouteMap     map[string]AbstractRpcClient
	RpcMap       map[string]*routeInfo
	InputCh      chan []byte
}

var DefaultRouter = NewWshRouter()

func NewWshRouter() *WshRouter {
	rtn := &WshRouter{
		Lock:     &sync.Mutex{},
		RouteMap: make(map[string]AbstractRpcClient),
		RpcMap:   make(map[string]*routeInfo),
		InputCh:  make(chan []byte, DefaultInputChSize),
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
		router.InputCh <- respBytes
		return
	}
	// send error response
	response := RpcMessage{
		Route: msg.Source,
		ResId: msg.ReqId,
		Error: nrErr.Error(),
	}
	respBytes, _ := json.Marshal(response)
	router.InputCh <- respBytes
}

func (router *WshRouter) registerRouteInfo(rpcId string, sourceRouteId string, destRouteId string) {
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

func (router *WshRouter) runServer() {
	for msgBytes := range router.InputCh {
		var msg RpcMessage
		err := json.Unmarshal(msgBytes, &msg)
		if err != nil {
			fmt.Println("error unmarshalling message: ", err)
			continue
		}
		var routeId string
		msg.Route, routeId = popRoute(msg.Route)
		if msg.Command != "" {
			// new comand, setup new rpc
			rpc := router.GetRpc(routeId)
			if rpc == nil {
				router.handleNoRoute(msg)
				continue
			}
			if msg.ReqId != "" {
				router.registerRouteInfo(msg.ReqId, msg.Source, routeId)
			}
			rpc.SendRpcMessage(msgBytes)
			continue
		}
		// look at reqid or resid to route correctly
		if msg.ReqId != "" {
			routeInfo := router.getRouteInfo(msg.ReqId)
			if routeInfo == nil {
				// no route info, nothing to do
				continue
			}
			rpc := router.GetRpc(routeInfo.DestRouteId)
			if rpc != nil {
				rpc.SendRpcMessage(msgBytes)
			}
			continue
		} else if msg.ResId != "" {
			routeInfo := router.getRouteInfo(msg.ResId)
			if routeInfo == nil {
				// no route info, nothing to do
				continue
			}
			rpc := router.GetRpc(routeInfo.SourceRouteId)
			if rpc != nil {
				rpc.SendRpcMessage(msgBytes)
			}
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

func addRoute(curRoute string, newRoute string) string {
	if curRoute == "" {
		return newRoute
	}
	return curRoute + "," + newRoute
}

// returns (newRoute, poppedRoute)
func popRoute(curRoute string) (string, string) {
	routes := strings.Split(curRoute, ",")
	if len(routes) == 1 {
		return "", curRoute
	}
	return strings.Join(routes[:len(routes)-1], ","), routes[len(routes)-1]
}

// this will also consume the output channel of the abstract client
func (router *WshRouter) RegisterRoute(routeId string, rpc AbstractRpcClient) {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	router.RouteMap[routeId] = rpc
	go func() {
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
				// new command, add source (for backward routing)
				rpcMsg.Source = addRoute(rpcMsg.Source, routeId)
				msgBytes, err = json.Marshal(rpcMsg)
				if err != nil {
					continue
				}
			}
			router.InputCh <- msgBytes
		}
	}()
}

func (router *WshRouter) UnregisterRoute(routeId string) {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	delete(router.RouteMap, routeId)
}

func (router *WshRouter) SetDefaultRoute(routeId string) {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	router.DefaultRoute = routeId
}

// this may return nil (returns default only for empty routeId)
func (router *WshRouter) GetRpc(routeId string) AbstractRpcClient {
	router.Lock.Lock()
	defer router.Lock.Unlock()
	if routeId == "" {
		routeId = router.DefaultRoute
	}
	return router.RouteMap[routeId]
}
