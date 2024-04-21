// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sstore

import (
	"fmt"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/configstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
)

type ActiveSessionIdUpdate string

func (ActiveSessionIdUpdate) GetType() string {
	return "activesessionid"
}

type LineUpdate struct {
	Line LineType `json:"line"`
	Cmd  CmdType  `json:"cmd,omitempty"`
}

func (LineUpdate) GetType() string {
	return "line"
}

func AddLineUpdate(update *scbus.ModelUpdatePacketType, newLine *LineType, newCmd *CmdType) {
	if newLine == nil {
		return
	}
	newLineUpdate := LineUpdate{
		Line: *newLine,
	}
	if newCmd != nil {
		newLineUpdate.Cmd = *newCmd
	}
	update.AddUpdate(newLineUpdate)
}

type CmdLineUpdate utilfn.StrWithPos

func (CmdLineUpdate) GetType() string {
	return "cmdline"
}

type InfoMsgType struct {
	InfoTitle     string   `json:"infotitle"`
	InfoError     string   `json:"infoerror,omitempty"`
	InfoErrorCode string   `json:"infoerrorcode,omitempty"`
	InfoMsg       string   `json:"infomsg,omitempty"`
	InfoMsgHtml   bool     `json:"infomsghtml,omitempty"`
	WebShareLink  bool     `json:"websharelink,omitempty"`
	InfoComps     []string `json:"infocomps,omitempty"`
	InfoCompsMore bool     `json:"infocompssmore,omitempty"`
	InfoLines     []string `json:"infolines,omitempty"`
	TimeoutMs     int64    `json:"timeoutms,omitempty"`
}

func (InfoMsgType) GetType() string {
	return "info"
}

func InfoMsgUpdate(infoMsgFmt string, args ...interface{}) *scbus.ModelUpdatePacketType {
	msg := fmt.Sprintf(infoMsgFmt, args...)
	ret := scbus.MakeUpdatePacket()
	newInfoUpdate := InfoMsgType{InfoMsg: msg}
	ret.AddUpdate(newInfoUpdate)
	return ret
}

// only sets InfoError if InfoError is not already set
func AddInfoMsgUpdateError(update *scbus.ModelUpdatePacketType, errStr string) {
	infoUpdates := scbus.GetUpdateItems[InfoMsgType](update)

	if len(infoUpdates) > 0 {
		lastUpdate := infoUpdates[len(infoUpdates)-1]
		if lastUpdate.InfoError == "" {
			lastUpdate.InfoError = errStr
			return
		}
	} else {
		update.AddUpdate(InfoMsgType{InfoError: errStr})
	}
}

type ClearInfoUpdate bool

func (ClearInfoUpdate) GetType() string {
	return "clearinfo"
}

type InteractiveUpdate bool

func (InteractiveUpdate) GetType() string {
	return "interactive"
}

type ConnectUpdate struct {
	Sessions                 []*SessionType                  `json:"sessions,omitempty"`
	Screens                  []*ScreenType                   `json:"screens,omitempty"`
	Remotes                  []*RemoteRuntimeState           `json:"remotes,omitempty"`
	ScreenStatusIndicators   []*ScreenStatusIndicatorType    `json:"screenstatusindicators,omitempty"`
	ScreenNumRunningCommands []*ScreenNumRunningCommandsType `json:"screennumrunningcommands,omitempty"`
	ActiveSessionId          string                          `json:"activesessionid,omitempty"`
	TermThemes               *configstore.TermThemesType     `json:"termthemes,omitempty"`
}

func (ConnectUpdate) GetType() string {
	return "connect"
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

func (RemoteViewType) GetType() string {
	return "remoteview"
}

type OpenAICmdInfoChatUpdate []*packet.OpenAICmdInfoChatMessage

func (OpenAICmdInfoChatUpdate) GetType() string {
	return "openaicmdinfochat"
}

type AlertMessageType struct {
	Title    string `json:"title,omitempty"`
	Message  string `json:"message"`
	Confirm  bool   `json:"confirm,omitempty"`
	Markdown bool   `json:"markdown,omitempty"`
}

func (AlertMessageType) GetType() string {
	return "alertmessage"
}

type ScreenStatusIndicatorType struct {
	ScreenId string               `json:"screenid"`
	Status   StatusIndicatorLevel `json:"status"`
}

func (ScreenStatusIndicatorType) GetType() string {
	return "screenstatusindicator"
}

type ScreenNumRunningCommandsType struct {
	ScreenId string `json:"screenid"`
	Num      int    `json:"num"`
}

func (ScreenNumRunningCommandsType) GetType() string {
	return "screennumrunningcommands"
}
