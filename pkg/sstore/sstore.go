package sstore

import (
	"context"
	"database/sql/driver"
	"fmt"
	"log"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"

	_ "github.com/mattn/go-sqlite3"
)

const LineTypeCmd = "cmd"
const LineTypeText = "text"
const DBFileName = "sh2.db"

const DefaultSessionName = "default"
const DefaultWindowName = "default"
const LocalRemoteName = "local"
const DefaultScreenWindowName = "w1"

const DefaultCwd = "~"

const CmdStatusRunning = "running"
const CmdStatusDetached = "detached"
const CmdStatusError = "error"
const CmdStatusDone = "done"
const CmdStatusHangup = "hangup"

var globalDBLock = &sync.Mutex{}
var globalDB *sqlx.DB
var globalDBErr error

func GetSessionDBName() string {
	scHome := scbase.GetScHomeDir()
	return path.Join(scHome, DBFileName)
}

func GetDB(ctx context.Context) (*sqlx.DB, error) {
	if IsTxWrapContext(ctx) {
		return nil, fmt.Errorf("cannot call GetDB from within a running transaction")
	}
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB == nil && globalDBErr == nil {
		globalDB, globalDBErr = sqlx.Open("sqlite3", fmt.Sprintf("file:%s?cache=shared&mode=rwc&_journal_mode=WAL&_busy_timeout=5000", GetSessionDBName()))
	}
	return globalDB, globalDBErr
}

type SessionType struct {
	SessionId      string            `json:"sessionid"`
	Name           string            `json:"name"`
	SessionIdx     int64             `json:"sessionidx"`
	ActiveScreenId string            `json:"activescreenid"`
	NotifyNum      int64             `json:"notifynum"`
	Screens        []*ScreenType     `json:"screens"`
	Remotes        []*RemoteInstance `json:"remotes"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
	Full   bool `json:"full,omitempty"`
}

type WindowOptsType struct {
}

func (opts *WindowOptsType) Scan(val interface{}) error {
	return quickScanJson(opts, val)
}

func (opts WindowOptsType) Value() (driver.Value, error) {
	return quickValueJson(opts)
}

type WindowType struct {
	SessionId string            `json:"sessionid"`
	WindowId  string            `json:"windowid"`
	CurRemote string            `json:"curremote"`
	WinOpts   WindowOptsType    `json:"winopts"`
	Lines     []*LineType       `json:"lines"`
	Cmds      []*CmdType        `json:"cmds"`
	Remotes   []*RemoteInstance `json:"remotes"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
}

type ScreenOptsType struct {
	TabColor string `json:"tabcolor"`
}

func (opts *ScreenOptsType) Scan(val interface{}) error {
	return quickScanJson(opts, val)
}

func (opts ScreenOptsType) Value() (driver.Value, error) {
	return quickValueJson(opts)
}

type ScreenType struct {
	SessionId      string              `json:"sessionid"`
	ScreenId       string              `json:"screenid"`
	ScreenIdx      int64               `json:"screenidx"`
	Name           string              `json:"name"`
	ActiveWindowId string              `json:"activewindowid"`
	ScreenOpts     ScreenOptsType      `json:"screenopts"`
	Windows        []*ScreenWindowType `json:"windows"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
	Full   bool `json:"full,omitempty"`
}

const (
	LayoutFull = "full"
)

type LayoutType struct {
	Type   string `json:"type"`
	Parent string `json:"parent,omitempty"`
	ZIndex int64  `json:"zindex,omitempty"`
	Float  bool   `json:"float,omitempty"`
	Top    string `json:"top,omitempty"`
	Bottom string `json:"bottom,omitempty"`
	Left   string `json:"left,omitempty"`
	Right  string `json:"right,omitempty"`
	Width  string `json:"width,omitempty"`
	Height string `json:"height,omitempty"`
}

func (l *LayoutType) Scan(val interface{}) error {
	return quickScanJson(l, val)
}

func (l LayoutType) Value() (driver.Value, error) {
	return quickValueJson(l)
}

type ScreenWindowType struct {
	SessionId string     `json:"sessionid"`
	ScreenId  string     `json:"screenid"`
	WindowId  string     `json:"windowid"`
	Name      string     `json:"name"`
	Layout    LayoutType `json:"layout"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
}

