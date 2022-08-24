package sstore

import "sync"

var MainBus *UpdateBus = MakeUpdateBus()

const PtyDataUpdateStr = "pty"
const ModelUpdateStr = "model"

type UpdatePacket interface {
	UpdateType() string
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

type ModelUpdate struct {
	Sessions        []*SessionType `json:"sessions"`
	ActiveSessionId string         `json:"activesessionid,omitempty"`
	Window          WindowType     `json:"window"`
	Line            *LineType      `json:"line"`
	Cmd             *CmdType       `json:"cmd,omitempty"`
	CmdLine         *CmdLineType   `json:"cmdline,omitempty"`
	Info            *InfoMsgType   `json:"info,omitempty"`
}

func (ModelUpdate) UpdateType() string {
	return ModelUpdateStr
}

func MakeSingleSessionUpdate(sessionId string) (ModelUpdate, *SessionType) {
	session := &SessionType{
		SessionId: sessionId,
		NotifyNum: -1,
	}
	update := ModelUpdate{
		Sessions: []*SessionType{session},
	}
	return update, session
}

func ReadLineCmdIdFromUpdate(update UpdatePacket) (string, string) {
	modelUpdate, ok := update.(ModelUpdate)
	if !ok {
		return "", ""
	}
	if modelUpdate.Line == nil {
		return "", ""
	}
	return modelUpdate.Line.LineId, modelUpdate.Line.CmdId
}

type InfoMsgType struct {
	InfoTitle     string   `json:"infotitle"`
	InfoError     string   `json:"infoerror,omitempty"`
	InfoMsg       string   `json:"infomsg,omitempty"`
	InfoComps     []string `json:"infocomps,omitempty"`
	InfoCompsMore bool     `json:"infocompssmore,omitempty"`
	InfoLines     []string `json:"infolines,omitempty"`
	TimeoutMs     int64    `json:"timeoutms,omitempty"`
}

type CmdLineType struct {
	InsertChars string `json:"insertchars"`
	InsertPos   int64  `json:"insertpos"`
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

func MakeSessionsUpdateForRemote(sessionId string, ri *RemoteInstance) []*SessionType {
	return []*SessionType{
		&SessionType{
			SessionId: sessionId,
			Remotes:   []*RemoteInstance{ri},
		},
	}
}
