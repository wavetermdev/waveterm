// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/service/blockservice"
	"github.com/wavetermdev/thenextwave/pkg/web/webcmd"
)

const wsReadWaitTimeout = 15 * time.Second
const wsWriteWaitTimeout = 10 * time.Second
const wsPingPeriodTickTime = 10 * time.Second
const wsInitialPingTime = 1 * time.Second

func RunWebSocketServer() {
	gr := mux.NewRouter()
	gr.HandleFunc("/ws", HandleWs)
	serverAddr := WebSocketServerDevAddr
	server := &http.Server{
		Addr:           serverAddr,
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        gr,
	}
	server.SetKeepAlivesEnabled(false)
	log.Printf("Running websocket server on %s\n", serverAddr)
	err := server.ListenAndServe()
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

func processWSCommand(jmsg map[string]any, outputCh chan any) {
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
		blockCmd := &blockcontroller.BlockInputCommand{
			Command:  blockcontroller.BlockCommand_Input,
			TermSize: &cmd.TermSize,
		}
		blockservice.BlockServiceInstance.SendCommand(cmd.BlockId, blockCmd)
	}
}

func processMessage(jmsg map[string]any, outputCh chan any) {
	wsCommand := getStringFromMap(jmsg, "wscommand")
	if wsCommand != "" {
		processWSCommand(jmsg, outputCh)
		return
	}
	msgType := getMessageType(jmsg)
	if msgType != "rpc" {
		return
	}
	reqId := getStringFromMap(jmsg, "reqid")
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
		rtn := map[string]any{"type": "rpcresp", "reqid": reqId, "error": rtnErr.Error()}
		outputCh <- rtn
	}()
	method := getStringFromMap(jmsg, "method")
	rtnErr = fmt.Errorf("unknown method %q", method)
}

func ReadLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any) {
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
		go processMessage(jmsg, outputCh)
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
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go func() {
		// read loop
		defer wg.Done()
		ReadLoop(conn, outputCh, closeCh)
	}()
	go func() {
		// write loop
		defer wg.Done()
		WriteLoop(conn, outputCh, closeCh)
	}()
	wg.Wait()
	return nil
}
