// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package eventbus

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

const (
	WSEvent_WaveObjUpdate         = "waveobj:update"
	WSEvent_BlockFile             = "blockfile"
	WSEvent_Config                = "config"
	WSEvent_UserInput             = "userinput"
	WSEvent_BlockControllerStatus = "blockcontroller:status"
	WSEvent_LayoutAction          = "layoutaction"
	WSEvent_ElectronNewWindow     = "electron:newwindow"
	WSEvent_ElectronCloseWindow   = "electron:closewindow"
	WSEvent_Rpc                   = "rpc"
)

type WSEventType struct {
	EventType string `json:"eventtype"`
	ORef      string `json:"oref,omitempty"`
	Data      any    `json:"data"`
}

const (
	FileOp_Append     = "append"
	FileOp_Truncate   = "truncate"
	FileOp_Invalidate = "invalidate"
)

type WSFileEventData struct {
	ZoneId   string `json:"zoneid"`
	FileName string `json:"filename"`
	FileOp   string `json:"fileop"`
	Data64   string `json:"data64"`
}

type WindowWatchData struct {
	WindowWSCh   chan any
	WaveWindowId string
	WatchedORefs map[waveobj.ORef]bool
}

const (
	WSLayoutActionType_Insert = "insert"
	WSLayoutActionType_Remove = "delete"
)

var globalLock = &sync.Mutex{}
var wsMap = make(map[string]*WindowWatchData) // websocketid => WindowWatchData

func RegisterWSChannel(connId string, windowId string, ch chan any) {
	globalLock.Lock()
	defer globalLock.Unlock()
	wsMap[connId] = &WindowWatchData{
		WindowWSCh:   ch,
		WaveWindowId: windowId,
		WatchedORefs: make(map[waveobj.ORef]bool),
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
		if wdata.WaveWindowId == windowId {
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

func getAllWatches() []*WindowWatchData {
	globalLock.Lock()
	defer globalLock.Unlock()
	watches := make([]*WindowWatchData, 0, len(wsMap))
	for _, wdata := range wsMap {
		watches = append(watches, wdata)
	}
	return watches
}

func SendEventToWindow(windowId string, event WSEventType) {
	wwdArr := getWindowWatchesForWindowId(windowId)
	for _, wdata := range wwdArr {
		wdata.WindowWSCh <- event
	}
}

func SendEvent(event WSEventType) {
	wwdArr := getAllWatches()
	for _, wdata := range wwdArr {
		wdata.WindowWSCh <- event
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
