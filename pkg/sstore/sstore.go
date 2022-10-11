package sstore

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"database/sql/driver"
	"fmt"
	"log"
	"os"
	"os/user"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
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
const LocalRemoteAlias = "local"
const DefaultScreenWindowName = "w1"

const DefaultCwd = "~"

const (
	CmdStatusRunning  = "running"
	CmdStatusDetached = "detached"
	CmdStatusError    = "error"
	CmdStatusDone     = "done"
	CmdStatusHangup   = "hangup"
)

const (
	ShareModeLocal   = "local"
	ShareModePrivate = "private"
	ShareModeView    = "view"
	ShareModeShared  = "shared"
)

const (
	ConnectModeStartup = "startup"
	ConnectModeAuto    = "auto"
	ConnectModeManual  = "manual"
)

const (
	RemoteTypeSsh = "ssh"
)

const (
	SWFocusInput = "input"
	SWFocusCmd   = "cmd"
	SWFocusCmdFg = "cmd-fg"
)

var globalDBLock = &sync.Mutex{}
var globalDB *sqlx.DB
var globalDBErr error

func GetSessionDBName() string {
	scHome := scbase.GetScHomeDir()
	return path.Join(scHome, DBFileName)
}

func IsValidConnectMode(mode string) bool {
	return mode == ConnectModeStartup || mode == ConnectModeAuto || mode == ConnectModeManual
}

func GetDB(ctx context.Context) (*sqlx.DB, error) {
	if IsTxWrapContext(ctx) {
		return nil, fmt.Errorf("cannot call GetDB from within a running transaction")
	}
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB == nil && globalDBErr == nil {
		dbName := GetSessionDBName()
		globalDB, globalDBErr = sqlx.Open("sqlite3", fmt.Sprintf("file:%s?cache=shared&mode=rwc&_journal_mode=WAL&_busy_timeout=5000", dbName))
		if globalDBErr != nil {
			globalDBErr = fmt.Errorf("opening db[%s]: %w", dbName, globalDBErr)
		}
	}
	return globalDB, globalDBErr
}

type ClientWinSizeType struct {
	Width      int  `json:"width"`
	Height     int  `json:"height"`
	Top        int  `json:"top"`
	Left       int  `json:"left"`
	FullScreen bool `json:"fullscreen,omitempty"`
}

type ClientData struct {
	ClientId            string            `json:"clientid"`
	UserId              string            `json:"userid"`
	UserPrivateKeyBytes []byte            `json:"-"`
	UserPublicKeyBytes  []byte            `json:"-"`
	UserPrivateKey      *ecdsa.PrivateKey `json:"-"`
	UserPublicKey       *ecdsa.PublicKey  `json:"-"`
	ActiveSessionId     string            `json:"activesessionid"`
	WinSize             ClientWinSizeType `json:"winsize"`
}

func (c *ClientData) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["clientid"] = c.ClientId
	rtn["userid"] = c.UserId
	rtn["userprivatekeybytes"] = c.UserPrivateKeyBytes
	rtn["userpublickeybytes"] = c.UserPublicKeyBytes
	rtn["activesessionid"] = c.ActiveSessionId
	rtn["winsize"] = quickJson(c.WinSize)
	return rtn
}

func ClientDataFromMap(m map[string]interface{}) *ClientData {
	if len(m) == 0 {
		return nil
	}
	var c ClientData
	quickSetStr(&c.ClientId, m, "clientid")
	quickSetStr(&c.UserId, m, "userid")
	quickSetBytes(&c.UserPrivateKeyBytes, m, "userprivatekeybytes")
	quickSetBytes(&c.UserPublicKeyBytes, m, "userpublickeybytes")
	quickSetStr(&c.ActiveSessionId, m, "activesessionid")
	quickSetJson(&c.WinSize, m, "winsize")
	return &c
}

