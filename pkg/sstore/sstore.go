package sstore

import (
	"context"
	"log"
	"path"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"

	_ "github.com/mattn/go-sqlite3"
)

var NextLineId = 10
var NextLineLock = &sync.Mutex{}

const LineTypeCmd = "cmd"
const LineTypeText = "text"
const DBFileName = "sh2.db"

const DefaultSessionName = "default"
const DefaultWindowName = "default"
const LocalRemoteName = "local"

const DefaultCwd = "~"

var globalDBLock = &sync.Mutex{}
var globalDB *sqlx.DB
var globalDBErr error

func GetSessionDBName() string {
	scHome := scbase.GetScHomeDir()
	return path.Join(scHome, DBFileName)
}

func GetDB() (*sqlx.DB, error) {
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB == nil && globalDBErr == nil {
		globalDB, globalDBErr = sqlx.Open("sqlite3", GetSessionDBName())
	}
	return globalDB, globalDBErr
}

type SessionType struct {
	SessionId string           `json:"sessionid"`
	Name      string           `json:"name"`
	Windows   []*WindowType    `json:"windows"`
	Cmds      []*CmdType       `json:"cmds"`
	Remotes   []*SessionRemote `json:"remotes"`
}

type WindowType struct {
	SessionId string      `json:"sessionid"`
	WindowId  string      `json:"windowid"`
	Name      string      `json:"name"`
	CurRemote string      `json:"curremote"`
	Lines     []*LineType `json:"lines"`
	Version   int         `json:"version"`
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
	RowId       int64  `json:"rowid"`
	RemoteId    string `json:"remoteid"`
	RemoteType  string `json:"remotetype"`
	RemoteName  string `json:"remotename"`
	AutoConnect bool   `json:"autoconnect"`

	// type=ssh options
	SSHHost     string `json:"sshhost"`
	SSHOpts     string `json:"sshopts"`
	SSHIdentity string `json:"sshidentity"`
	SSHUser     string `json:"sshuser"`

	// runtime data
	LastConnectTs int64 `json:"lastconnectts"`
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

func EnsureLocalRemote(ctx context.Context) error {
	remoteId, err := base.GetRemoteId()
	if err != nil {
		return err
	}
	remote, err := GetRemoteById(ctx, remoteId)
	if err != nil {
		return err
	}
	if remote != nil {
		return nil
	}
	// create the local remote
	localRemote := &RemoteType{
		RemoteId:    remoteId,
		RemoteType:  "ssh",
		RemoteName:  LocalRemoteName,
		AutoConnect: true,
	}
	err = InsertRemote(ctx, localRemote)
	if err != nil {
		return err
	}
	log.Printf("[db] added remote '%s', id=%s\n", localRemote.RemoteName, localRemote.RemoteId)
	return nil
}

func EnsureDefaultSession(ctx context.Context) (*SessionType, error) {
	session, err := GetSessionByName(ctx, DefaultSessionName)
	if err != nil {
		return nil, err
	}
	if session != nil {
		return session, nil
	}
	err = InsertSessionWithName(ctx, DefaultSessionName)
	if err != nil {
		return nil, err
	}
	return GetSessionByName(ctx, DefaultSessionName)
}
