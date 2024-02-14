// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
)

var MainBus *UpdateBus = MakeUpdateBus()

const PtyDataUpdateStr = "pty"
const ModelUpdateStr = "model"
const UpdateChSize = 100

type UpdatePacket interface {
	// The key to use when marshalling to JSON and interpreting in the client
	UpdateType() string
	Clean()
}

type PtyDataUpdate struct {
	ScreenId   string `json:"screenid,omitempty"`
	LineId     string `json:"lineid,omitempty"`
	RemoteId   string `json:"remoteid,omitempty"`
	PtyPos     int64  `json:"ptypos"`
	PtyData64  string `json:"ptydata64"`
	PtyDataLen int64  `json:"ptydatalen"`
}

func (*PtyDataUpdate) UpdateType() string {
	return PtyDataUpdateStr
}

func (pdu *PtyDataUpdate) Clean() {}

// A collection of independent model updates to be sent to the client. Will be evaluated in order on the client.
type ModelUpdate []*ModelUpdateItem

func (*ModelUpdate) UpdateType() string {
	return ModelUpdateStr
}

func (mu *ModelUpdate) MarshalJSON() ([]byte, error) {
	rtn := make([]map[string]any, 0)
	for _, u := range *mu {
		m := make(map[string]any)
		m[(*u).UpdateType()] = u
		rtn = append(rtn, m)
	}
	return json.Marshal(rtn)
}

// An interface for all model updates
type ModelUpdateItem interface {
	// The key to use when marshalling to JSON and interpreting in the client
	UpdateType() string
}

// Clean the ClientData in an update, if present
func (update *ModelUpdate) Clean() {
	if update == nil {
		return
	}
	clientDataUpdates := GetUpdateItems[ClientData](update)
	if len(clientDataUpdates) > 0 {
		lastUpdate := clientDataUpdates[len(clientDataUpdates)-1]
		lastUpdate.Clean()
	}
}

func (update *ModelUpdate) append(item *ModelUpdateItem) {
	*update = append(*update, item)
}

// Add a collection of model updates to the update
func AddUpdate(update *ModelUpdate, item ...ModelUpdateItem) {
	for _, i := range item {
		update.append(&i)
	}
}

// Returns the items in the update that are of type I
func GetUpdateItems[I ModelUpdateItem](update *ModelUpdate) []*I {
	ret := make([]*I, 0)
	for _, item := range *update {
		if i, ok := (*item).(I); ok {
			ret = append(ret, &i)
		}
	}
	return ret
}

type UpdateChannel struct {
	ScreenId string
	ClientId string
	Ch       chan interface{}
}

func (uch UpdateChannel) Match(screenId string) bool {
	if screenId == "" {
		return true
	}
	return screenId == uch.ScreenId
}

type UpdateBus struct {
	Lock        *sync.Mutex
	Channels    map[string]UpdateChannel
	UserInputCh map[string](chan *scpacket.UserInputResponsePacketType)
}

func MakeUpdateBus() *UpdateBus {
	return &UpdateBus{
		Lock:        &sync.Mutex{},
		Channels:    make(map[string]UpdateChannel),
		UserInputCh: make(map[string](chan *scpacket.UserInputResponsePacketType)),
	}
}

// always returns a new channel
func (bus *UpdateBus) RegisterChannel(clientId string, screenId string) chan interface{} {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	uch, found := bus.Channels[clientId]
	if found {
		close(uch.Ch)
		uch.ScreenId = screenId
		uch.Ch = make(chan interface{}, UpdateChSize)
	} else {
		uch = UpdateChannel{
			ClientId: clientId,
			ScreenId: screenId,
			Ch:       make(chan interface{}, UpdateChSize),
		}
	}
	bus.Channels[clientId] = uch
	return uch.Ch
}

func (bus *UpdateBus) UnregisterChannel(clientId string) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	uch, found := bus.Channels[clientId]
	if found {
		close(uch.Ch)
		delete(bus.Channels, clientId)
	}
}

func (bus *UpdateBus) SendUpdate(update UpdatePacket) {
	if update == nil {
		return
	}
	update.Clean()
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	for _, uch := range bus.Channels {
		select {
		case uch.Ch <- update:

		default:
			log.Printf("[error] dropped update on updatebus uch clientid=%s\n", uch.ClientId)
		}
	}
}

func (bus *UpdateBus) SendScreenUpdate(screenId string, update UpdatePacket) {
	if update == nil {
		return
	}
	update.Clean()
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	for _, uch := range bus.Channels {
		if uch.Match(screenId) {
			select {
			case uch.Ch <- update:

			default:
				log.Printf("[error] dropped update on updatebus uch clientid=%s\n", uch.ClientId)
			}
		}
	}
}

func (bus *UpdateBus) registerUserInputChannel() (string, chan *scpacket.UserInputResponsePacketType) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()

	id := uuid.New().String()
	uich := make(chan *scpacket.UserInputResponsePacketType, 1)

	bus.UserInputCh[id] = uich
	return id, uich
}

func (bus *UpdateBus) unregisterUserInputChannel(id string) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()

	delete(bus.UserInputCh, id)
}

func (bus *UpdateBus) GetUserInputChannel(id string) (chan *scpacket.UserInputResponsePacketType, bool) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()

	uich, ok := bus.UserInputCh[id]
	return uich, ok
}

func (bus *UpdateBus) GetUserInput(ctx context.Context, userInputRequest *UserInputRequestType) (*scpacket.UserInputResponsePacketType, error) {
	id, uich := bus.registerUserInputChannel()
	defer bus.unregisterUserInputChannel(id)

	userInputRequest.RequestId = id
	deadline, _ := ctx.Deadline()
	userInputRequest.TimeoutMs = int(time.Until(deadline).Milliseconds()) - 500
	update := &ModelUpdate{}
	AddUpdate(update, *userInputRequest)
	bus.SendUpdate(update)

	var response *scpacket.UserInputResponsePacketType
	var err error
	// prepare to receive response
	select {
	case resp := <-uich:
		response = resp
	case <-ctx.Done():
		return nil, fmt.Errorf("Timed out waiting for user input")
	}

	if response.ErrorMsg != "" {
		err = fmt.Errorf(response.ErrorMsg)
	}

	return response, err
}
