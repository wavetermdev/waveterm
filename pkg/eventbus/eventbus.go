// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package eventbus

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
)

const (
	WSEvent_ElectronCloseWindow     = "electron:closewindow"
	WSEvent_ElectronUpdateActiveTab = "electron:updateactivetab"
	WSEvent_Rpc                     = "rpc"
)

type WSEventType struct {
	EventType string `json:"eventtype"`
	ORef      string `json:"oref,omitempty"`
	Data      any    `json:"data"`
}

type WindowWatchData struct {
	WindowWSCh chan any
	RouteId    string
}

var globalLock = &sync.Mutex{}
var wsMap = make(map[string]*WindowWatchData) // websocketid => WindowWatchData

func RegisterWSChannel(connId string, routeId string, ch chan any) {
	globalLock.Lock()
	defer globalLock.Unlock()
	wsMap[connId] = &WindowWatchData{
		WindowWSCh: ch,
		RouteId:    routeId,
	}
}

func UnregisterWSChannel(connId string) {
	globalLock.Lock()
	defer globalLock.Unlock()
	delete(wsMap, connId)
}

func SendEventToElectron(event WSEventType) {
	barr, err := json.Marshal(event)
	if err != nil {
		log.Printf("cannot marshal electron message: %v\n", err)
		return
	}
	// send to electron
	log.Printf("sending event to electron: %q\n", event.EventType)
	fmt.Fprintf(os.Stderr, "\nWAVESRV-EVENT:%s\n", string(barr))
}
