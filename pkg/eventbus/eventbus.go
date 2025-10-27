// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package eventbus

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

const (
	WSEvent_ElectronNewWindow       = "electron:newwindow"
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

func getWindowWatchesForWindowId(windowId string) []*WindowWatchData {
	globalLock.Lock()
	defer globalLock.Unlock()
	var watches []*WindowWatchData
	for _, wdata := range wsMap {
		if wdata.RouteId == windowId {
			watches = append(watches, wdata)
		}
	}
	return watches
}

// TODO fix busy wait -- but we need to wait until a new window connects back with a websocket
// returns true if the window is connected
func BusyWaitForWindowId(windowId string, timeout time.Duration) bool {
	endTime := time.Now().Add(timeout)
	for {
		if len(getWindowWatchesForWindowId(windowId)) > 0 {
			return true
		}
		if time.Now().After(endTime) {
			return false
		}
		time.Sleep(20 * time.Millisecond)
	}
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
