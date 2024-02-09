package sstore

import (
	"fmt"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

type ActiveSessionIdUpdate string

func (ActiveSessionIdUpdate) UpdateType() string {
	return "activesessionid"
}

type LineUpdate struct {
	Line LineType `json:"line"`
	Cmd  CmdType  `json:"cmd,omitempty"`
}

func (LineUpdate) UpdateType() string {
	return "line"
}

func AddLineUpdate(update *ModelUpdate, newLine *LineType, newCmd *CmdType) {
	if newLine == nil {
		return
	}
	newLineUpdate := LineUpdate{
		Line: *newLine,
	}
	if newCmd != nil {
		newLineUpdate.Cmd = *newCmd
	}
	AddUpdate(update, newLineUpdate)
}

type CmdLineUpdate utilfn.StrWithPos

func (CmdLineUpdate) UpdateType() string {
	return "cmdline"
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

func (InfoMsgType) UpdateType() string {
	return "info"
}

func InfoMsgUpdate(infoMsgFmt string, args ...interface{}) *ModelUpdate {
	msg := fmt.Sprintf(infoMsgFmt, args...)
	ret := &ModelUpdate{}
	newInfoUpdate := InfoMsgType{InfoMsg: msg}
	AddUpdate(ret, newInfoUpdate)
	return ret
}

type ClearInfoUpdate bool

func (ClearInfoUpdate) UpdateType() string {
	return "clearinfo"
}

type HistoryInfoType struct {
	HistoryType string             `json:"historytype"`
	SessionId   string             `json:"sessionid,omitempty"`
	ScreenId    string             `json:"screenid,omitempty"`
	Items       []*HistoryItemType `json:"items"`
	Show        bool               `json:"show"`
}

func (HistoryInfoType) UpdateType() string {
	return "history"
}

type InteractiveUpdate bool

func (InteractiveUpdate) UpdateType() string {
	return "interactive"
}

type ConnectUpdate bool

func (ConnectUpdate) UpdateType() string {
	return "connect"
}

type MainViewUpdate string

func (MainViewUpdate) UpdateType() string {
	return "mainview"
}

type BookmarksUpdate []*BookmarkType

func (BookmarksUpdate) UpdateType() string {
	return "bookmarks"
}

type SelectedBookmarkUpdate string

func (SelectedBookmarkUpdate) UpdateType() string {
	return "selectedbookmark"
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

func (HistoryViewData) UpdateType() string {
	return "historyviewdata"
}

type RemoteEditType struct {
	RemoteEdit  bool   `json:"remoteedit"`
	RemoteId    string `json:"remoteid,omitempty"`
	ErrorStr    string `json:"errorstr,omitempty"`
	InfoStr     string `json:"infostr,omitempty"`
	KeyStr      string `json:"keystr,omitempty"`
	HasPassword bool   `json:"haspassword,omitempty"`
}

type RemoteViewType struct {
	RemoteShowAll bool            `json:"remoteshowall,omitempty"`
	PtyRemoteId   string          `json:"ptyremoteid,omitempty"`
	RemoteEdit    *RemoteEditType `json:"remoteedit,omitempty"`
}

func (RemoteViewType) UpdateType() string {
	return "remoteview"
}

type OpenAICmdInfoChatUpdate []*packet.OpenAICmdInfoChatMessage

func (OpenAICmdInfoChatUpdate) UpdateType() string {
	return "openaicmdinfochat"
}

type AlertMessageType struct {
	Title    string `json:"title,omitempty"`
	Message  string `json:"message"`
	Confirm  bool   `json:"confirm,omitempty"`
	Markdown bool   `json:"markdown,omitempty"`
}

func (AlertMessageType) UpdateType() string {
	return "alertmessage"
}

type ScreenStatusIndicatorType struct {
	ScreenId string               `json:"screenid"`
	Status   StatusIndicatorLevel `json:"status"`
}

func (ScreenStatusIndicatorType) UpdateType() string {
	return "screenstatusindicator"
}

type ScreenNumRunningCommandsType struct {
	ScreenId string `json:"screenid"`
	Num      int    `json:"num"`
}

func (ScreenNumRunningCommandsType) UpdateType() string {
	return "screennumrunningcommands"
}

type UserInputRequestType struct {
	RequestId    string `json:"requestid"`
	QueryText    string `json:"querytext"`
	ResponseType string `json:"responsetype"`
	Title        string `json:"title"`
	Markdown     bool   `json:"markdown"`
	TimeoutMs    int    `json:"timeoutms"`
}

func (UserInputRequestType) UpdateType() string {
	return "userinputrequest"
}
