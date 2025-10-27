// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/web/webcmd"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const wsReadWaitTimeout = 15 * time.Second
const wsWriteWaitTimeout = 10 * time.Second
const wsPingPeriodTickTime = 10 * time.Second
const wsInitialPingTime = 1 * time.Second
const wsMaxMessageSize = 10 * 1024 * 1024

const DefaultCommandTimeout = 2 * time.Second

var GlobalLock = &sync.Mutex{}
var RouteToConnMap = map[string]string{} // routeid => connid

func RunWebSocketServer(listener net.Listener) {
	gr := mux.NewRouter()
	gr.HandleFunc("/ws", HandleWs)
	server := &http.Server{
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        gr,
	}
	server.SetKeepAlivesEnabled(false)
	log.Printf("[websocket] running websocket server on %s\n", listener.Addr())
	err := server.Serve(listener)
	if err != nil {
		log.Printf("[websocket] error trying to run websocket server: %v\n", err)
	}
}

var WebSocketUpgrader = websocket.Upgrader{
	ReadBufferSize:   4 * 1024,
	WriteBufferSize:  32 * 1024,
	HandshakeTimeout: 1 * time.Second,
	CheckOrigin:      func(r *http.Request) bool { return true },
}

func HandleWs(w http.ResponseWriter, r *http.Request) {
	err := HandleWsInternal(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func getMessageType(jmsg map[string]any) string {
	if str, ok := jmsg["type"].(string); ok {
		return str
	}
	return ""
}

func getStringFromMap(jmsg map[string]any, key string) string {
	if str, ok := jmsg[key].(string); ok {
		return str
	}
	return ""
}

func processWSCommand(jmsg map[string]any, outputCh chan any, rpcInputCh chan []byte) {
	var rtnErr error
	defer func() {
		panicErr := panichandler.PanicHandler("processWSCommand", recover())
		if panicErr != nil {
			rtnErr = panicErr
		}
		if rtnErr == nil {
			return
		}
		rtn := map[string]any{"type": "error", "error": rtnErr.Error()}
		outputCh <- rtn
	}()
	wsCommand, err := webcmd.ParseWSCommandMap(jmsg)
	if err != nil {
		rtnErr = fmt.Errorf("cannot parse wscommand: %v", err)
		return
	}
	switch cmd := wsCommand.(type) {
	case *webcmd.SetBlockTermSizeWSCommand:
		data := wshrpc.CommandBlockInputData{
			BlockId:  cmd.BlockId,
			TermSize: &cmd.TermSize,
		}
		rpcMsg := wshutil.RpcMessage{
			Command: wshrpc.Command_ControllerInput,
			Data:    data,
		}
		msgBytes, err := json.Marshal(rpcMsg)
		if err != nil {
			// this really should never fail since we just unmarshalled this value
			log.Printf("[websocket] error marshalling rpc message: %v\n", err)
			return
		}
		rpcInputCh <- msgBytes

	case *webcmd.BlockInputWSCommand:
		data := wshrpc.CommandBlockInputData{
			BlockId:     cmd.BlockId,
			InputData64: cmd.InputData64,
		}
		rpcMsg := wshutil.RpcMessage{
			Command: wshrpc.Command_ControllerInput,
			Data:    data,
		}
		msgBytes, err := json.Marshal(rpcMsg)
		if err != nil {
			// this really should never fail since we just unmarshalled this value
			log.Printf("[websocket] error marshalling rpc message: %v\n", err)
			return
		}
		rpcInputCh <- msgBytes

	case *webcmd.WSRpcCommand:
		rpcMsg := cmd.Message
		if rpcMsg == nil {
			return
		}
		msgBytes, err := json.Marshal(rpcMsg)
		if err != nil {
			// this really should never fail since we just unmarshalled this value
			return
		}
		rpcInputCh <- msgBytes
	}
}

func processMessage(jmsg map[string]any, outputCh chan any, rpcInputCh chan []byte) {
	wsCommand := getStringFromMap(jmsg, "wscommand")
	if wsCommand == "" {
		return
	}
	processWSCommand(jmsg, outputCh, rpcInputCh)
}

func ReadLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any, rpcInputCh chan []byte, routeId string) {
	readWait := wsReadWaitTimeout
	conn.SetReadLimit(wsMaxMessageSize)
	conn.SetReadDeadline(time.Now().Add(readWait))
	defer close(closeCh)
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[websocket] ReadPump error (%s): %v\n", routeId, err)
			break
		}
		jmsg := map[string]any{}
		err = json.Unmarshal(message, &jmsg)
		if err != nil {
			log.Printf("[websocket] error unmarshalling json: %v\n", err)
			break
		}
		conn.SetReadDeadline(time.Now().Add(readWait))
		msgType := getMessageType(jmsg)
		if msgType == "pong" {
			// nothing
			continue
		}
		if msgType == "ping" {
			now := time.Now()
			pongMessage := map[string]interface{}{"type": "pong", "stime": now.UnixMilli()}
			outputCh <- pongMessage
			continue
		}
		go processMessage(jmsg, outputCh, rpcInputCh)
	}
}