type SessionType struct {
	SessionId      string            `json:"sessionid"`
	Name           string            `json:"name"`
	SessionIdx     int64             `json:"sessionidx"`
	ActiveScreenId string            `json:"activescreenid"`
	OwnerId        string            `json:"ownerid"`
	ShareMode      string            `json:"sharemode"`
	AccessKey      string            `json:"-"`
	NotifyNum      int64             `json:"notifynum"`
	Screens        []*ScreenType     `json:"screens"`
	Remotes        []*RemoteInstance `json:"remotes"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
	Full   bool `json:"full,omitempty"`
}

type SessionStatsType struct {
	SessionId  string              `json:"sessionid"`
	NumScreens int                 `json:"numscreens"`
	NumWindows int                 `json:"numwindows"`
	NumLines   int                 `json:"numlines"`
	NumCmds    int                 `json:"numcmds"`
	DiskStats  SessionDiskSizeType `json:"diskstats"`
}

type WindowOptsType struct {
}

func (opts *WindowOptsType) Scan(val interface{}) error {
	return quickScanJson(opts, val)
}

func (opts WindowOptsType) Value() (driver.Value, error) {
	return quickValueJson(opts)
}

type WindowShareOptsType struct {
}

func (opts *WindowShareOptsType) Scan(val interface{}) error {
	return quickScanJson(opts, val)
}

func (opts WindowShareOptsType) Value() (driver.Value, error) {
	return quickValueJson(opts)
}

var RemoteNameRe = regexp.MustCompile("^\\*?[a-zA-Z0-9_-]+$")

type RemotePtrType struct {
	OwnerId  string `json:"ownerid"`
	RemoteId string `json:"remoteid"`
	Name     string `json:"name"`
}

func (r RemotePtrType) IsSessionScope() bool {
	return strings.HasPrefix(r.Name, "*")
}

func (r RemotePtrType) Validate() error {
	if r.OwnerId != "" {
		if _, err := uuid.Parse(r.OwnerId); err != nil {
			return fmt.Errorf("invalid ownerid format: %v", err)
		}
	}
	if r.RemoteId != "" {
		if _, err := uuid.Parse(r.RemoteId); err != nil {
			return fmt.Errorf("invalid remoteid format: %v", err)
		}
	}
	if r.Name != "" {
		ok := RemoteNameRe.MatchString(r.Name)
		if !ok {
			return fmt.Errorf("invalid remote name")
		}
	}
	return nil
}

func (r RemotePtrType) MakeFullRemoteRef() string {
	if r.RemoteId == "" {
		return ""
	}
	if r.OwnerId == "" && r.Name == "" {
		return r.RemoteId
	}
	if r.OwnerId != "" && r.Name == "" {
		return fmt.Sprintf("@%s:%s", r.OwnerId, r.RemoteId)
	}
	if r.OwnerId == "" && r.Name != "" {
		return fmt.Sprintf("%s:%s", r.RemoteId, r.Name)
	}
	return fmt.Sprintf("@%s:%s:%s", r.OwnerId, r.RemoteId, r.Name)
}

type WindowType struct {
	SessionId   string              `json:"sessionid"`
	WindowId    string              `json:"windowid"`
	CurRemote   RemotePtrType       `json:"curremote"`
	WinOpts     WindowOptsType      `json:"winopts"`
	OwnerId     string              `json:"ownerid"`
	NextLineNum int64               `json:"nextlinenum"`
	ShareMode   string              `json:"sharemode"`
	ShareOpts   WindowShareOptsType `json:"shareopts"`
	Lines       []*LineType         `json:"lines"`
	Cmds        []*CmdType          `json:"cmds"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
}

func (w *WindowType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["sessionid"] = w.SessionId
	rtn["windowid"] = w.WindowId
	rtn["curremoteownerid"] = w.CurRemote.OwnerId
	rtn["curremoteid"] = w.CurRemote.RemoteId
	rtn["curremotename"] = w.CurRemote.Name
	rtn["nextlinenum"] = w.NextLineNum
	rtn["winopts"] = quickJson(w.WinOpts)
	rtn["ownerid"] = w.OwnerId
	rtn["sharemode"] = w.ShareMode
	rtn["shareopts"] = quickJson(w.ShareOpts)
	return rtn
}

func WindowFromMap(m map[string]interface{}) *WindowType {
	if len(m) == 0 {
		return nil
	}
	var w WindowType
	quickSetStr(&w.SessionId, m, "sessionid")
	quickSetStr(&w.WindowId, m, "windowid")
	quickSetStr(&w.CurRemote.OwnerId, m, "curremoteownerid")
	quickSetStr(&w.CurRemote.RemoteId, m, "curremoteid")
	quickSetStr(&w.CurRemote.Name, m, "curremotename")
	quickSetInt64(&w.NextLineNum, m, "nextlinenum")
	quickSetJson(&w.WinOpts, m, "winopts")
	quickSetStr(&w.OwnerId, m, "ownerid")
	quickSetStr(&w.ShareMode, m, "sharemode")
	quickSetJson(&w.ShareOpts, m, "shareopts")
	return &w
}

