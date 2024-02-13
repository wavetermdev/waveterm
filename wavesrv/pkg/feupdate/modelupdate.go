// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package feupdate

import (
	"encoding/json"
	"log"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/feupdate/updatebus"
)

// The default bus for sending model updates to the client
var MainBus *ModelUpdateBus = MakeModelUpdateBus()

const ModelUpdateStr = "model"

// A bus for registering model update channels and sending model updates to the client
type ModelUpdateBus struct {
	bus *updatebus.UpdateBus[any, *ModelUpdateChannel[any]]
}

// Make a new model update bus
func MakeModelUpdateBus() *ModelUpdateBus {
	return &ModelUpdateBus{bus: updatebus.MakeUpdateBus[any, *ModelUpdateChannel[any]]()}
}

// Register a new channel for sending model updates to the client
func (bus *ModelUpdateBus) RegisterChannel(clientId string, screenId string) chan any {
	uch := &ModelUpdateChannel[any]{ScreenId: screenId, ClientId: clientId}
	return bus.bus.RegisterChannel(clientId, uch)
}

func (bus *ModelUpdateBus) UnregisterChannel(clientId string) {
	bus.bus.UnregisterChannel(clientId)
}

func (bus *ModelUpdateBus) SendUpdate(update updatebus.UpdatePacket) {
	bus.bus.SendUpdate(update)
}

// A channel for sending model updates to the client
type ModelUpdateChannel[J any] struct {
	ScreenId string
	ClientId string
	ch       chan J
}

func (uch *ModelUpdateChannel[J]) GetChannel() chan J {
	return uch.ch
}

func (uch *ModelUpdateChannel[J]) SetChannel(ch chan J) {
	uch.ch = ch
}

// Match the screenId to the channel
func (sch *ModelUpdateChannel[J]) Match(screenId string) bool {
	if screenId == "" {
		return true
	}
	return screenId == sch.ScreenId
}

// An UpdatePacket that is a collection of independent model updates to be sent to the client. Will be evaluated in order on the client.
type ModelUpdate []ModelUpdateItem

func (*ModelUpdate) UpdateType() string {
	return ModelUpdateStr
}

// Clean the ClientData in an update, if present
func (update *ModelUpdate) Clean() {
	if update == nil {
		return
	}
	for _, item := range *update {
		if i, ok := (item).(CleanableUpdateItem); ok {
			i.Clean()
		}
	}
}

func (mu *ModelUpdate) MarshalJSON() ([]byte, error) {
	rtn := make([]map[string]any, 0)
	for _, u := range *mu {
		m := make(map[string]any)
		m[(u).UpdateType()] = u
		rtn = append(rtn, m)
	}
	return json.Marshal(rtn)
}

// An interface for all model updates
type ModelUpdateItem interface {
	// The key to use when marshalling to JSON and interpreting in the client
	UpdateType() string
}

func (update *ModelUpdate) append(item ModelUpdateItem) {
	*update = append(*update, item)
}

// Add a collection of model updates to the update
func (update *ModelUpdate) AddUpdate(items ...ModelUpdateItem) {
	for _, i := range items {
		update.append(i)
	}
}

// Returns the items in the update that are of type I
func GetUpdateItems[I ModelUpdateItem](update *ModelUpdate) []*I {
	ret := make([]*I, 0)
	for _, item := range *update {
		if i, ok := (item).(I); ok {
			ret = append(ret, &i)
		}
	}
	return ret
}

// An interface for model updates that can be cleaned
type CleanableUpdateItem interface {
	Clean()
}

// Send a model update to only clients that are subscribed to the given screenId
func (bus *ModelUpdateBus) SendScreenUpdate(screenId string, update updatebus.UpdatePacket) {
	if update == nil {
		return
	}
	update.Clean()
	bus.bus.Lock.Lock()
	defer bus.bus.Lock.Unlock()
	for _, uch := range bus.bus.Channels {
		if uch.Match(screenId) {
			select {
			case uch.GetChannel() <- update:

			default:
				log.Printf("[error] dropped update on updatebus uch clientid=%s\n", uch.ClientId)
			}
		}
	}
}
