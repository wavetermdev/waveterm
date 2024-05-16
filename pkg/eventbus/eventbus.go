// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package eventbus

import (
	"errors"
	"log"
	"runtime/debug"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
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

var globalLock = &sync.Mutex{}
var wailsApp *application.App
var wailsWindowMap = make(map[uint]*application.WebviewWindow)

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

func RegisterWailsWindow(window *application.WebviewWindow) {
	globalLock.Lock()
	defer globalLock.Unlock()
	wailsWindowMap[window.ID()] = window
}

func UnregisterWailsWindow(windowId uint) {
	globalLock.Lock()
	defer globalLock.Unlock()
	delete(wailsWindowMap, windowId)
}

func emitEventToWindow(event WindowEvent) {
	globalLock.Lock()
	window := wailsWindowMap[event.WindowId]
	globalLock.Unlock()
	if window != nil {
		window.DispatchWailsEvent(&event.Event)
	}
}

func emitEventToAllWindows(event *application.WailsEvent) {
	globalLock.Lock()
	wins := make([]*application.WebviewWindow, 0, len(wailsWindowMap))
	for _, window := range wailsWindowMap {
		wins = append(wins, window)
	}
	globalLock.Unlock()
	for _, window := range wins {
		window.DispatchWailsEvent(event)
	}
}

func SendEvent(event application.WailsEvent) {
	EventCh <- event
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