type HistoryItemType struct {
	HistoryId string `json:"historyid"`
	Ts        int64  `json:"ts"`
	UserId    string `json:"userid"`
	SessionId string `json:"sessionid"`
	ScreenId  string `json:"screenid"`
	WindowId  string `json:"windowid"`
	LineId    int64  `json:"lineid"`
	CmdId     string `json:"cmdid"`
	CmdStr    string `json:"cmdstr"`

	// only for updates
	Remove bool `json:"remove"`
}

type RemoteState struct {
	Cwd string `json:"cwd"`
}

func (s *RemoteState) Scan(val interface{}) error {
	return quickScanJson(s, val)
}

func (s RemoteState) Value() (driver.Value, error) {
	return quickValueJson(s)
}

type TermOpts struct {
	Rows     int64 `json:"rows"`
	Cols     int64 `json:"cols"`
	FlexRows bool  `json:"flexrows,omitempty"`
	CmdSize  int64 `json:"cmdsize,omitempty"`
}

func (opts *TermOpts) Scan(val interface{}) error {
	return quickScanJson(opts, val)
}

func (opts TermOpts) Value() (driver.Value, error) {
	return quickValueJson(opts)
}

type RemoteInstance struct {
	RIId         string      `json:"riid"`
	Name         string      `json:"name"`
	SessionId    string      `json:"sessionid"`
	WindowId     string      `json:"windowid"`
	RemoteId     string      `json:"remoteid"`
	SessionScope bool        `json:"sessionscope"`
	State        RemoteState `json:"state"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
}

type LineType struct {
	SessionId string `json:"sessionid"`
	WindowId  string `json:"windowid"`
	LineId    int64  `json:"lineid"`
	Ts        int64  `json:"ts"`
	UserId    string `json:"userid"`
	LineType  string `json:"linetype"`
	Text      string `json:"text,omitempty"`
	CmdId     string `json:"cmdid,omitempty"`
	Remove    bool   `json:"remove,omitempty"`
}

type SSHOpts struct {
	SSHHost     string `json:"sshhost"`
	SSHOptsStr  string `json:"sshopts"`
	SSHIdentity string `json:"sshidentity"`
	SSHUser     string `json:"sshuser"`
}

type RemoteType struct {
	RemoteId      string                 `json:"remoteid"`
	RemoteType    string                 `json:"remotetype"`
	RemoteName    string                 `json:"remotename"`
	AutoConnect   bool                   `json:"autoconnect"`
	InitPk        *packet.InitPacketType `json:"inipk"`
	SSHOpts       *SSHOpts               `json:"sshopts"`
	LastConnectTs int64                  `json:"lastconnectts"`
}

func (r *RemoteType) GetUserHost() (string, string) {
	if r.SSHOpts == nil {
		return "", ""
	}
	if r.SSHOpts.SSHUser != "" {
		return r.SSHOpts.SSHUser, r.SSHOpts.SSHHost
	}
	atIdx := strings.Index(r.SSHOpts.SSHHost, "@")
	if atIdx == -1 {
		return "", r.SSHOpts.SSHHost
	}
	return r.SSHOpts.SSHHost[0:atIdx], r.SSHOpts.SSHHost[atIdx+1:]
}

type CmdType struct {
	SessionId   string                     `json:"sessionid"`
	CmdId       string                     `json:"cmdid"`
	RemoteId    string                     `json:"remoteid"`
	CmdStr      string                     `json:"cmdstr"`
	RemoteState RemoteState                `json:"remotestate"`
	TermOpts    TermOpts                   `json:"termopts"`
	Status      string                     `json:"status"`
	StartPk     *packet.CmdStartPacketType `json:"startpk"`
	DonePk      *packet.CmdDonePacketType  `json:"donepk"`
	UsedRows    int64                      `json:"usedrows"`
	RunOut      []packet.PacketType        `json:"runout"`
	Remove      bool                       `json:"remove"`
}

func (r *RemoteType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["remoteid"] = r.RemoteId
	rtn["remotetype"] = r.RemoteType
	rtn["remotename"] = r.RemoteName
	rtn["autoconnect"] = r.AutoConnect
	rtn["initpk"] = quickJson(r.InitPk)
	rtn["sshopts"] = quickJson(r.SSHOpts)
	rtn["lastconnectts"] = r.LastConnectTs
	return rtn
}

func RemoteFromMap(m map[string]interface{}) *RemoteType {
	if len(m) == 0 {
		return nil
	}
	var r RemoteType
	quickSetStr(&r.RemoteId, m, "remoteid")
	quickSetStr(&r.RemoteType, m, "remotetype")
	quickSetStr(&r.RemoteName, m, "remotename")
	quickSetBool(&r.AutoConnect, m, "autoconnect")
	quickSetJson(&r.InitPk, m, "initpk")
	quickSetJson(&r.SSHOpts, m, "sshopts")
	quickSetInt64(&r.LastConnectTs, m, "lastconnectts")
	return &r
}

func (cmd *CmdType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["sessionid"] = cmd.SessionId
	rtn["cmdid"] = cmd.CmdId
	rtn["remoteid"] = cmd.RemoteId
	rtn["cmdstr"] = cmd.CmdStr
	rtn["remotestate"] = quickJson(cmd.RemoteState)
	rtn["termopts"] = quickJson(cmd.TermOpts)
	rtn["status"] = cmd.Status
	rtn["startpk"] = quickJson(cmd.StartPk)
	rtn["donepk"] = quickJson(cmd.DonePk)
	rtn["runout"] = quickJson(cmd.RunOut)
	rtn["usedrows"] = cmd.UsedRows
	return rtn
}

func CmdFromMap(m map[string]interface{}) *CmdType {
	if len(m) == 0 {
		return nil
	}
	var cmd CmdType
	quickSetStr(&cmd.SessionId, m, "sessionid")
	quickSetStr(&cmd.CmdId, m, "cmdid")
	quickSetStr(&cmd.RemoteId, m, "remoteid")
	quickSetStr(&cmd.CmdStr, m, "cmdstr")
	quickSetJson(&cmd.RemoteState, m, "remotestate")
	quickSetJson(&cmd.TermOpts, m, "termopts")
	quickSetStr(&cmd.Status, m, "status")
	quickSetJson(&cmd.StartPk, m, "startpk")
	quickSetJson(&cmd.DonePk, m, "donepk")
	quickSetJson(&cmd.RunOut, m, "runout")
	quickSetInt64(&cmd.UsedRows, m, "usedrows")
	return &cmd
}

func makeNewLineCmd(sessionId string, windowId string, userId string, cmdId string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.Ts = time.Now().UnixMilli()
	rtn.UserId = userId
	rtn.LineType = LineTypeCmd
	rtn.CmdId = cmdId
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
	err := InsertLine(ctx, rtnLine, nil)
	if err != nil {
		return nil, err
	}
	return rtnLine, nil
}

func AddCmdLine(ctx context.Context, sessionId string, windowId string, userId string, cmd *CmdType) (*LineType, error) {
	rtnLine := makeNewLineCmd(sessionId, windowId, userId, cmd.CmdId)
	err := InsertLine(ctx, rtnLine, cmd)
	if err != nil {
		return nil, err
	}
	return rtnLine, nil
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
	_, err = InsertSessionWithName(ctx, DefaultSessionName, true)
	if err != nil {
		return nil, err
	}
	return GetSessionByName(ctx, DefaultSessionName)
}