func (h *HistoryItemType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["historyid"] = h.HistoryId
	rtn["ts"] = h.Ts
	rtn["userid"] = h.UserId
	rtn["sessionid"] = h.SessionId
	rtn["screenid"] = h.ScreenId
	rtn["windowid"] = h.WindowId
	rtn["lineid"] = h.LineId
	rtn["haderror"] = h.HadError
	rtn["cmdid"] = h.CmdId
	rtn["cmdstr"] = h.CmdStr
	rtn["remoteownerid"] = h.Remote.OwnerId
	rtn["remoteid"] = h.Remote.RemoteId
	rtn["remotename"] = h.Remote.Name
	rtn["ismetacmd"] = h.IsMetaCmd
	return rtn
}

func HistoryItemFromMap(m map[string]interface{}) *HistoryItemType {
	if len(m) == 0 {
		return nil
	}
	var h HistoryItemType
	quickSetStr(&h.HistoryId, m, "historyid")
	quickSetInt64(&h.Ts, m, "ts")
	quickSetStr(&h.UserId, m, "userid")
	quickSetStr(&h.SessionId, m, "sessionid")
	quickSetStr(&h.ScreenId, m, "screenid")
	quickSetStr(&h.WindowId, m, "windowid")
	quickSetStr(&h.LineId, m, "lineid")
	quickSetBool(&h.HadError, m, "haderror")
	quickSetStr(&h.CmdId, m, "cmdid")
	quickSetStr(&h.CmdStr, m, "cmdstr")
	quickSetStr(&h.Remote.OwnerId, m, "remoteownerid")
	quickSetStr(&h.Remote.RemoteId, m, "remoteid")
	quickSetStr(&h.Remote.Name, m, "remotename")
	quickSetBool(&h.IsMetaCmd, m, "ismetacmd")
	quickSetStr(&h.HistoryNum, m, "historynum")
	return &h
}

