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

type ModelUpdate []*ModelUpdateItem

func (*ModelUpdate) UpdateType() string {
	return ModelUpdateStr
}

func (mu *ModelUpdate) MarshalJSON() ([]byte, error) {
	rtn := make([]map[string]any, len(*mu))
	for _, u := range *mu {
		m := make(map[string]any)
		m[(*u).UpdateType()] = u
		rtn = append(rtn, m)
	}
	return json.Marshal(rtn)
}

type ModelUpdateItem interface {
	UpdateType() string
}

func (update *ModelUpdate) Clean() {
	if update == nil {
		return
	}
	clientDataUpdates := GetUpdateItems[ClientDataUpdate](update)
	if len(clientDataUpdates) > 0 {
		lastUpdate := clientDataUpdates[len(clientDataUpdates)-1]
		(*ClientData)(lastUpdate).Clean()
	}
}

func (update *ModelUpdate) append(item *ModelUpdateItem) {
	*update = append(*update, item)
}

func AddUpdate[I ModelUpdateItem](update *ModelUpdate, item I) {
	updateItem := (ModelUpdateItem)(item)
	update.append(&updateItem)
}

// Returns the first value for the key, nil if not found
func GetUpdateItems[I ModelUpdateItem](update *ModelUpdate) []*I {
	ret := make([]*I, 0)
	for _, item := range *update {
		if i, ok := (*item).(I); ok {
			ret = append(ret, &i)
		}
	}
	return ret
}

// only sets InfoError if InfoError is not already set
func (update *ModelUpdate) AddInfoError(errStr string) {
	infoUpdates := GetUpdateItems[InfoUpdate](update)

	if len(infoUpdates) > 0 {
		lastUpdate := infoUpdates[len(infoUpdates)-1]
		if lastUpdate.InfoError == "" {
			lastUpdate.InfoError = errStr
			return
		}
	} else {
		newInfoUpdate := InfoUpdate{InfoError: errStr}
		AddUpdate(update, newInfoUpdate)
	}
}

type RemoteViewType struct {
	RemoteShowAll bool            `json:"remoteshowall,omitempty"`
	PtyRemoteId   string          `json:"ptyremoteid,omitempty"`
	RemoteEdit    *RemoteEditType `json:"remoteedit,omitempty"`
}

type HistoryViewData struct {
	Items         []*HistoryItemType `json:"items"`
	Offset        int                `json:"offset"`
	RawOffset     int                `json:"rawoffset"`
	NextRawOffset int                `json:"nextrawoffset"`
	HasMore       bool               `json:"hasmore"`
	Lines         []*LineType        `json:"lines"`
	Cmds          []*CmdType         `json:"cmds"`
}

type RemoteEditType struct {
	RemoteEdit  bool   `json:"remoteedit"`
	RemoteId    string `json:"remoteid,omitempty"`
	ErrorStr    string `json:"errorstr,omitempty"`
	InfoStr     string `json:"infostr,omitempty"`
	KeyStr      string `json:"keystr,omitempty"`
	HasPassword bool   `json:"haspassword,omitempty"`
}

type AlertMessageType struct {
	Title    string `json:"title,omitempty"`
	Message  string `json:"message"`
	Confirm  bool   `json:"confirm,omitempty"`
	Markdown bool   `json:"markdown,omitempty"`
}

type InfoMsgType struct {
	InfoTitle     string   `json:"infotitle"`
	InfoError     string   `json:"infoerror,omitempty"`
	InfoMsg       string   `json:"infomsg,omitempty"`
	InfoMsgHtml   bool     `json:"infomsghtml,omitempty"`
	WebShareLink  bool     `json:"websharelink,omitempty"`
	InfoComps     []string `json:"infocomps,omitempty"`
	InfoCompsMore bool     `json:"infocompssmore,omitempty"`
	InfoLines     []string `json:"infolines,omitempty"`
	TimeoutMs     int64    `json:"timeoutms,omitempty"`
}

type HistoryInfoType struct {
	HistoryType string             `json:"historytype"`
	SessionId   string             `json:"sessionid,omitempty"`
	ScreenId    string             `json:"screenid,omitempty"`
	Items       []*HistoryItemType `json:"items"`
	Show        bool               `json:"show"`
}

type UserInputRequestType struct {
	RequestId    string `json:"requestid"`
	QueryText    string `json:"querytext"`
	ResponseType string `json:"responsetype"`
	Title        string `json:"title"`
	Markdown     bool   `json:"markdown"`
	TimeoutMs    int    `json:"timeoutms"`
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

type ScreenStatusIndicatorType struct {
	ScreenId string               `json:"screenid"`
	Status   StatusIndicatorLevel `json:"status"`
}

type ScreenNumRunningCommandsType struct {
	ScreenId string `json:"screenid"`
	Num      int    `json:"num"`
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
	AddUpdate(update, (UserInputRequestUpdate)(*userInputRequest))
	bus.SendUpdate(update)
	log.Printf("test: %+v", userInputRequest)

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
