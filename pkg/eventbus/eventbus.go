// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package eventbus

import (
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

type WSEventType struct {
	EventType string `json:"eventtype"`
	ORef      string `json:"oref,omitempty"`
	Data      any    `json:"data"`
}

const (
	FileOp_Append = "append"
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