type ScreenOptsType struct {
	TabColor string `json:"tabcolor,omitempty"`
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
	ScreenOpts     *ScreenOptsType     `json:"screenopts"`
	OwnerId        string              `json:"ownerid"`
	ShareMode      string              `json:"sharemode"`
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

type SWAnchorType struct {
	AnchorLine   int `json:"anchorline,omitempty"`
	AnchorOffset int `json:"anchoroffset,omitempty"`
}

func (a *SWAnchorType) Scan(val interface{}) error {
	return quickScanJson(a, val)
}

func (a SWAnchorType) Value() (driver.Value, error) {
	return quickValueJson(a)
}

type ScreenWindowType struct {
	SessionId    string       `json:"sessionid"`
	ScreenId     string       `json:"screenid"`
	WindowId     string       `json:"windowid"`
	Name         string       `json:"name"`
	Layout       LayoutType   `json:"layout"`
	SelectedLine int          `json:"selectedline"`
	Anchor       SWAnchorType `json:"anchor"`
	FocusType    string       `json:"focustype"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
}

type HistoryItemType struct {
	HistoryId string        `json:"historyid"`
	Ts        int64         `json:"ts"`
	UserId    string        `json:"userid"`
	SessionId string        `json:"sessionid"`
	ScreenId  string        `json:"screenid"`
	WindowId  string        `json:"windowid"`
	LineId    string        `json:"lineid"`
	HadError  bool          `json:"haderror"`
	CmdId     string        `json:"cmdid"`
	CmdStr    string        `json:"cmdstr"`
	Remote    RemotePtrType `json:"remote"`
	IsMetaCmd bool          `json:"ismetacmd"`

	// only for updates
	Remove bool `json:"remove"`

	// transient (string because of different history orderings)
	HistoryNum string `json:"historynum"`
}

type HistoryQueryOpts struct {
	MaxItems int
	FromTs   int64
}

type RemoteState struct {
	Cwd  string `json:"cwd"`
	Env0 []byte `json:"env0"` // "env -0" format
}

func (s *RemoteState) Scan(val interface{}) error {
	return quickScanJson(s, val)
}

func (s RemoteState) Value() (driver.Value, error) {
	return quickValueJson(s)
}

type TermOpts struct {
	Rows       int64 `json:"rows"`
	Cols       int64 `json:"cols"`
	FlexRows   bool  `json:"flexrows,omitempty"`
	MaxPtySize int64 `json:"maxptysize,omitempty"`
}

func (opts *TermOpts) Scan(val interface{}) error {
	return quickScanJson(opts, val)
}

func (opts TermOpts) Value() (driver.Value, error) {
	return quickValueJson(opts)
}

type RemoteInstance struct {
	RIId          string      `json:"riid"`
	Name          string      `json:"name"`
	SessionId     string      `json:"sessionid"`
	WindowId      string      `json:"windowid"`
	RemoteOwnerId string      `json:"remoteownerid"`
	RemoteId      string      `json:"remoteid"`
	State         RemoteState `json:"state"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
}

type LineType struct {
	SessionId   string `json:"sessionid"`
	WindowId    string `json:"windowid"`
	UserId      string `json:"userid"`
	LineId      string `json:"lineid"`
	Ts          int64  `json:"ts"`
	LineNum     int64  `json:"linenum"`
	LineNumTemp bool   `json:"linenumtemp,omitempty"`
	LineLocal   bool   `json:"linelocal"`
	LineType    string `json:"linetype"`
	Text        string `json:"text,omitempty"`
	CmdId       string `json:"cmdid,omitempty"`
	Ephemeral   bool   `json:"ephemeral,omitempty"`
	Remove      bool   `json:"remove,omitempty"`
}

type ResolveItem struct {
	Name string
	Num  int
	Id   string
}

type SSHOpts struct {
	Local       bool   `json:"local,omitempty"`
	SSHHost     string `json:"sshhost"`
	SSHUser     string `json:"sshuser"`
	SSHOptsStr  string `json:"sshopts,omitempty"`
	SSHIdentity string `json:"sshidentity,omitempty"`
	SSHPort     int    `json:"sshport,omitempty"`
	SSHPassword string `json:"sshpassword,omitempty"`
}

type RemoteOptsType struct {
	Color string `json:"color"`
}

func (opts *RemoteOptsType) Scan(val interface{}) error {
	return quickScanJson(opts, val)
}

func (opts RemoteOptsType) Value() (driver.Value, error) {
	return quickValueJson(opts)
}

type RemoteType struct {
	RemoteId            string                 `json:"remoteid"`
	PhysicalId          string                 `json:"physicalid"`
	RemoteType          string                 `json:"remotetype"`
	RemoteAlias         string                 `json:"remotealias"`
	RemoteCanonicalName string                 `json:"remotecanonicalname"`
	RemoteSudo          bool                   `json:"remotesudo"`
	RemoteUser          string                 `json:"remoteuser"`
	RemoteHost          string                 `json:"remotehost"`
	ConnectMode         string                 `json:"connectmode"`
	AutoInstall         bool                   `json:"autoinstall"`
	InitPk              *packet.InitPacketType `json:"inipk"`
	SSHOpts             *SSHOpts               `json:"sshopts"`
	RemoteOpts          *RemoteOptsType        `json:"remoteopts"`
	LastConnectTs       int64                  `json:"lastconnectts"`
	Archived            bool                   `json:"archived"`
	RemoteIdx           int64                  `json:"remoteidx"`
	Local               bool                   `json:"local"`
}

func (r *RemoteType) GetName() string {
	if r.RemoteAlias != "" {
		return r.RemoteAlias
	}
	return r.RemoteCanonicalName
}

type CmdType struct {
	SessionId    string                     `json:"sessionid"`
	CmdId        string                     `json:"cmdid"`
	Remote       RemotePtrType              `json:"remote"`
	CmdStr       string                     `json:"cmdstr"`
	RemoteState  RemoteState                `json:"remotestate"`
	TermOpts     TermOpts                   `json:"termopts"`
	OrigTermOpts TermOpts                   `json:"origtermopts"`
	Status       string                     `json:"status"`
	StartPk      *packet.CmdStartPacketType `json:"startpk"`
	DonePk       *packet.CmdDonePacketType  `json:"donepk"`
	UsedRows     int64                      `json:"usedrows"`
	RunOut       []packet.PacketType        `json:"runout"`
	Remove       bool                       `json:"remove"`
}

func (r *RemoteType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["remoteid"] = r.RemoteId
	rtn["physicalid"] = r.PhysicalId
	rtn["remotetype"] = r.RemoteType
	rtn["remotealias"] = r.RemoteAlias
	rtn["remotecanonicalname"] = r.RemoteCanonicalName
	rtn["remotesudo"] = r.RemoteSudo
	rtn["remoteuser"] = r.RemoteUser
	rtn["remotehost"] = r.RemoteHost
	rtn["connectmode"] = r.ConnectMode
	rtn["autoinstall"] = r.AutoInstall
	rtn["initpk"] = quickJson(r.InitPk)
	rtn["sshopts"] = quickJson(r.SSHOpts)
	rtn["remoteopts"] = quickJson(r.RemoteOpts)
	rtn["lastconnectts"] = r.LastConnectTs
	rtn["archived"] = r.Archived
	rtn["remoteidx"] = r.RemoteIdx
	rtn["local"] = r.Local
	return rtn
}

func RemoteFromMap(m map[string]interface{}) *RemoteType {
	if len(m) == 0 {
		return nil
	}
	var r RemoteType
	quickSetStr(&r.RemoteId, m, "remoteid")
	quickSetStr(&r.PhysicalId, m, "physicalid")
	quickSetStr(&r.RemoteType, m, "remotetype")
	quickSetStr(&r.RemoteAlias, m, "remotealias")
	quickSetStr(&r.RemoteCanonicalName, m, "remotecanonicalname")
	quickSetBool(&r.RemoteSudo, m, "remotesudo")
	quickSetStr(&r.RemoteUser, m, "remoteuser")
	quickSetStr(&r.RemoteHost, m, "remotehost")
	quickSetStr(&r.ConnectMode, m, "connectmode")
	quickSetBool(&r.AutoInstall, m, "autoinstall")
	quickSetJson(&r.InitPk, m, "initpk")
	quickSetJson(&r.SSHOpts, m, "sshopts")
	quickSetJson(&r.RemoteOpts, m, "remoteopts")
	quickSetInt64(&r.LastConnectTs, m, "lastconnectts")
	quickSetBool(&r.Archived, m, "archived")
	quickSetInt64(&r.RemoteIdx, m, "remoteidx")
	quickSetBool(&r.Local, m, "local")
	return &r
}

func (cmd *CmdType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["sessionid"] = cmd.SessionId
	rtn["cmdid"] = cmd.CmdId
	rtn["remoteownerid"] = cmd.Remote.OwnerId
	rtn["remoteid"] = cmd.Remote.RemoteId
	rtn["remotename"] = cmd.Remote.Name
	rtn["cmdstr"] = cmd.CmdStr
	rtn["remotestate"] = quickJson(cmd.RemoteState)
	rtn["termopts"] = quickJson(cmd.TermOpts)
	rtn["origtermopts"] = quickJson(cmd.OrigTermOpts)
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
	quickSetStr(&cmd.Remote.OwnerId, m, "remoteownerid")
	quickSetStr(&cmd.Remote.RemoteId, m, "remoteid")
	quickSetStr(&cmd.Remote.Name, m, "remotename")
	quickSetStr(&cmd.CmdStr, m, "cmdstr")
	quickSetJson(&cmd.RemoteState, m, "remotestate")
	quickSetJson(&cmd.TermOpts, m, "termopts")
	quickSetJson(&cmd.OrigTermOpts, m, "origtermopts")
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
	rtn.UserId = userId
	rtn.LineId = scbase.GenSCUUID()
	rtn.Ts = time.Now().UnixMilli()
	rtn.LineLocal = true
	rtn.LineType = LineTypeCmd
	rtn.CmdId = cmdId
	return rtn
}

func makeNewLineText(sessionId string, windowId string, userId string, text string) *LineType {
	rtn := &LineType{}
	rtn.SessionId = sessionId
	rtn.WindowId = windowId
	rtn.UserId = userId
	rtn.LineId = scbase.GenSCUUID()
	rtn.Ts = time.Now().UnixMilli()
	rtn.LineLocal = true
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
	physicalId, err := base.GetRemoteId()
	if err != nil {
		return fmt.Errorf("getting local physical remoteid: %w", err)
	}
	remote, err := GetLocalRemote(ctx)
	if err != nil {
		return fmt.Errorf("getting local remote from db: %w", err)
	}
	if remote != nil {
		return nil
	}
	hostName, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("getting hostname: %w", err)
	}
	user, err := user.Current()
	if err != nil {
		return fmt.Errorf("getting user: %w", err)
	}
	// create the local remote
	localRemote := &RemoteType{
		RemoteId:            scbase.GenSCUUID(),
		PhysicalId:          physicalId,
		RemoteType:          RemoteTypeSsh,
		RemoteAlias:         LocalRemoteAlias,
		RemoteCanonicalName: fmt.Sprintf("%s@%s", user.Username, hostName),
		RemoteSudo:          false,
		RemoteUser:          user.Username,
		RemoteHost:          hostName,
		ConnectMode:         ConnectModeStartup,
		AutoInstall:         true,
		SSHOpts:             &SSHOpts{Local: true},
		Local:               true,
	}
	err = UpsertRemote(ctx, localRemote)
	if err != nil {
		return err
	}
	log.Printf("[db] added local remote '%s', id=%s\n", localRemote.RemoteCanonicalName, localRemote.RemoteId)
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

func createClientData(tx *TxWrap) error {
	curve := elliptic.P384()
	pkey, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		return fmt.Errorf("generating P-834 key: %w", err)
	}
	pkBytes, err := x509.MarshalECPrivateKey(pkey)
	if err != nil {
		return fmt.Errorf("marshaling (pkcs8) private key bytes: %w", err)
	}
	pubBytes, err := x509.MarshalPKIXPublicKey(&pkey.PublicKey)
	if err != nil {
		return fmt.Errorf("marshaling (pkix) public key bytes: %w", err)
	}
	c := ClientData{
		ClientId:            uuid.New().String(),
		UserId:              uuid.New().String(),
		UserPrivateKeyBytes: pkBytes,
		UserPublicKeyBytes:  pubBytes,
		ActiveSessionId:     "",
		WinSize:             ClientWinSizeType{},
	}
	query := `INSERT INTO client ( clientid, userid, activesessionid, userpublickeybytes, userprivatekeybytes, winsize) 
                          VALUES (:clientid,:userid,:activesessionid,:userpublickeybytes,:userprivatekeybytes,:winsize)`
	tx.NamedExecWrap(query, c.ToMap())
	fmt.Printf("create new clientid[%s] userid[%s] with public/private keypair\n", c.ClientId, c.UserId)
	return nil
}

