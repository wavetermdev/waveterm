package pcloud

import (
	"fmt"

	"github.com/scripthaus-dev/mshell/pkg/packet"
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
	UpdateType string `json:"updatetype"`

	Screen   *WebShareScreenType `json:"screen,omitempty"`
	Line     *WebShareLineType   `json:"line,omitempty"`
	Cmd      *WebShareCmdType    `json:"cmd,omitempty"`
	PtyData  *WebSharePtyData    `json:"ptydata,omitempty"`
	SVal     string              `json:"sval,omitempty"`
	BVal     bool                `json:"bval,omitempty"`
	DoneInfo *sstore.CmdDoneInfo `json:"doneinfo,omitempty"`
}

type WebShareRemotePtr struct {
	Alias         string `json:"remotealias,omitempty"`
	CanonicalName string `json:"remotecanonicalname"`
	Name          string `json:"name,omitempty"`
}

type WebShareScreenType struct {
	ScreenId  string `json:"screenid"`
	ShareName string `json:"sharename"`
	ViewKey   string `json:"viewkey"`
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
	if s.WebShareOpts.ShareName == "" {
		return nil, fmt.Errorf("invalid screen, no ShareName")
	}
	return &WebShareScreenType{ScreenId: s.ScreenId, ShareName: s.WebShareOpts.ShareName, ViewKey: s.WebShareOpts.ViewKey}, nil
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
	return nil, nil
}

type WebShareCmdType struct {
	LineId      string                     `json:"lineid"`
	CmdStr      string                     `json:"cmdstr"`
	RawCmdStr   string                     `json:"rawcmdstr"`
	Remote      WebShareRemotePtr          `json:"remote"`
	FeState     sstore.FeStateType         `json:"festate"`
	TermOpts    sstore.TermOpts            `json:"termopts"`
	Status      string                     `json:"status"`
	StartPk     *packet.CmdStartPacketType `json:"startpk,omitempty"`
	DoneInfo    *sstore.CmdDoneInfo        `json:"doneinfo,omitempty"`
	RtnState    bool                       `json:"rtnstate,omitempty"`
	RtnStateStr string                     `json:"rtnstatestr,omitempty"`
}

func webCmdFromCmd(cmd *sstore.CmdType) (*WebShareCmdType, error) {
	return nil, nil
}

type WebSharePtyData struct {
	PtyPos int64  `json:"ptypos,omitempty"`
	Data   []byte `json:"data,omitempty"`
}
