package sstore

import "sync"

var MainBus *UpdateBus = MakeUpdateBus()

const PtyDataUpdateStr = "pty"
const SessionUpdateStr = "session"
const WindowUpdateStr = "window"
const CmdUpdateStr = "cmd"
const LineCmdUpdateStr = "line+cmd"

type UpdatePacket interface {
	UpdateType() string
}

type UpdateCmd struct {
	CmdId  string
	Status string
}

type PtyDataUpdate struct {
	SessionId  string `json:"sessionid"`
	CmdId      string `json:"cmdid"`
	PtyPos     int64  `json:"ptypos"`
	PtyData64  string `json:"ptydata64"`
	PtyDataLen int64  `json:"ptydatalen"`
}

func (PtyDataUpdate) UpdateType() string {
	return PtyDataUpdateStr
}

type WindowUpdate struct {
	Window WindowType `json:"window"`
	Remove bool       `json:"remove,omitempty"`
}

func (WindowUpdate) WindowUpdate() string {
	return WindowUpdateStr
}

type SessionUpdate struct {
	Sessions []*SessionType `json:"sessions"`
}

func (SessionUpdate) UpdateType() string {
	return SessionUpdateStr
}

func MakeSingleSessionUpdate(sessionId string) (*SessionUpdate, *SessionType) {
	session := &SessionType{
		SessionId: sessionId,
		NotifyNum: -1,
	}
	update := &SessionUpdate{
		Sessions: []*SessionType{session},
	}
	return update, session
}

type LineUpdate struct {
	Line   *LineType `json:"line"`
	Cmd    *CmdType  `json:"cmd,omitempty"`
	Remove bool      `json:"remove,omitempty"`
}

func (LineUpdate) UpdateType() string {
	return LineCmdUpdateStr
}

type UpdateChannel struct {
	SessionId string
	ClientId  string
	Ch        chan interface{}
}

func (uch UpdateChannel) Match(sessionId string) bool {
	if sessionId == "" {
		return true
	}
	return sessionId == uch.SessionId
}

type UpdateBus struct {
	Lock     *sync.Mutex
	Channels map[string]UpdateChannel
}

func MakeUpdateBus() *UpdateBus {
	return &UpdateBus{
		Lock:     &sync.Mutex{},
		Channels: make(map[string]UpdateChannel),
	}
}

func (bus *UpdateBus) RegisterChannel(clientId string, sessionId string) chan interface{} {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	uch, found := bus.Channels[clientId]
	if found {
		close(uch.Ch)
		uch.SessionId = sessionId
		uch.Ch = make(chan interface{})
	} else {
		uch = UpdateChannel{
			ClientId:  clientId,
			SessionId: sessionId,
			Ch:        make(chan interface{}),
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

func (bus *UpdateBus) SendUpdate(sessionId string, update interface{}) {
	bus.Lock.Lock()
	defer bus.Lock.Unlock()
	for _, uch := range bus.Channels {
		if uch.Match(sessionId) {
			uch.Ch <- update
		}
	}
}
