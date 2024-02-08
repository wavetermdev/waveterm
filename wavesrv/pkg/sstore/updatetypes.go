package sstore

import (
	"fmt"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

type ScreenUpdate ScreenType

func (ScreenUpdate) UpdateType() string {
	return "screen"
}

func AddScreenUpdate(update *ModelUpdate, newScreen *ScreenType) {
	if newScreen == nil {
		return
	}
	newScreenUpdate := (*ScreenUpdate)(newScreen)
	screenUpdates := GetUpdateItems[ScreenUpdate](update)
	for _, screenUpdate := range screenUpdates {
		if screenUpdate.ScreenId == newScreen.ScreenId {
			screenUpdate = newScreenUpdate
			return
		}
	}
	AddUpdate[ScreenUpdate](update, *newScreenUpdate)
}

type SessionUpdate SessionType

func (SessionUpdate) UpdateType() string {
	return "session"
}

func MakeSessionUpdateForRemote(sessionId string, ri *RemoteInstance) SessionUpdate {
	return SessionUpdate{
		SessionId: sessionId,
		Remotes:   []*RemoteInstance{ri},
	}
}

type ActiveSessionIdUpdate string

func (ActiveSessionIdUpdate) UpdateType() string {
	return "activesessionid"
}

type ScreenLinesUpdate ScreenLinesType

func (ScreenLinesUpdate) UpdateType() string {
	return "screenlines"
}

type LineUpdate LineType

func (LineUpdate) UpdateType() string {
	return "line"
}

type CmdUpdate CmdType

func (CmdUpdate) UpdateType() string {
	return "cmd"
}

type CmdLineUpdate utilfn.StrWithPos

func (CmdLineUpdate) UpdateType() string {
	return "cmdline"
}

type InfoUpdate InfoMsgType

func (InfoUpdate) UpdateType() string {
	return "info"
}

func InfoMsgUpdate(infoMsgFmt string, args ...interface{}) *ModelUpdate {
	msg := fmt.Sprintf(infoMsgFmt, args...)
	ret := &ModelUpdate{}
	newInfoUpdate := InfoUpdate{InfoMsg: msg}
	AddUpdate[InfoUpdate](ret, newInfoUpdate)
	return ret
}

type ClearInfoUpdate bool

func (ClearInfoUpdate) UpdateType() string {
	return "clearinfo"
}

type RemoteUpdate RemoteRuntimeState

func (RemoteUpdate) UpdateType() string {
	return "remote"
}

type HistoryUpdate HistoryInfoType

func (HistoryUpdate) UpdateType() string {
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

type BookmarkUpdate BookmarkType

func (BookmarkUpdate) UpdateType() string {
	return "bookmark"
}

type SelectedBookmarkUpdate string

func (SelectedBookmarkUpdate) UpdateType() string {
	return "selectedbookmark"
}

type HistoryViewDataUpdate HistoryViewData

func (HistoryViewDataUpdate) UpdateType() string {
	return "historyviewdata"
}

type ClientDataUpdate ClientData

func (ClientDataUpdate) UpdateType() string {
	return "clientdata"
}

type RemoteViewUpdate RemoteViewType

func (RemoteViewUpdate) UpdateType() string {
	return "remoteview"
}

type ScreenTombstoneUpdate ScreenTombstoneType

func (ScreenTombstoneUpdate) UpdateType() string {
	return "screentombstone"
}

type SessionTombstoneUpdate SessionTombstoneType

func (SessionTombstoneUpdate) UpdateType() string {
	return "sessiontombstone"
}

type OpenAICmdInfoChatUpdate []*packet.OpenAICmdInfoChatMessage

func (OpenAICmdInfoChatUpdate) UpdateType() string {
	return "openaicmdinfochat"
}

type AlertMessageUpdate AlertMessageType

func (AlertMessageUpdate) UpdateType() string {
	return "alertmessage"
}

type ScreenStatusIndicatorUpdate ScreenStatusIndicatorType

func (ScreenStatusIndicatorUpdate) UpdateType() string {
	return "screenstatusindicator"
}

type ScreenNumRunningCommandsUpdate ScreenNumRunningCommandsType

func (ScreenNumRunningCommandsUpdate) UpdateType() string {
	return "screennumrunningcommands"
}
