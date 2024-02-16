// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Defines interfaces for creating communciation channels between server and clients
package scbus

import (
	"context"
	"fmt"
	"log"
	"reflect"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
)

var MainUpdateBus *UpdateBus = MakeUpdateBus()
var MainRpcBus *RpcBus = MakeRpcBus()

// The default channel size
const ChSize = 100

type Channel[I packet.PacketType] interface {
	GetChannel() chan I
	SetChannel(chan I)
	Match(string) bool
}

// A concurrent bus for registering and managing channels
type Bus[I packet.PacketType] struct {
	Lock     *sync.Mutex
	Channels map[string]Channel[I]
}

// Opens new channel and registers it with the bus. If a channel exists, it is closed and replaced.
func (bus *Bus[I]) RegisterChannel(key string, channelEntry Channel[I]) chan I {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	uch, found := bus.Channels[key]
	ch := make(chan I, ChSize)
	channelEntry.SetChannel(ch)
	if found {
		close(uch.GetChannel())
	}
	bus.Channels[key] = channelEntry
	return channelEntry.GetChannel()
}

// Closes the channel matching the provided key and removes it from the bus
func (bus *Bus[I]) UnregisterChannel(key string) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	uch, found := bus.Channels[key]
	if found {
		close(uch.GetChannel())
		delete(bus.Channels, key)
	}
}

// An interface for updates to be sent over an UpdateChannel
type UpdatePacket interface {
	// The key to use when marshalling to JSON and interpreting in the client
	GetType() string
	Clean()
	IsEmpty() bool
}

// A channel for sending model updates to the client
type UpdateChannel struct {
	ScreenId string
	ch       chan UpdatePacket
}

func (uch *UpdateChannel) GetChannel() chan UpdatePacket {
	return uch.ch
}

func (uch *UpdateChannel) SetChannel(ch chan UpdatePacket) {
	uch.ch = ch
}

// Match the screenId to the channel
func (sch *UpdateChannel) Match(screenId string) bool {
	if screenId == "" {
		return true
	}
	return screenId == sch.ScreenId
}

// A collection of channels that can transmit updates
type UpdateBus struct {
	Bus[UpdatePacket]
}

func (bus *UpdateBus) GetLock() *sync.Mutex {
	return bus.Lock
}

// Create a new UpdateBus
func MakeUpdateBus() *UpdateBus {
	return &UpdateBus{
		Bus[UpdatePacket]{
			Lock:     &sync.Mutex{},
			Channels: make(map[string]Channel[UpdatePacket]),
		},
	}
}

// Send an update to all channels in the collection
func (bus *UpdateBus) DoUpdate(update UpdatePacket) {
	if update.IsEmpty() {
		return
	}
	update.Clean()
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	for key, uch := range bus.Channels {
		select {
		case uch.GetChannel() <- update:

		default:
			log.Printf("[error] dropped update on %s updatebus uch key=%s\n", reflect.TypeOf(uch), key)
		}
	}
}

// Send a model update to only clients that are subscribed to the given screenId
func (bus *UpdateBus) DoScreenUpdate(screenId string, update UpdatePacket) {
	if update.IsEmpty() {
		return
	}
	update.Clean()
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	for id, uch := range bus.Channels {
		if uch.Match(screenId) {
			select {
			case uch.GetChannel() <- update:

			default:
				log.Printf("[error] dropped update on updatebus uch id=%s\n", id)
			}
		}
	}
}

// An interface for rpc requests
// This is separate from the RpcPacketType defined in the waveshell/pkg/packet package, as that one is intended for use communicating between wavesrv and waveshell. It is has a different set of required methods.
type RpcPacket interface {
	SetReqId(string)
	SetTimeoutMs(int)
	GetType() string
}

// An interface for rpc responses
// This is separate from the RpcResponsePacketType defined in the waveshell/pkg/packet package, as that one is intended for use communicating between wavesrv and waveshell. It is has a different set of required methods.
type RpcResponse interface {
	SetError(string)
	GetError() string
	GetType() string
}

// A collection of channels that can receive rpc responses
type RpcBus struct {
	Bus[RpcResponse]
}

// Create a new RpcBus
func MakeRpcBus() *RpcBus {
	return &RpcBus{
		Bus[RpcResponse]{
			Lock:     &sync.Mutex{},
			Channels: make(map[string]Channel[RpcResponse]),
		},
	}
}

// Get the user input channel for the given request id
func (bus *RpcBus) GetRpcChannel(id string) (chan RpcResponse, bool) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()

	if ch, ok := bus.Channels[id]; ok {
		return ch.GetChannel(), ok
	}
	return nil, false
}

// Implements the Channel interface to allow receiving rpc responses
type RpcChannel struct {
	ch chan RpcResponse
}

func (ch *RpcChannel) GetChannel() chan RpcResponse {
	return ch.ch
}

func (ch *RpcChannel) SetChannel(newCh chan RpcResponse) {
	ch.ch = newCh
}

// This is a no-op, only used to satisfy the Channel interface
func (ch *RpcChannel) Match(string) bool {
	return true
}

// Send a user input request to the frontend and wait for a response
func (bus *RpcBus) DoRpc(ctx context.Context, pk RpcPacket) (RpcResponse, error) {
	id := uuid.New().String()
	ch := bus.RegisterChannel(id, &RpcChannel{})
	pk.SetReqId(id)
	defer bus.UnregisterChannel(id)

	deadline, _ := ctx.Deadline()
	pk.SetTimeoutMs(int(time.Until(deadline).Milliseconds()) - 500)

	// Send the request to the frontend
	mu := MakeUpdatePacket()
	mu.AddUpdate(pk)
	MainUpdateBus.DoUpdate(mu)

	var response RpcResponse
	var err error
	// prepare to receive response
	select {
	case resp := <-ch:
		response = resp
	case <-ctx.Done():
		return nil, fmt.Errorf("timed out waiting for rpc response")
	}

	if response.GetError() != "" {
		err = fmt.Errorf(response.GetError())
	}

	return response, err
}
