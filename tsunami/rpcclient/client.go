// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpcclient

import (
	"github.com/wavetermdev/waveterm/tsunami/rpc"
)

type EventListener struct {
	eventHandlers map[string][]func(event *rpc.WaveEvent)
}

func MakeEventListener() *EventListener {
	return &EventListener{
		eventHandlers: make(map[string][]func(event *rpc.WaveEvent)),
	}
}

func (el *EventListener) On(eventName string, handler func(event *rpc.WaveEvent)) {
	if el.eventHandlers == nil {
		el.eventHandlers = make(map[string][]func(event *rpc.WaveEvent))
	}
	el.eventHandlers[eventName] = append(el.eventHandlers[eventName], handler)
}

func (el *EventListener) Emit(eventName string, event *rpc.WaveEvent) {
	if handlers, exists := el.eventHandlers[eventName]; exists {
		for _, handler := range handlers {
			handler(event)
		}
	}
}

type RpcClient struct {
	EventListener *EventListener
}

func MakeRpcClient() *RpcClient {
	return &RpcClient{
		EventListener: MakeEventListener(),
	}
}