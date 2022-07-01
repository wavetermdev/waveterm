package sstore

import (
	"path"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"

	_ "github.com/mattn/go-sqlite3"
)

var NextLineId = 10
var NextLineLock = &sync.Mutex{}

const LineTypeCmd = "cmd"
const LineTypeText = "text"
const DBFileName = "sh2.db"

func GetSessionDBName() string {
	scHome := scbase.GetScHomeDir()
	return path.Join(scHome, DBFileName)
}

func OpenConnPool() (*sqlx.DB, error) {
	connPool, err := sqlx.Open("sqlite3", GetSessionDBName())
	if err != nil {
		return nil, err
	}
	return connPool, nil
}

type SessionType struct {
	SessionId string        `json:"sessionid"`
	Remote    string        `json:"remote"`
	Name      string        `json:"name"`
	Windows   []*WindowType `json:"windows"`
	Cmds      []*CmdType    `json:"cmds"`
}

type WindowType struct {
	SessionId string           `json:"sessionid"`
	WindowId  string           `json:"windowid"`
	Name      string           `json:"name"`
	CurRemote string           `json:"curremote"`
	Remotes   []*SessionRemote `json:"remotes"`
	Lines     []*LineType      `json:"lines"`
	Version   int              `json:"version"`
}

type SessionRemote struct {
	SessionId  string `json:"sessionid"`
	WindowId   string `json:"windowid"`
	RemoteId   string `json"remoteid"`
	RemoteName string `json:"name"`
	Cwd        string `json:"cwd"`
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
}

type RemoteType struct {
	RemoteId    string `json:"remoteid"`
	RemoteType  string `json:"remotetype"`
	RemoteName  string `json:"remotename"`
	ConnectOpts string `json:"connectopts"`
	Connected   bool   `json:"connected"`
}

type CmdType struct {
	RowId     int64  `json:"rowid"`
	SessionId string `json:"sessionid"`
	CmdId     string `json:"cmdid"`
	RemoteId  string `json:"remoteid"`
	Status    string `json:"status"`
	StartTs   int64  `json:"startts"`
	DoneTs    int64  `json:"donets"`
	Pid       int    `json:"pid"`
	RunnerPid int    `json:"runnerpid"`
	ExitCode  int    `json:"exitcode"`

	RunOut packet.PacketType `json:"runout"`
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