func EnsureClientData(ctx context.Context) (*ClientData, error) {
	var rtn ClientData
	err := WithTx(ctx, func(tx *TxWrap) error {
		query := `SELECT count(*) FROM client`
		count := tx.GetInt(query)
		if count > 1 {
			return fmt.Errorf("invalid client database, multiple (%d) rows in client table", count)
		}
		if count == 0 {
			createErr := createClientData(tx)
			if createErr != nil {
				return createErr
			}
		}
		m := tx.GetMap(`SELECT * FROM client`)
		cdata := ClientDataFromMap(m)
		if cdata == nil {
			return fmt.Errorf("no client data found")
		}
		rtn = *cdata
		return nil
	})
	if err != nil {
		return nil, err
	}
	if rtn.UserId == "" {
		return nil, fmt.Errorf("invalid client data (no userid)")
	}
	if len(rtn.UserPrivateKeyBytes) == 0 || len(rtn.UserPublicKeyBytes) == 0 {
		return nil, fmt.Errorf("invalid client data (no public/private keypair)")
	}
	rtn.UserPrivateKey, err = x509.ParseECPrivateKey(rtn.UserPrivateKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("invalid client data, cannot parse private key: %w", err)
	}
	pubKey, err := x509.ParsePKIXPublicKey(rtn.UserPublicKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("invalid client data, cannot parse public key: %w", err)
	}
	var ok bool
	rtn.UserPublicKey, ok = pubKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("invalid client data, wrong public key type: %T", pubKey)
	}
	return &rtn, nil
}