func WritePing(conn *websocket.Conn) error {
	now := time.Now()
	pingMessage := map[string]interface{}{"type": "ping", "stime": now.UnixMilli()}
	jsonVal, _ := json.Marshal(pingMessage)
	_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWaitTimeout)) // no error
	err := conn.WriteMessage(websocket.TextMessage, jsonVal)
	if err != nil {
		return err
	}
	return nil
}

func WriteLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any, routeId string) {
	ticker := time.NewTicker(wsInitialPingTime)
	defer ticker.Stop()
	initialPing := true
	for {
		select {
		case msg := <-outputCh:
			var barr []byte
			var err error
			if _, ok := msg.([]byte); ok {
				barr = msg.([]byte)
			} else {
				barr, err = json.Marshal(msg)
				if err != nil {
					log.Printf("[websocket] cannot marshal websocket message: %v\n", err)
					// just loop again
					break
				}
			}
			err = conn.WriteMessage(websocket.TextMessage, barr)
			if err != nil {
				conn.Close()
				log.Printf("[websocket] WritePump error (%s): %v\n", routeId, err)
				return
			}

		case <-ticker.C:
			err := WritePing(conn)
			if err != nil {
				log.Printf("[websocket] WritePump error (%s): %v\n", routeId, err)
				return
			}
			if initialPing {
				initialPing = false
				ticker.Reset(wsPingPeriodTickTime)
			}

		case <-closeCh:
			return
		}
	}
}

func registerConn(wsConnId string, routeId string, wproxy *wshutil.WshRpcProxy) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	curConnId := RouteToConnMap[routeId]
	if curConnId != "" {
		log.Printf("[websocket] warning: replacing existing connection for route %q\n", routeId)
		wshutil.DefaultRouter.UnregisterRoute(routeId)
	}
	RouteToConnMap[routeId] = wsConnId
	wshutil.DefaultRouter.RegisterRoute(routeId, wproxy, true)
}

func unregisterConn(wsConnId string, routeId string) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	curConnId := RouteToConnMap[routeId]
	if curConnId != wsConnId {
		// only unregister if we are the current connection (otherwise we were already removed)
		log.Printf("[websocket] warning: trying to unregister connection %q for route %q but it is not the current connection (ignoring)\n", wsConnId, routeId)
		return
	}
	delete(RouteToConnMap, routeId)
	wshutil.DefaultRouter.UnregisterRoute(routeId)
}

func HandleWsInternal(w http.ResponseWriter, r *http.Request) error {
	routeId := r.URL.Query().Get("routeid")
	if routeId == "" {
		return fmt.Errorf("routeid is required")
	}
	err := authkey.ValidateIncomingRequest(r)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(fmt.Sprintf("error validating authkey: %v", err)))
		log.Printf("[websocket] error validating authkey: %v\n", err)
		return err
	}
	conn, err := WebSocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return fmt.Errorf("WebSocket Upgrade Failed: %v", err)
	}
	defer conn.Close()
	wsConnId := uuid.New().String()
	outputCh := make(chan any, 100)
	closeCh := make(chan any)
	log.Printf("[websocket] new connection: connid:%s routeid:%s\n", wsConnId, routeId)
	eventbus.RegisterWSChannel(wsConnId, routeId, outputCh)
	defer eventbus.UnregisterWSChannel(wsConnId)
	wproxy := wshutil.MakeRpcProxy() // we create a wshproxy to handle rpc messages to/from the window
	defer close(wproxy.ToRemoteCh)
	registerConn(wsConnId, routeId, wproxy)
	defer unregisterConn(wsConnId, routeId)
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:outputCh", recover())
		}()
		// no waitgroup add here
		// move values from rpcOutputCh to outputCh
		for msgBytes := range wproxy.ToRemoteCh {
			rpcWSMsg := map[string]any{
				"eventtype": "rpc", // TODO don't hard code this (but def is in eventbus)
				"data":      json.RawMessage(msgBytes),
			}
			outputCh <- rpcWSMsg
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:ReadLoop", recover())
		}()
		// read loop
		defer wg.Done()
		ReadLoop(conn, outputCh, closeCh, wproxy.FromRemoteCh, routeId)
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:WriteLoop", recover())
		}()
		// write loop
		defer wg.Done()
		WriteLoop(conn, outputCh, closeCh, routeId)
	}()
	wg.Wait()
	close(wproxy.FromRemoteCh)
	return nil
}
