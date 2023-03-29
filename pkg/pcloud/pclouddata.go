package pcloud

import (
	"context"
	"fmt"

	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/rtnstate"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
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
	BVal     bool                `json:"bval,omitempty"`
	DoneInfo *sstore.CmdDoneInfo `json:"doneinfo,omitempty"`
	TermOpts *sstore.TermOpts    `json:"termopts,omitempty"`
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
	ScreenId  string `json:"screenid"`
	ShareName string `json:"sharename"`
	ViewKey   string `json:"viewkey"`
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
	return &WebShareScreenType{ScreenId: s.ScreenId, ShareName: shareName, ViewKey: s.WebShareOpts.ViewKey}, nil
}

type WebShareLineType struct {
	LineId   string `json:"lineid"`
	Ts       int64  `json:"ts"`
	LineNum  int64  `json:"linenum"`
	LineType string `json:"linetype"`
	Renderer string `json:"renderer,omitempty"`
	Text     string `json:"text,omitempty"`
	CmdId    string `json:"cmdid,omitempty"`
	Archived bool   `json:"archived,omitempty"`
}

func webLineFromLine(line *sstore.LineType) (*WebShareLineType, error) {
	rtn := &WebShareLineType{
		LineId:   line.LineId,
		Ts:       line.Ts,
		LineNum:  line.LineNum,
		LineType: line.LineType,
		Renderer: line.Renderer,
		Text:     line.Text,
		CmdId:    line.CmdId,
		Archived: line.Archived,
	}
	return rtn, nil
}

type WebShareCmdType struct {
	LineId      string                     `json:"lineid"`
	CmdStr      string                     `json:"cmdstr"`
	RawCmdStr   string                     `json:"rawcmdstr"`
	Remote      *WebShareRemote            `json:"remote"`
	FeState     sstore.FeStateType         `json:"festate"`
	TermOpts    sstore.TermOpts            `json:"termopts"`
	Status      string                     `json:"status"`
	StartPk     *packet.CmdStartPacketType `json:"startpk,omitempty"`
	DoneInfo    *sstore.CmdDoneInfo        `json:"doneinfo,omitempty"`
	RtnState    bool                       `json:"rtnstate,omitempty"`
	RtnStateStr string                     `json:"rtnstatestr,omitempty"`
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
		LineId:    lineId,
		CmdStr:    cmd.CmdStr,
		RawCmdStr: cmd.RawCmdStr,
		Remote:    webRemote,
		FeState:   cmd.FeState,
		TermOpts:  cmd.TermOpts,
		Status:    cmd.Status,
		StartPk:   cmd.StartPk,
		DoneInfo:  cmd.DoneInfo,
		RtnState:  cmd.RtnState,
	}
	if cmd.RtnState {
		barr, err := rtnstate.GetRtnStateDiff(context.Background(), cmd.ScreenId, cmd.CmdId)
		if err != nil {
			return nil, fmt.Errorf("error creating rtnstate diff for cmd:%s: %v", cmd.CmdId, err)
		}
		rtn.RtnStateStr = string(barr)
	}
	return rtn, nil
}

type WebSharePtyData struct {
	PtyPos int64  `json:"ptypos,omitempty"`
	Data   []byte `json:"data,omitempty"`
	Eof    bool   `json:"-"` // internal use
}
