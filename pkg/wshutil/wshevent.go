// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// event inverter.  converts WaveEvents to a listener.On() API

type singleListener struct {
	Id string
	Fn func(*wshrpc.WaveEvent)
}

type EventListener struct {
	Lock      *sync.Mutex
	Listeners map[string][]singleListener
}

func MakeEventListener() *EventListener {
	return &EventListener{
		Lock:      &sync.Mutex{},
		Listeners: make(map[string][]singleListener),
	}
}

func (el *EventListener) On(eventName string, fn func(*wshrpc.WaveEvent)) string {
	id := uuid.New().String()
	el.Lock.Lock()
	defer el.Lock.Unlock()
	larr := el.Listeners[eventName]
	larr = append(larr, singleListener{Id: id, Fn: fn})
	el.Listeners[eventName] = larr
	return id
}

func (el *EventListener) Unregister(eventName string, id string) {
	el.Lock.Lock()
	defer el.Lock.Unlock()
	larr := el.Listeners[eventName]
	newArr := make([]singleListener, 0)
	for _, sl := range larr {
		if sl.Id == id {
			continue
		}
		newArr = append(newArr, sl)
	}
	el.Listeners[eventName] = newArr
}

func (el *EventListener) getListeners(eventName string) []singleListener {
	el.Lock.Lock()
	defer el.Lock.Unlock()
	return el.Listeners[eventName]
}

func (el *EventListener) RecvEvent(e *wshrpc.WaveEvent) {
	larr := el.getListeners(e.Event)
	for _, sl := range larr {
		sl.Fn(e)
	}
}
