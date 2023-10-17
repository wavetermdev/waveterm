// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pcloud

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/remote"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/rtnstate"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

type NoTelemetryInputType struct {
	ClientId string `json:"clientid"`
	Value    bool   `json:"value"`
}

type TelemetryInputType struct {
	UserId   string                 `json:"userid"`
	ClientId string                 `json:"clientid"`
	CurDay   string                 `json:"curday"`
	Activity []*sstore.ActivityType `json:"activity"`
}

type WebShareUpdateType struct {
	ScreenId   string `json:"screenid"`
	LineId     string `json:"lineid"`
	UpdateId   int64  `json:"updateid"`
	UpdateType string `json:"updatetype"`
	UpdateTs   int64  `json:"updatets"`

	Screen   *WebShareScreenType `json:"screen,omitempty"`
	Line     *WebShareLineType   `json:"line,omitempty"`
	Cmd      *WebShareCmdType    `json:"cmd,omitempty"`
	PtyData  *WebSharePtyData    `json:"ptydata,omitempty"`
	SVal     string              `json:"sval,omitempty"`
	IVal     int64               `json:"ival,omitempty"`
	BVal     bool                `json:"bval,omitempty"`
	TermOpts *sstore.TermOpts    `json:"termopts,omitempty"`
}

const EstimatedSizePadding = 100

func (update *WebShareUpdateType) GetEstimatedSize() int {
	barr, _ := json.Marshal(update)
	return len(barr) + 100
}

func (update *WebShareUpdateType) String() string {
	var idStr string
	if update.LineId != "" && update.ScreenId != "" {
		idStr = fmt.Sprintf("%s:%s", update.ScreenId[0:8], update.LineId[0:8])
	} else if update.ScreenId != "" {
		idStr = update.ScreenId[0:8]
	}
	if update.UpdateType == sstore.UpdateType_PtyPos && update.PtyData != nil {
		return fmt.Sprintf("ptydata[%s][%d:%d]", idStr, update.PtyData.PtyPos, len(update.PtyData.Data))
	}
	return fmt.Sprintf("%s[%s]", update.UpdateType, idStr)
}

type WebShareUpdateResponseType struct {
	UpdateId int64  `json:"updateid"`
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
}

func (ur *WebShareUpdateResponseType) GetSimpleKey() int64 {
	return ur.UpdateId
}

type WebShareRemote struct {
	RemoteId      string `json:"remoteid"`
	Alias         string `json:"alias,omitempty"`
	CanonicalName string `json:"canonicalname"`
	Name          string `json:"name,omitempty"`
	HomeDir       string `json:"homedir,omitempty"`
	IsRoot        bool   `json:"isroot,omitempty"`
}

type WebShareScreenType struct {
	ScreenId     string `json:"screenid"`
	ShareName    string `json:"sharename"`
	ViewKey      string `json:"viewkey"`
	SelectedLine int    `json:"selectedline"`
}

func webRemoteFromRemote(rptr sstore.RemotePtrType, r *sstore.RemoteType) *WebShareRemote {
	return &WebShareRemote{
		RemoteId:      r.RemoteId,
		Alias:         r.RemoteAlias,
		CanonicalName: r.RemoteCanonicalName,
		Name:          rptr.Name,
		HomeDir:       r.StateVars["home"],
		IsRoot:        r.StateVars["remoteuser"] == "root",
	}
}

func webScreenFromScreen(s *sstore.ScreenType) (*WebShareScreenType, error) {
	if s == nil || s.ScreenId == "" {
		return nil, fmt.Errorf("invalid nil screen")
	}
	if s.WebShareOpts == nil {
		return nil, fmt.Errorf("invalid screen, no WebShareOpts")
	}
	if s.WebShareOpts.ViewKey == "" {
		return nil, fmt.Errorf("invalid screen, no ViewKey")
	}
	var shareName string
	if s.WebShareOpts.ShareName != "" {
		shareName = s.WebShareOpts.ShareName
	} else {
		shareName = s.Name
	}
	return &WebShareScreenType{ScreenId: s.ScreenId, ShareName: shareName, ViewKey: s.WebShareOpts.ViewKey, SelectedLine: int(s.SelectedLine)}, nil
}

type WebShareLineType struct {
	LineId        string `json:"lineid"`
	Ts            int64  `json:"ts"`
	LineNum       int64  `json:"linenum"`
	LineType      string `json:"linetype"`
	ContentHeight int64  `json:"contentheight"`
	Renderer      string `json:"renderer,omitempty"`
	Text          string `json:"text,omitempty"`
}

func webLineFromLine(line *sstore.LineType) (*WebShareLineType, error) {
	rtn := &WebShareLineType{
		LineId:        line.LineId,
		Ts:            line.Ts,
		LineNum:       line.LineNum,
		LineType:      line.LineType,
		ContentHeight: line.ContentHeight,
		Renderer:      line.Renderer,
		Text:          line.Text,
	}
	return rtn, nil
}

type WebShareCmdType struct {
	LineId      string             `json:"lineid"`
	CmdStr      string             `json:"cmdstr"`
	RawCmdStr   string             `json:"rawcmdstr"`
	Remote      *WebShareRemote    `json:"remote"`
	FeState     sstore.FeStateType `json:"festate"`
	TermOpts    sstore.TermOpts    `json:"termopts"`
	Status      string             `json:"status"`
	CmdPid      int                `json:"cmdpid"`
	RemotePid   int                `json:"remotepid"`
	DoneTs      int64              `json:"donets,omitempty"`
	ExitCode    int                `json:"exitcode,omitempty"`
	DurationMs  int                `json:"durationms,omitempty"`
	RtnState    bool               `json:"rtnstate,omitempty"`
	RtnStateStr string             `json:"rtnstatestr,omitempty"`
}

func webCmdFromCmd(lineId string, cmd *sstore.CmdType) (*WebShareCmdType, error) {
	if cmd.Remote.RemoteId == "" {
		return nil, fmt.Errorf("invalid cmd, remoteptr has no remoteid")
	}
	remote := remote.GetRemoteCopyById(cmd.Remote.RemoteId)
	if remote == nil {
		return nil, fmt.Errorf("invalid cmd, cannot retrieve remote:%s", cmd.Remote.RemoteId)
	}
	webRemote := webRemoteFromRemote(cmd.Remote, remote)
	rtn := &WebShareCmdType{
		LineId:     lineId,
		CmdStr:     cmd.CmdStr,
		RawCmdStr:  cmd.RawCmdStr,
		Remote:     webRemote,
		FeState:    cmd.FeState,
		TermOpts:   cmd.TermOpts,
		Status:     cmd.Status,
		CmdPid:     cmd.CmdPid,
		RemotePid:  cmd.RemotePid,
		DoneTs:     cmd.DoneTs,
		ExitCode:   cmd.ExitCode,
		DurationMs: cmd.DurationMs,
		RtnState:   cmd.RtnState,
	}
	if cmd.RtnState {
		barr, err := rtnstate.GetRtnStateDiff(context.Background(), cmd.ScreenId, cmd.LineId)
		if err != nil {
			return nil, fmt.Errorf("error creating rtnstate diff for cmd:%s: %v", cmd.LineId, err)
		}
		rtn.RtnStateStr = string(barr)
	}
	return rtn, nil
}

type WebSharePtyData struct {
	PtyPos int64  `json:"ptypos"`
	Data   []byte `json:"data"`
	Eof    bool   `json:"-"` // internal use
}
