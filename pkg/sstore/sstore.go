package sstore

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"fmt"
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
	SessionId string            `json:"sessionid"`
	Name      string            `json:"name"`
	Windows   []*WindowType     `json:"windows"`
	Cmds      []*CmdType        `json:"cmds"`
	Remotes   []*RemoteInstance `json:"remotes"`
}

type WindowType struct {
	SessionId string      `json:"sessionid"`
	WindowId  string      `json:"windowid"`
	Name      string      `json:"name"`
	CurRemote string      `json:"curremote"`
	Lines     []*LineType `json:"lines"`
	Version   int         `json:"version"`
}

type RemoteState struct {
	Cwd string `json:"cwd"`
}

func (s *RemoteState) Scan(val interface{}) error {
	if strVal, ok := val.(string); ok {
		if strVal == "" {
			return nil
		}
		err := json.Unmarshal([]byte(strVal), s)
		if err != nil {
			return err
		}
		return nil
	}
	return fmt.Errorf("cannot scan '%T' into RemoteState", val)
}

func (s *RemoteState) Value() (driver.Value, error) {
	return json.Marshal(s)
}

type RemoteInstance struct {
	RIId         string      `json:"riid"`
	Name         string      `json:"name"`
	SessionId    string      `json:"sessionid"`
	WindowId     string      `json:"windowid"`
	RemoteId     string      `json"remoteid"`
	SessionScope bool        `json:"sessionscope"`
	State        RemoteState `json:"state"`
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
	SessionId   string `json:"sessionid"`
	CmdId       string `json:"cmdid"`
	RSId        string `json:"rsid"`
	RemoteId    string `json:"remoteid"`
	RemoteState string `json:"remotestate"`
	Status      string `json:"status"`
	StartTs     int64  `json:"startts"`
	DoneTs      int64  `json:"donets"`
	Pid         int    `json:"pid"`
	RunnerPid   int    `json:"runnerpid"`
	ExitCode    int    `json:"exitcode"`

	RunOut packet.PacketType `json:"runout"`
}

func makeNewLineCmd(sessionId string, windowId string, userId string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.Ts = time.Now().UnixMilli()
	rtn.UserId = userId
	rtn.LineType = LineTypeCmd
	rtn.CmdId = uuid.New().String()
	return rtn
}

func makeNewLineText(sessionId string, windowId string, userId string, text string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.Ts = time.Now().UnixMilli()
	rtn.UserId = userId
	rtn.LineType = LineTypeText
	rtn.Text = text
	return rtn
}

func AddCommentLine(ctx context.Context, sessionId string, windowId string, userId string, commentText string) (*LineType, error) {
	rtnLine := makeNewLineText(sessionId, windowId, userId, commentText)
	err := InsertLine(ctx, rtnLine)
	if err != nil {
		return nil, err
	}
	return rtnLine, nil
}

func AddCmdLine(ctx context.Context, sessionId string, windowId string, userId string) (*LineType, error) {
	rtnLine := makeNewLineCmd(sessionId, windowId, userId)
	err := InsertLine(ctx, rtnLine)
	if err != nil {
		return nil, err
	}
	return rtnLine, nil
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
