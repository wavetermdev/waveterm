// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package eventbus

import (
	"errors"
	"fmt"
	"log"
	"runtime/debug"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

const EventBufferSize = 50

var EventCh chan application.WailsEvent = make(chan application.WailsEvent, EventBufferSize)
var WindowEventCh chan WindowEvent = make(chan WindowEvent, EventBufferSize)
var shutdownCh chan struct{} = make(chan struct{})
var ErrQueueFull = errors.New("event queue full")

type WindowEvent struct {
	WindowId uint
	Event    application.WailsEvent
}

type WindowWatchData struct {
	Window        *application.WebviewWindow
	WaveWindowId  string
	WailsWindowId uint
	WatchedORefs  map[waveobj.ORef]bool
}

var globalLock = &sync.Mutex{}
var wailsApp *application.App
var wailsWindowMap = make(map[uint]*WindowWatchData)

func Start() {
	go processEvents()
}

func Shutdown() {
	close(shutdownCh)
}

func RegisterWailsApp(app *application.App) {
	globalLock.Lock()
	defer globalLock.Unlock()
	wailsApp = app
}

func RegisterWailsWindow(window *application.WebviewWindow, windowId string) {
	globalLock.Lock()
	defer globalLock.Unlock()
	if _, found := wailsWindowMap[window.ID()]; found {
		panic(fmt.Errorf("wails window already registered with eventbus: %d", window.ID()))
	}
	wailsWindowMap[window.ID()] = &WindowWatchData{
		Window:        window,
		WailsWindowId: window.ID(),
		WaveWindowId:  "",
		WatchedORefs:  make(map[waveobj.ORef]bool),
	}
}

func UnregisterWailsWindow(windowId uint) {
	globalLock.Lock()
	defer globalLock.Unlock()
	delete(wailsWindowMap, windowId)
}

func emitEventToWindow(event WindowEvent) {
	globalLock.Lock()
	wdata := wailsWindowMap[event.WindowId]
	globalLock.Unlock()
	if wdata != nil {
		wdata.Window.DispatchWailsEvent(&event.Event)
	}
}

func emitEventToAllWindows(event *application.WailsEvent) {
	globalLock.Lock()
	wins := make([]*application.WebviewWindow, 0, len(wailsWindowMap))
	for _, wdata := range wailsWindowMap {
		wins = append(wins, wdata.Window)
	}
	globalLock.Unlock()
	for _, window := range wins {
		window.DispatchWailsEvent(event)
	}
}

func SendEvent(event application.WailsEvent) {
	EventCh <- event
}

func findWindowIdsByORef(oref waveobj.ORef) []uint {
	globalLock.Lock()
	defer globalLock.Unlock()
	var ids []uint
	for _, wdata := range wailsWindowMap {
		if wdata.WatchedORefs[oref] {
			ids = append(ids, wdata.WailsWindowId)
		}
	}
	return ids
}

func SendORefEvent(oref waveobj.ORef, event application.WailsEvent) {
	wins := findWindowIdsByORef(oref)
	for _, windowId := range wins {
		SendWindowEvent(windowId, event)
	}
}

func SendEventNonBlocking(event application.WailsEvent) error {
	select {
	case EventCh <- event:
		return nil
	default:
		return ErrQueueFull
	}
}

func SendWindowEvent(windowId uint, event application.WailsEvent) {
	WindowEventCh <- WindowEvent{
		WindowId: windowId,
		Event:    event,
	}
}

func SendWindowEventNonBlocking(windowId uint, event application.WailsEvent) error {
	select {
	case WindowEventCh <- WindowEvent{
		WindowId: windowId,
		Event:    event,
	}:
		return nil
	default:
		return ErrQueueFull
	}
}

func processEvents() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("eventbus panic: %v\n", r)
			debug.PrintStack()
		}
	}()

	log.Printf("eventbus starting\n")
	for {
		select {
		case event := <-EventCh:
			emitEventToAllWindows(&event)
		case windowEvent := <-WindowEventCh:
			emitEventToWindow(windowEvent)

		case <-shutdownCh:
			log.Printf("eventbus shutting down\n")
			return
		}
	}
}
