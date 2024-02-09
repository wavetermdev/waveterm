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

func AddCmdLineUpdate(update *ModelUpdate, cmdLine utilfn.StrWithPos) {
	AddUpdate(update, CmdLineUpdate(cmdLine))
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

// only sets InfoError if InfoError is not already set
func AddInfoMsgUpdateError(update *ModelUpdate, errStr string) {
	infoUpdates := GetUpdateItems[InfoMsgType](update)

	if len(infoUpdates) > 0 {
		lastUpdate := infoUpdates[len(infoUpdates)-1]
		if lastUpdate.InfoError == "" {
			lastUpdate.InfoError = errStr
			return
		}
	} else {
		AddUpdate(update, InfoMsgType{InfoError: errStr})
	}
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

func AddInteractiveUpdate(update *ModelUpdate, interactive bool) {
	AddUpdate(update, InteractiveUpdate(interactive))
}

type ConnectUpdate struct {
	Sessions                 []*SessionType                  `json:"sessions,omitempty"`
	Screens                  []*ScreenType                   `json:"screens,omitempty"`
	Remotes                  []*RemoteRuntimeState           `json:"remotes,omitempty"`
	ScreenStatusIndicators   []*ScreenStatusIndicatorType    `json:"screenstatusindicators,omitempty"`
	ScreenNumRunningCommands []*ScreenNumRunningCommandsType `json:"screennumrunningcommands,omitempty"`
	ActiveSessionId          string                          `json:"activesessionid,omitempty"`
}

func (ConnectUpdate) UpdateType() string {
	return "connect"
}

type MainViewUpdate struct {
	MainView      string           `json:"mainview"`
	HistoryView   *HistoryViewData `json:"historyview,omitempty"`
	BookmarksView *BookmarksUpdate `json:"bookmarksview,omitempty"`
}

func (MainViewUpdate) UpdateType() string {
	return "mainview"
}

type BookmarksUpdate struct {
	Bookmarks        []*BookmarkType `json:"bookmarks"`
	SelectedBookmark string          `json:"selectedbookmark,omitempty"`
}

func (BookmarksUpdate) UpdateType() string {
	return "bookmarks"
}

func AddBookmarksUpdate(update *ModelUpdate, bookmarks []*BookmarkType, selectedBookmark *string) {
	if selectedBookmark == nil {
		AddUpdate(update, BookmarksUpdate{Bookmarks: bookmarks})
	} else {
		AddUpdate(update, BookmarksUpdate{Bookmarks: bookmarks, SelectedBookmark: *selectedBookmark})
	}
}

type SelectedBookmarkUpdate string

func (SelectedBookmarkUpdate) UpdateType() string {
	return "selectedbookmark"
}

func AddSelectedBookmarkUpdate(update *ModelUpdate, selectedBookmark string) {
	AddUpdate(update, SelectedBookmarkUpdate(selectedBookmark))
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

func AddOpenAICmdInfoChatUpdate(update *ModelUpdate, chatMessages []*packet.OpenAICmdInfoChatMessage) {
	AddUpdate(update, OpenAICmdInfoChatUpdate(chatMessages))
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
