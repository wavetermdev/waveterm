// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/wavetermdev/thenextwave/pkg/authkey"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/web/webcmd"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

const wsReadWaitTimeout = 15 * time.Second
const wsWriteWaitTimeout = 10 * time.Second
const wsPingPeriodTickTime = 10 * time.Second
const wsInitialPingTime = 1 * time.Second

const DefaultCommandTimeout = 2 * time.Second

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
	log.Printf("Running websocket server on %s\n", listener.Addr())
	err := server.Serve(listener)
	if err != nil {
		log.Printf("[error] trying to run websocket server: %v\n", err)
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
		r := recover()
		if r != nil {
			rtnErr = fmt.Errorf("panic: %v", r)
			log.Printf("panic in processMessage: %v\n", r)
			debug.PrintStack()
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
			log.Printf("error marshalling rpc message: %v\n", err)
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
			log.Printf("error marshalling rpc message: %v\n", err)
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

func ReadLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any, rpcInputCh chan []byte) {
	readWait := wsReadWaitTimeout
	conn.SetReadLimit(64 * 1024)
	conn.SetReadDeadline(time.Now().Add(readWait))
	defer close(closeCh)
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("ReadPump error: %v\n", err)
			break
		}
		jmsg := map[string]any{}
		err = json.Unmarshal(message, &jmsg)
		if err != nil {
			log.Printf("Error unmarshalling json: %v\n", err)
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

func WriteLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any) {
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
					log.Printf("cannot marshal websocket message: %v\n", err)
					// just loop again
					break
				}
			}
			err = conn.WriteMessage(websocket.TextMessage, barr)
			if err != nil {
				conn.Close()
				log.Printf("WritePump error: %v\n", err)
				return
			}

		case <-ticker.C:
			err := WritePing(conn)
			if err != nil {
				log.Printf("WritePump error: %v\n", err)
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

func HandleWsInternal(w http.ResponseWriter, r *http.Request) error {
	windowId := r.URL.Query().Get("windowid")
	if windowId == "" {
		return fmt.Errorf("windowid is required")
	}

	err := authkey.ValidateIncomingRequest(r)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(fmt.Sprintf("error validating authkey: %v", err)))
		return err
	}
	conn, err := WebSocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return fmt.Errorf("WebSocket Upgrade Failed: %v", err)
	}
	defer conn.Close()
	wsConnId := uuid.New().String()
	log.Printf("New websocket connection: windowid:%s connid:%s\n", windowId, wsConnId)
	outputCh := make(chan any, 100)
	closeCh := make(chan any)
	eventbus.RegisterWSChannel(wsConnId, windowId, outputCh)
	defer eventbus.UnregisterWSChannel(wsConnId)
	// we create a wshproxy to handle rpc messages to/from the window
	wproxy := wshutil.MakeRpcProxy()
	wshutil.DefaultRouter.RegisterRoute(wshutil.MakeWindowRouteId(windowId), wproxy)
	defer func() {
		wshutil.DefaultRouter.UnregisterRoute(wshutil.MakeWindowRouteId(windowId))
		close(wproxy.ToRemoteCh)
	}()
	// WshServerFactoryFn(rpcInputCh, rpcOutputCh, wshrpc.RpcContext{})
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go func() {
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
		// read loop
		defer wg.Done()
		ReadLoop(conn, outputCh, closeCh, wproxy.FromRemoteCh)
	}()
	go func() {
		// write loop
		defer wg.Done()
		WriteLoop(conn, outputCh, closeCh)
	}()
	wg.Wait()
	close(wproxy.FromRemoteCh)
	return nil
}
