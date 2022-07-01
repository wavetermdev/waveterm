package sstore

import (
	"path"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
)

var NextLineId = 10
var NextLineLock = &sync.Mutex{}

const LineTypeCmd = "cmd"
const LineTypeText = "text"
const DBFileName = "scripthaus.db"

func GetSessionDBName(sessionId string) string {
	scHome := scbase.GetScHomeDir()
	return path.Join(scHome, DBFileName)
}

type SessionType struct {
	SessionId string `json:"sessionid"`
	Remote    string `json:"remote"`
	Cwd       string `json:"cwd"`
}

type WindowType struct {
	SessionId string `json:"sessionid"`
	WindowId  string `json:"windowid"`
}

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
	CmdCwd    string `json:"cmdcwd,omitempty"`
}

func MakeNewLineCmd(sessionId string, windowId string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.LineId = GetNextLine()
	rtn.Ts = time.Now().UnixMilli()
	rtn.UserId = "mike"
	rtn.LineType = LineTypeCmd
	rtn.CmdId = uuid.New().String()
	return rtn
}

func MakeNewLineText(sessionId string, windowId string, text string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.LineId = GetNextLine()
	rtn.Ts = time.Now().UnixMilli()
	rtn.UserId = "mike"
	rtn.LineType = LineTypeText
	rtn.Text = text
	return rtn
}

func GetNextLine() int {
	NextLineLock.Lock()
	defer NextLineLock.Unlock()
	rtn := NextLineId
	NextLineId++
	return rtn
}
