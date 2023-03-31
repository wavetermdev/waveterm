package sstore

import (
	"fmt"
	"log"
	"sync"
)

var MainBus *UpdateBus = MakeUpdateBus()

const PtyDataUpdateStr = "pty"
const ModelUpdateStr = "model"
const UpdateChSize = 100

type UpdatePacket interface {
	UpdateType() string
}

type PtyDataUpdate struct {
	ScreenId   string `json:"screenid,omitempty"`
	CmdId      string `json:"cmdid,omitempty"`
	RemoteId   string `json:"remoteid,omitempty"`
	PtyPos     int64  `json:"ptypos"`
	PtyData64  string `json:"ptydata64"`
	PtyDataLen int64  `json:"ptydatalen"`
}

func (PtyDataUpdate) UpdateType() string {
	return PtyDataUpdateStr
}

type ModelUpdate struct {
	Sessions         []*SessionType   `json:"sessions,omitempty"`
	ActiveSessionId  string           `json:"activesessionid,omitempty"`
	Screens          []*ScreenType    `json:"screens,omitempty"`
	ScreenLines      *ScreenLinesType `json:"screenlines,omitempty"`
	Line             *LineType        `json:"line,omitempty"`
	Lines            []*LineType      `json:"lines,omitempty"`
	Cmd              *CmdType         `json:"cmd,omitempty"`
	CmdLine          *CmdLineType     `json:"cmdline,omitempty"`
	Info             *InfoMsgType     `json:"info,omitempty"`
	ClearInfo        bool             `json:"clearinfo,omitempty"`
	Remotes          []interface{}    `json:"remotes,omitempty"` // []*remote.RemoteState
	History          *HistoryInfoType `json:"history,omitempty"`
	Interactive      bool             `json:"interactive"`
	Connect          bool             `json:"connect,omitempty"`
	MainView         string           `json:"mainview,omitempty"`
	Bookmarks        []*BookmarkType  `json:"bookmarks,omitempty"`
	SelectedBookmark string           `json:"selectedbookmark,omitempty"`
	HistoryViewData  *HistoryViewData `json:"historyviewdata,omitempty"`
	ClientData       *ClientData      `json:"clientdata,omitempty"`
}

func (ModelUpdate) UpdateType() string {
	return ModelUpdateStr
}

func ReadHistoryDataFromUpdate(update UpdatePacket) (string, string, *RemotePtrType) {
	modelUpdate, ok := update.(ModelUpdate)
	if !ok {
		return "", "", nil
	}
	if modelUpdate.Line == nil {
		return "", "", nil
	}
	var rptr *RemotePtrType
	if modelUpdate.Cmd != nil {
		rptr = &modelUpdate.Cmd.Remote
	}
	return modelUpdate.Line.LineId, modelUpdate.Line.CmdId, rptr
}

func InfoMsgUpdate(infoMsgFmt string, args ...interface{}) *ModelUpdate {
	msg := fmt.Sprintf(infoMsgFmt, args...)
	return &ModelUpdate{
		Info: &InfoMsgType{InfoMsg: msg},
	}
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

type InfoMsgType struct {
	InfoTitle     string          `json:"infotitle"`
	InfoError     string          `json:"infoerror,omitempty"`
	InfoMsg       string          `json:"infomsg,omitempty"`
	InfoMsgHtml   bool            `json:"infomsghtml,omitempty"`
	WebShareLink  bool            `json:"websharelink,omitempty"`
	InfoComps     []string        `json:"infocomps,omitempty"`
	InfoCompsMore bool            `json:"infocompssmore,omitempty"`
	InfoLines     []string        `json:"infolines,omitempty"`
	TimeoutMs     int64           `json:"timeoutms,omitempty"`
	PtyRemoteId   string          `json:"ptyremoteid,omitempty"`
	RemoteShowAll bool            `json:"remoteshowall,omitempty"`
	RemoteEdit    *RemoteEditType `json:"remoteedit,omitempty"`
}

type HistoryInfoType struct {
	HistoryType string             `json:"historytype"`
	SessionId   string             `json:"sessionid,omitempty"`
	ScreenId    string             `json:"screenid,omitempty"`
	Items       []*HistoryItemType `json:"items"`
	Show        bool               `json:"show"`
}

type CmdLineType struct {
	CmdLine   string `json:"cmdline"`
	CursorPos int    `json:"cursorpos"`
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
	Lock     *sync.Mutex
	Channels map[string]UpdateChannel
}

func MakeUpdateBus() *UpdateBus {
	return &UpdateBus{
		Lock:     &sync.Mutex{},
		Channels: make(map[string]UpdateChannel),
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

func (bus *UpdateBus) SendUpdate(update interface{}) {
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

func (bus *UpdateBus) SendScreenUpdate(screenId string, update interface{}) {
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

func MakeSessionsUpdateForRemote(sessionId string, ri *RemoteInstance) []*SessionType {
	return []*SessionType{
		&SessionType{
			SessionId: sessionId,
			Remotes:   []*RemoteInstance{ri},
		},
	}
}

type BookmarksViewType struct {
	Bookmarks []*BookmarkType `json:"bookmarks"`
}
