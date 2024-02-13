// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Primitives for busses to transmit updates between components
package updatebus

import (
	"log"
	"reflect"
	"sync"
)

// The default channel size for UpdateChannels
const UpdateChSize = 100

// An interface for updates to be sent over an UpdateBus
type UpdatePacket interface {
	// The key to use when marshalling to JSON and interpreting in the client
	UpdateType() string
	Clean()
}

// An interface for channels that can transmit updates
type UpdateChannel[I any] interface {
	GetChannel() chan I
	SetChannel(chan I)
}

// A collection of channels that can transmit updates
type UpdateBus[J any, I UpdateChannel[J]] struct {
	Lock     *sync.Mutex
	Channels map[string]I
}

// Create a new UpdateBus
func MakeUpdateBus[J any, I UpdateChannel[J]]() *UpdateBus[J, I] {
	return &UpdateBus[J, I]{
		Lock:     &sync.Mutex{},
		Channels: make(map[string]I),
	}
}

// Opens new channel and registers it with the bus. If a channel exists, it is closed and replaced.
func (bus *UpdateBus[J, I]) RegisterChannel(key string, channelEntry I) chan J {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	uch, found := bus.Channels[key]
	ch := make(chan J, UpdateChSize)
	log.Printf("registering channel key=%s ch=%v\n", key, ch)
	channelEntry.SetChannel(ch)
	if found {
		close(uch.GetChannel())
	}
	bus.Channels[key] = channelEntry
	return channelEntry.GetChannel()
}

// Closes the channel matching the provided key and removes it from the bus
func (bus *UpdateBus[J, I]) UnregisterChannel(key string) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	uch, found := bus.Channels[key]
	if found {
		close(uch.GetChannel())
		delete(bus.Channels, key)
	}
}

// Send an update to all channels in the collection
func (bus *UpdateBus[J, I]) SendUpdate(update UpdatePacket) {
	if update == nil {
		return
	}
	update.Clean()
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	for key, uch := range bus.Channels {
		select {
		case uch.GetChannel() <- update.(J):

		default:
			log.Printf("[error] dropped update on %s updatebus uch key=%s\n", reflect.TypeOf(uch), key)
		}
	}
}
