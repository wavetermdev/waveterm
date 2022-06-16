package sstore

import (
	"time"

	"github.com/google/uuid"
)

var NextLineId = 10

const LineTypeCmd = "cmd"
const LineTypeText = "text"

type LineType struct {
	SessionId string `json:"sessionid"`
	WindowId  string `json:"windowid"`
	LineId    int    `json:"lineid"`
	Ts        int64  `json:"ts"`
	UserId    string `json:"userid"`
	LineType  string `json:"linetype"`
	Text      string `json:"text,omitempty"`
	CmdId     string `json:"cmdid,omitempty"`
	CmdText   string `json:"cmdtext,omitempty"`
	CmdRemote string `json:"cmdremote,omitempty"`
}

func MakeNewLineCmd(sessionId string, windowId string, cmdText string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.LineId = NextLineId
	NextLineId++
	rtn.Ts = time.Now().UnixMilli()
	rtn.UserId = "mike"
	rtn.LineType = LineTypeCmd
	rtn.CmdId = uuid.New().String()
	rtn.CmdText = cmdText
	return rtn
}

func MakeNewLineText(sessionId string, windowId string, text string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.LineId = NextLineId
	NextLineId++
	rtn.Ts = time.Now().UnixMilli()
	rtn.UserId = "mike"
	rtn.LineType = LineTypeText
	rtn.Text = text
	return rtn
}
