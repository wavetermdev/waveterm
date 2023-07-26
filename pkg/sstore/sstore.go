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
	"github.com/sawka/txwrap"
	"github.com/commandlinedev/apishell/pkg/packet"
	"github.com/commandlinedev/apishell/pkg/shexec"
	"github.com/commandlinedev/prompt-server/pkg/dbutil"
	"github.com/commandlinedev/prompt-server/pkg/scbase"

	_ "github.com/mattn/go-sqlite3"
)

const LineNoHeight = -1
const DBFileName = "prompt.db"
const DBFileNameBackup = "backup.prompt.db"
const MaxWebShareLineCount = 50
const MaxWebShareScreenCount = 3

const DefaultSessionName = "default"
const LocalRemoteAlias = "local"

const DefaultCwd = "~"
const APITokenSentinel = "--apitoken--"

const (
	LineTypeCmd    = "cmd"
	LineTypeText   = "text"
	LineTypeOpenAI = "openai"
)

const (
	MainViewSession   = "session"
	MainViewBookmarks = "bookmarks"
	MainViewHistory   = "history"
)

const (
	CmdStatusRunning  = "running"
	CmdStatusDetached = "detached"
	CmdStatusError    = "error"
	CmdStatusDone     = "done"
	CmdStatusHangup   = "hangup"
	CmdStatusWaiting  = "waiting"
)

const (
	CmdRendererOpenAI = "openai"
)

const (
	OpenAIRoleSystem    = "system"
	OpenAIRoleUser      = "user"
	OpenAIRoleAssistant = "assistant"
)

const (
	RemoteAuthTypeNone        = "none"
	RemoteAuthTypePassword    = "password"
	RemoteAuthTypeKey         = "key"
	RemoteAuthTypeKeyPassword = "key+password"
)

const (
	ShareModeLocal = "local"
	ShareModeWeb   = "web"
)

const (
	ConnectModeStartup = "startup"
	ConnectModeAuto    = "auto"
	ConnectModeManual  = "manual"
)

const (
	RemoteTypeSsh    = "ssh"
	RemoteTypeOpenAI = "openai"
)

const (
	ScreenFocusInput = "input"
	ScreenFocusCmd   = "cmd"
)

const (
	CmdStoreTypeSession = "session"
	CmdStoreTypeScreen  = "screen"
)

const (
	UpdateType_ScreenNew          = "screen:new"
	UpdateType_ScreenDel          = "screen:del"
	UpdateType_ScreenSelectedLine = "screen:selectedline"
	UpdateType_ScreenName         = "screen:sharename"
	UpdateType_LineNew            = "line:new"
	UpdateType_LineDel            = "line:del"
	UpdateType_LineRenderer       = "line:renderer"
	UpdateType_LineContentHeight  = "line:contentheight"
	UpdateType_CmdStatus          = "cmd:status"
	UpdateType_CmdTermOpts        = "cmd:termopts"
	UpdateType_CmdDoneInfo        = "cmd:doneinfo"
	UpdateType_CmdRtnState        = "cmd:rtnstate"
	UpdateType_PtyPos             = "pty:pos"
)

const MaxTzNameLen = 50

var globalDBLock = &sync.Mutex{}
var globalDB *sqlx.DB
var globalDBErr error

func GetDBName() string {
	scHome := scbase.GetPromptHomeDir()
	return path.Join(scHome, DBFileName)
}

func GetDBBackupName() string {
	scHome := scbase.GetPromptHomeDir()
	return path.Join(scHome, DBFileNameBackup)
}

func IsValidConnectMode(mode string) bool {
	return mode == ConnectModeStartup || mode == ConnectModeAuto || mode == ConnectModeManual
}

func GetDB(ctx context.Context) (*sqlx.DB, error) {
	if txwrap.IsTxWrapContext(ctx) {
		return nil, fmt.Errorf("cannot call GetDB from within a running transaction")
	}
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB == nil && globalDBErr == nil {
		dbName := GetDBName()
		globalDB, globalDBErr = sqlx.Open("sqlite3", fmt.Sprintf("file:%s?cache=shared&mode=rwc&_journal_mode=WAL&_busy_timeout=5000", dbName))
		if globalDBErr != nil {
			globalDBErr = fmt.Errorf("opening db[%s]: %w", dbName, globalDBErr)
			log.Printf("[db] error: %v\n", globalDBErr)
		} else {
			log.Printf("[db] successfully opened db %s\n", dbName)
		}
	}
	return globalDB, globalDBErr
}

func CloseDB() {
	globalDBLock.Lock()
	defer globalDBLock.Unlock()
	if globalDB == nil {
		return
	}
	err := globalDB.Close()
	if err != nil {
		log.Printf("[db] error closing database: %v\n", err)
	}
	globalDB = nil
}

type CmdPtr struct {
	ScreenId string
	CmdId    string
}

type ClientWinSizeType struct {
	Width      int  `json:"width"`
	Height     int  `json:"height"`
	Top        int  `json:"top"`
	Left       int  `json:"left"`
	FullScreen bool `json:"fullscreen,omitempty"`
}

type ActivityUpdate struct {
	FgMinutes     int
	ActiveMinutes int
	OpenMinutes   int
	NumCommands   int
	ClickShared   int
	HistoryView   int
	BookmarksView int
	NumConns      int
	WebShareLimit int
	BuildTime     string
}

type ActivityType struct {
	Day           string        `json:"day"`
	Uploaded      bool          `json:"-"`
	TData         TelemetryData `json:"tdata"`
	TzName        string        `json:"tzname"`
	TzOffset      int           `json:"tzoffset"`
	ClientVersion string        `json:"clientversion"`
	ClientArch    string        `json:"clientarch"`
	BuildTime     string        `json:"buildtime"`
	OSRelease     string        `json:"osrelease"`
}

type TelemetryData struct {
	NumCommands   int `json:"numcommands"`
	ActiveMinutes int `json:"activeminutes"`
	FgMinutes     int `json:"fgminutes"`
	OpenMinutes   int `json:"openminutes"`
	ClickShared   int `json:"clickshared,omitempty"`
	HistoryView   int `json:"historyview,omitempty"`
	BookmarksView int `json:"bookmarksview,omitempty"`
	NumConns      int `json:"numconns"`
	WebShareLimit int `json:"websharelimit,omitempty"`
}

func (tdata TelemetryData) Value() (driver.Value, error) {
	return quickValueJson(tdata)
}

func (tdata *TelemetryData) Scan(val interface{}) error {
	return quickScanJson(tdata, val)
}

type ClientOptsType struct {
	NoTelemetry bool  `json:"notelemetry,omitempty"`
	AcceptedTos int64 `json:"acceptedtos,omitempty"`
}

type FeOptsType struct {
	TermFontSize int `json:"termfontsize,omitempty"`
}

type ClientMigrationData struct {
	MigrationType  string `json:"migrationtype"`
	MigrationPos   int    `json:"migrationpos"`
	MigrationTotal int    `json:"migrationtotal"`
	MigrationDone  bool   `json:"migrationdone"`
}

type ClientData struct {
	ClientId            string               `json:"clientid"`
	UserId              string               `json:"userid"`
	UserPrivateKeyBytes []byte               `json:"-"`
	UserPublicKeyBytes  []byte               `json:"-"`
	UserPrivateKey      *ecdsa.PrivateKey    `json:"-" dbmap:"-"`
	UserPublicKey       *ecdsa.PublicKey     `json:"-" dbmap:"-"`
	ActiveSessionId     string               `json:"activesessionid"`
	WinSize             ClientWinSizeType    `json:"winsize"`
	ClientOpts          ClientOptsType       `json:"clientopts"`
	FeOpts              FeOptsType           `json:"feopts"`
	CmdStoreType        string               `json:"cmdstoretype"`
	Migration           *ClientMigrationData `json:"migration,omitempty" dbmap:"-"`
	DBVersion           int                  `json:"dbversion" dbmap:"-"`
	OpenAIOpts          *OpenAIOptsType      `json:"openaiopts,omitempty" dbmap:"openaiopts"`
}

func (ClientData) UseDBMap() {}

func (cdata *ClientData) Clean() *ClientData {
	if cdata == nil {
		return nil
	}
	rtn := *cdata
	if rtn.OpenAIOpts != nil {
		rtn.OpenAIOpts = &OpenAIOptsType{
			Model:      cdata.OpenAIOpts.Model,
			MaxTokens:  cdata.OpenAIOpts.MaxTokens,
			MaxChoices: cdata.OpenAIOpts.MaxChoices,
			// omit API Token
		}
		if cdata.OpenAIOpts.APIToken != "" {
			rtn.OpenAIOpts.APIToken = APITokenSentinel
		}
	}
	return &rtn
}

type SessionType struct {
	SessionId      string            `json:"sessionid"`
	Name           string            `json:"name"`
	SessionIdx     int64             `json:"sessionidx"`
	ActiveScreenId string            `json:"activescreenid"`
	ShareMode      string            `json:"sharemode"`
	NotifyNum      int64             `json:"notifynum"`
	Archived       bool              `json:"archived,omitempty"`
	ArchivedTs     int64             `json:"archivedts,omitempty"`
	Remotes        []*RemoteInstance `json:"remotes"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
	Full   bool `json:"full,omitempty"`
}

type SessionStatsType struct {
	SessionId          string              `json:"sessionid"`
	NumScreens         int                 `json:"numscreens"`
	NumArchivedScreens int                 `json:"numarchivedscreens"`
	NumLines           int                 `json:"numlines"`
	NumCmds            int                 `json:"numcmds"`
	DiskStats          SessionDiskSizeType `json:"diskstats"`
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

func (rptr *RemotePtrType) GetDisplayName(baseDisplayName string) string {
	name := baseDisplayName
	if rptr == nil {
		return name
	}
	if rptr.Name != "" {
		name = name + ":" + rptr.Name
	}
	if rptr.OwnerId != "" {
		name = "@" + rptr.OwnerId + ":" + name
	}
	return name
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

func (h *HistoryItemType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["historyid"] = h.HistoryId
	rtn["ts"] = h.Ts
	rtn["userid"] = h.UserId
	rtn["sessionid"] = h.SessionId
	rtn["screenid"] = h.ScreenId
	rtn["lineid"] = h.LineId
	rtn["linenum"] = h.LineNum
	rtn["haderror"] = h.HadError
	rtn["cmdid"] = h.CmdId
	rtn["cmdstr"] = h.CmdStr
	rtn["remoteownerid"] = h.Remote.OwnerId
	rtn["remoteid"] = h.Remote.RemoteId
	rtn["remotename"] = h.Remote.Name
	rtn["ismetacmd"] = h.IsMetaCmd
	rtn["incognito"] = h.Incognito
	return rtn
}

func (h *HistoryItemType) FromMap(m map[string]interface{}) bool {
	quickSetStr(&h.HistoryId, m, "historyid")
	quickSetInt64(&h.Ts, m, "ts")
	quickSetStr(&h.UserId, m, "userid")
	quickSetStr(&h.SessionId, m, "sessionid")
	quickSetStr(&h.ScreenId, m, "screenid")
	quickSetStr(&h.LineId, m, "lineid")
	quickSetBool(&h.HadError, m, "haderror")
	quickSetStr(&h.CmdId, m, "cmdid")
	quickSetStr(&h.CmdStr, m, "cmdstr")
	quickSetStr(&h.Remote.OwnerId, m, "remoteownerid")
	quickSetStr(&h.Remote.RemoteId, m, "remoteid")
	quickSetStr(&h.Remote.Name, m, "remotename")
	quickSetBool(&h.IsMetaCmd, m, "ismetacmd")
	quickSetStr(&h.HistoryNum, m, "historynum")
	quickSetInt64(&h.LineNum, m, "linenum")
	quickSetBool(&h.Incognito, m, "incognito")
	return true
}

type ScreenOptsType struct {
	TabColor string `json:"tabcolor,omitempty"`
	PTerm    string `json:"pterm,omitempty"`
}

type ScreenLinesType struct {
	ScreenId string      `json:"screenid"`
	Lines    []*LineType `json:"lines" dbmap:"-"`
	Cmds     []*CmdType  `json:"cmds" dbmap:"-"`
}

func (ScreenLinesType) UseDBMap() {}

type ScreenWebShareOpts struct {
	ShareName string `json:"sharename"`
	ViewKey   string `json:"viewkey"`
}

type ScreenCreateOpts struct {
	BaseScreenId string
	CopyRemote   bool
	CopyCwd      bool
	CopyEnv      bool
}

func (sco ScreenCreateOpts) HasCopy() bool {
	return sco.CopyRemote || sco.CopyCwd || sco.CopyEnv
}

type ScreenType struct {
	SessionId    string              `json:"sessionid"`
	ScreenId     string              `json:"screenid"`
	Name         string              `json:"name"`
	ScreenIdx    int64               `json:"screenidx"`
	ScreenOpts   ScreenOptsType      `json:"screenopts"`
	OwnerId      string              `json:"ownerid"`
	ShareMode    string              `json:"sharemode"`
	WebShareOpts *ScreenWebShareOpts `json:"webshareopts,omitempty"`
	CurRemote    RemotePtrType       `json:"curremote"`
	NextLineNum  int64               `json:"nextlinenum"`
	SelectedLine int64               `json:"selectedline"`
	Anchor       ScreenAnchorType    `json:"anchor"`
	FocusType    string              `json:"focustype"`
	Archived     bool                `json:"archived,omitempty"`
	ArchivedTs   int64               `json:"archivedts,omitempty"`

	// only for updates
	Full   bool `json:"full,omitempty"`
	Remove bool `json:"remove,omitempty"`
}

func (s *ScreenType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["sessionid"] = s.SessionId
	rtn["screenid"] = s.ScreenId
	rtn["name"] = s.Name
	rtn["screenidx"] = s.ScreenIdx
	rtn["screenopts"] = quickJson(s.ScreenOpts)
	rtn["ownerid"] = s.OwnerId
	rtn["sharemode"] = s.ShareMode
	rtn["webshareopts"] = quickNullableJson(s.WebShareOpts)
	rtn["curremoteownerid"] = s.CurRemote.OwnerId
	rtn["curremoteid"] = s.CurRemote.RemoteId
	rtn["curremotename"] = s.CurRemote.Name
	rtn["nextlinenum"] = s.NextLineNum
	rtn["selectedline"] = s.SelectedLine
	rtn["anchor"] = quickJson(s.Anchor)
	rtn["focustype"] = s.FocusType
	rtn["archived"] = s.Archived
	rtn["archivedts"] = s.ArchivedTs
	return rtn
}

func (s *ScreenType) FromMap(m map[string]interface{}) bool {
	quickSetStr(&s.SessionId, m, "sessionid")
	quickSetStr(&s.ScreenId, m, "screenid")
	quickSetStr(&s.Name, m, "name")
	quickSetInt64(&s.ScreenIdx, m, "screenidx")
	quickSetJson(&s.ScreenOpts, m, "screenopts")
	quickSetStr(&s.OwnerId, m, "ownerid")
	quickSetStr(&s.ShareMode, m, "sharemode")
	quickSetNullableJson(&s.WebShareOpts, m, "webshareopts")
	quickSetStr(&s.CurRemote.OwnerId, m, "curremoteownerid")
	quickSetStr(&s.CurRemote.RemoteId, m, "curremoteid")
	quickSetStr(&s.CurRemote.Name, m, "curremotename")
	quickSetInt64(&s.NextLineNum, m, "nextlinenum")
	quickSetInt64(&s.SelectedLine, m, "selectedline")
	quickSetJson(&s.Anchor, m, "anchor")
	quickSetStr(&s.FocusType, m, "focustype")
	quickSetBool(&s.Archived, m, "archived")
	quickSetInt64(&s.ArchivedTs, m, "archivedts")
	return true
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

type ScreenAnchorType struct {
	AnchorLine   int `json:"anchorline,omitempty"`
	AnchorOffset int `json:"anchoroffset,omitempty"`
}

type HistoryItemType struct {
	HistoryId string        `json:"historyid"`
	Ts        int64         `json:"ts"`
	UserId    string        `json:"userid"`
	SessionId string        `json:"sessionid"`
	ScreenId  string        `json:"screenid"`
	LineId    string        `json:"lineid"`
	HadError  bool          `json:"haderror"`
	CmdId     string        `json:"cmdid"`
	CmdStr    string        `json:"cmdstr"`
	Remote    RemotePtrType `json:"remote"`
	IsMetaCmd bool          `json:"ismetacmd"`
	Incognito bool          `json:"incognito,omitempty"`

	// only for updates
	Remove bool `json:"remove"`

	// transient (string because of different history orderings)
	HistoryNum string `json:"historynum"`
	LineNum    int64  `json:"linenum"`
}

type HistoryQueryOpts struct {
	Offset     int
	MaxItems   int
	FromTs     int64
	SearchText string
	SessionId  string
	RemoteId   string
	ScreenId   string
	NoMeta     bool
	RawOffset  int
	FilterFn   func(*HistoryItemType) bool
}

type HistoryQueryResult struct {
	MaxItems      int
	Items         []*HistoryItemType
	Offset        int // the offset shown to user
	RawOffset     int // internal offset
	HasMore       bool
	NextRawOffset int // internal offset used by pager for next query

	prevItems int // holds number of items skipped by RawOffset
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

type ShellStatePtr struct {
	BaseHash    string
	DiffHashArr []string
}

func (ssptr *ShellStatePtr) IsEmpty() bool {
	if ssptr == nil || ssptr.BaseHash == "" {
		return true
	}
	return false
}

type RemoteInstance struct {
	RIId             string            `json:"riid"`
	Name             string            `json:"name"`
	SessionId        string            `json:"sessionid"`
	ScreenId         string            `json:"screenid"`
	RemoteOwnerId    string            `json:"remoteownerid"`
	RemoteId         string            `json:"remoteid"`
	FeState          map[string]string `json:"festate"`
	StateBaseHash    string            `json:"-"`
	StateDiffHashArr []string          `json:"-"`

	// only for updates
	Remove bool `json:"remove,omitempty"`
}

type StateBase struct {
	BaseHash string
	Version  string
	Ts       int64
	Data     []byte
}

type StateDiff struct {
	DiffHash    string
	Ts          int64
	BaseHash    string
	DiffHashArr []string
	Data        []byte
}

func (sd *StateDiff) FromMap(m map[string]interface{}) bool {
	quickSetStr(&sd.DiffHash, m, "diffhash")
	quickSetInt64(&sd.Ts, m, "ts")
	quickSetStr(&sd.BaseHash, m, "basehash")
	quickSetJsonArr(&sd.DiffHashArr, m, "diffhasharr")
	quickSetBytes(&sd.Data, m, "data")
	return true
}

func (sd *StateDiff) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["diffhash"] = sd.DiffHash
	rtn["ts"] = sd.Ts
	rtn["basehash"] = sd.BaseHash
	rtn["diffhasharr"] = quickJsonArr(sd.DiffHashArr)
	rtn["data"] = sd.Data
	return rtn
}

func FeStateFromShellState(state *packet.ShellState) map[string]string {
	if state == nil {
		return nil
	}
	rtn := make(map[string]string)
	rtn["cwd"] = state.Cwd
	envMap := shexec.EnvMapFromState(state)
	if envMap["VIRTUAL_ENV"] != "" {
		rtn["VIRTUAL_ENV"] = envMap["VIRTUAL_ENV"]
	}
	for key, val := range envMap {
		if strings.HasPrefix(key, "PROMPTVAR_") {
			rtn[key] = val
		}
	}
	return rtn
}

func (ri *RemoteInstance) FromMap(m map[string]interface{}) bool {
	quickSetStr(&ri.RIId, m, "riid")
	quickSetStr(&ri.Name, m, "name")
	quickSetStr(&ri.SessionId, m, "sessionid")
	quickSetStr(&ri.ScreenId, m, "screenid")
	quickSetStr(&ri.RemoteOwnerId, m, "remoteownerid")
	quickSetStr(&ri.RemoteId, m, "remoteid")
	quickSetJson(&ri.FeState, m, "festate")
	quickSetStr(&ri.StateBaseHash, m, "statebasehash")
	quickSetJsonArr(&ri.StateDiffHashArr, m, "statediffhasharr")
	return true
}

func (ri *RemoteInstance) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["riid"] = ri.RIId
	rtn["name"] = ri.Name
	rtn["sessionid"] = ri.SessionId
	rtn["screenid"] = ri.ScreenId
	rtn["remoteownerid"] = ri.RemoteOwnerId
	rtn["remoteid"] = ri.RemoteId
	rtn["festate"] = quickJson(ri.FeState)
	rtn["statebasehash"] = ri.StateBaseHash
	rtn["statediffhasharr"] = quickJsonArr(ri.StateDiffHashArr)
	return rtn
}

type ScreenUpdateType struct {
	UpdateId   int64  `json:"updateid"`
	ScreenId   string `json:"screenid"`
	LineId     string `json:"lineid"`
	UpdateType string `json:"updatetype"`
	UpdateTs   int64  `json:"updatets"`
}

func (ScreenUpdateType) UseDBMap() {}

type LineType struct {
	ScreenId      string `json:"screenid"`
	UserId        string `json:"userid"`
	LineId        string `json:"lineid"`
	Ts            int64  `json:"ts"`
	LineNum       int64  `json:"linenum"`
	LineNumTemp   bool   `json:"linenumtemp,omitempty"`
	LineLocal     bool   `json:"linelocal"`
	LineType      string `json:"linetype"`
	Renderer      string `json:"renderer,omitempty"`
	Text          string `json:"text,omitempty"`
	CmdId         string `json:"cmdid,omitempty"`
	Ephemeral     bool   `json:"ephemeral,omitempty"`
	ContentHeight int64  `json:"contentheight,omitempty"`
	Star          bool   `json:"star,omitempty"`
	Archived      bool   `json:"archived,omitempty"`
	Remove        bool   `json:"remove,omitempty"`
}

type OpenAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type OpenAIChoiceType struct {
	Text         string `json:"text"`
	Index        int    `json:"index"`
	FinishReason string `json:"finish_reason"`
}

type OpenAIResponse struct {
	Model   string             `json:"model"`
	Created int64              `json:"created"`
	Usage   *OpenAIUsage       `json:"usage,omitempty"`
	Choices []OpenAIChoiceType `json:"choices,omitempty"`
}

type OpenAIPromptMessageType struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type PlaybookType struct {
	PlaybookId   string   `json:"playbookid"`
	PlaybookName string   `json:"playbookname"`
	Description  string   `json:"description"`
	EntryIds     []string `json:"entryids"`

	// this is not persisted to DB, just for transport to FE
	Entries []*PlaybookEntry `json:"entries"`
}

func (p *PlaybookType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["playbookid"] = p.PlaybookId
	rtn["playbookname"] = p.PlaybookName
	rtn["description"] = p.Description
	rtn["entryids"] = quickJsonArr(p.EntryIds)
	return rtn
}

func (p *PlaybookType) FromMap(m map[string]interface{}) bool {
	quickSetStr(&p.PlaybookId, m, "playbookid")
	quickSetStr(&p.PlaybookName, m, "playbookname")
	quickSetStr(&p.Description, m, "description")
	quickSetJsonArr(&p.Entries, m, "entries")
	return true
}

// reorders p.Entries to match p.EntryIds
func (p *PlaybookType) OrderEntries() {
	if len(p.Entries) == 0 {
		return
	}
	m := make(map[string]*PlaybookEntry)
	for _, entry := range p.Entries {
		m[entry.EntryId] = entry
	}
	newList := make([]*PlaybookEntry, 0, len(p.EntryIds))
	for _, entryId := range p.EntryIds {
		entry := m[entryId]
		if entry != nil {
			newList = append(newList, entry)
		}
	}
	p.Entries = newList
}

// removes from p.EntryIds (not from p.Entries)
func (p *PlaybookType) RemoveEntry(entryIdToRemove string) {
	if len(p.EntryIds) == 0 {
		return
	}
	newList := make([]string, 0, len(p.EntryIds)-1)
	for _, entryId := range p.EntryIds {
		if entryId == entryIdToRemove {
			continue
		}
		newList = append(newList, entryId)
	}
	p.EntryIds = newList
}

type PlaybookEntry struct {
	PlaybookId  string `json:"playbookid"`
	EntryId     string `json:"entryid"`
	Alias       string `json:"alias"`
	CmdStr      string `json:"cmdstr"`
	UpdatedTs   int64  `json:"updatedts"`
	CreatedTs   int64  `json:"createdts"`
	Description string `json:"description"`
	Remove      bool   `json:"remove,omitempty"`
}

type BookmarkType struct {
	BookmarkId  string   `json:"bookmarkid"`
	CreatedTs   int64    `json:"createdts"`
	CmdStr      string   `json:"cmdstr"`
	Alias       string   `json:"alias,omitempty"`
	Tags        []string `json:"tags"`
	Description string   `json:"description"`
	OrderIdx    int64    `json:"orderidx"`
	Remove      bool     `json:"remove,omitempty"`
}

func (bm *BookmarkType) GetSimpleKey() string {
	return bm.BookmarkId
}

func (bm *BookmarkType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["bookmarkid"] = bm.BookmarkId
	rtn["createdts"] = bm.CreatedTs
	rtn["cmdstr"] = bm.CmdStr
	rtn["alias"] = bm.Alias
	rtn["description"] = bm.Description
	rtn["tags"] = quickJsonArr(bm.Tags)
	return rtn
}

func (bm *BookmarkType) FromMap(m map[string]interface{}) bool {
	quickSetStr(&bm.BookmarkId, m, "bookmarkid")
	quickSetInt64(&bm.CreatedTs, m, "createdts")
	quickSetStr(&bm.Alias, m, "alias")
	quickSetStr(&bm.CmdStr, m, "cmdstr")
	quickSetStr(&bm.Description, m, "description")
	quickSetJsonArr(&bm.Tags, m, "tags")
	return true
}

type ResolveItem struct {
	Name   string
	Num    int
	Id     string
	Hidden bool
}

type SSHOpts struct {
	Local       bool   `json:"local,omitempty"`
	IsSudo      bool   `json:"issudo,omitempty"`
	SSHHost     string `json:"sshhost"`
	SSHUser     string `json:"sshuser"`
	SSHOptsStr  string `json:"sshopts,omitempty"`
	SSHIdentity string `json:"sshidentity,omitempty"`
	SSHPort     int    `json:"sshport,omitempty"`
	SSHPassword string `json:"sshpassword,omitempty"`
}

func (opts SSHOpts) GetAuthType() string {
	if opts.SSHPassword != "" && opts.SSHIdentity != "" {
		return RemoteAuthTypeKeyPassword
	}
	if opts.SSHIdentity != "" {
		return RemoteAuthTypeKey
	}
	if opts.SSHPassword != "" {
		return RemoteAuthTypePassword
	}
	return RemoteAuthTypeNone
}

type RemoteOptsType struct {
	Color string `json:"color"`
}

type OpenAIOptsType struct {
	Model      string `json:"model"`
	APIToken   string `json:"apitoken"`
	MaxTokens  int    `json:"maxtokens,omitempty"`
	MaxChoices int    `json:"maxchoices,omitempty"`
}

type RemoteType struct {
	RemoteId            string          `json:"remoteid"`
	RemoteType          string          `json:"remotetype"`
	RemoteAlias         string          `json:"remotealias"`
	RemoteCanonicalName string          `json:"remotecanonicalname"`
	RemoteOpts          *RemoteOptsType `json:"remoteopts"`
	LastConnectTs       int64           `json:"lastconnectts"`
	RemoteIdx           int64           `json:"remoteidx"`
	Archived            bool            `json:"archived"`

	// SSH fields
	Local       bool              `json:"local"`
	RemoteUser  string            `json:"remoteuser"`
	RemoteHost  string            `json:"remotehost"`
	ConnectMode string            `json:"connectmode"`
	AutoInstall bool              `json:"autoinstall"`
	SSHOpts     *SSHOpts          `json:"sshopts"`
	StateVars   map[string]string `json:"statevars"`

	// OpenAI fields
	OpenAIOpts *OpenAIOptsType `json:"openaiopts,omitempty"`
}

func (r *RemoteType) IsSudo() bool {
	return r.SSHOpts != nil && r.SSHOpts.IsSudo
}

func (r *RemoteType) GetName() string {
	if r.RemoteAlias != "" {
		return r.RemoteAlias
	}
	return r.RemoteCanonicalName
}

type CmdDoneInfo struct {
	Ts         int64 `json:"ts"`
	ExitCode   int64 `json:"exitcode"`
	DurationMs int64 `json:"durationms"`
}

type CmdMapType struct {
	SessionId string `json:"sessionid"`
	ScreenId  string `json:"screenid"`
	CmdId     string `json:"cmdid"`
}

type CmdType struct {
	ScreenId     string                     `json:"screenid"`
	CmdId        string                     `json:"cmdid"`
	Remote       RemotePtrType              `json:"remote"`
	CmdStr       string                     `json:"cmdstr"`
	RawCmdStr    string                     `json:"rawcmdstr"`
	FeState      map[string]string          `json:"festate"`
	StatePtr     ShellStatePtr              `json:"state"`
	TermOpts     TermOpts                   `json:"termopts"`
	OrigTermOpts TermOpts                   `json:"origtermopts"`
	Status       string                     `json:"status"`
	StartPk      *packet.CmdStartPacketType `json:"startpk,omitempty"`
	DoneInfo     *CmdDoneInfo               `json:"doneinfo,omitempty"`
	RunOut       []packet.PacketType        `json:"runout,omitempty"`
	RtnState     bool                       `json:"rtnstate,omitempty"`
	RtnStatePtr  ShellStatePtr              `json:"rtnstateptr,omitempty"`
	Remove       bool                       `json:"remove,omitempty"`
}

func (r *RemoteType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["remoteid"] = r.RemoteId
	rtn["remotetype"] = r.RemoteType
	rtn["remotealias"] = r.RemoteAlias
	rtn["remotecanonicalname"] = r.RemoteCanonicalName
	rtn["remoteuser"] = r.RemoteUser
	rtn["remotehost"] = r.RemoteHost
	rtn["connectmode"] = r.ConnectMode
	rtn["autoinstall"] = r.AutoInstall
	rtn["sshopts"] = quickJson(r.SSHOpts)
	rtn["remoteopts"] = quickJson(r.RemoteOpts)
	rtn["lastconnectts"] = r.LastConnectTs
	rtn["archived"] = r.Archived
	rtn["remoteidx"] = r.RemoteIdx
	rtn["local"] = r.Local
	rtn["statevars"] = quickJson(r.StateVars)
	rtn["openaiopts"] = quickJson(r.OpenAIOpts)
	return rtn
}

func (r *RemoteType) FromMap(m map[string]interface{}) bool {
	quickSetStr(&r.RemoteId, m, "remoteid")
	quickSetStr(&r.RemoteType, m, "remotetype")
	quickSetStr(&r.RemoteAlias, m, "remotealias")
	quickSetStr(&r.RemoteCanonicalName, m, "remotecanonicalname")
	quickSetStr(&r.RemoteUser, m, "remoteuser")
	quickSetStr(&r.RemoteHost, m, "remotehost")
	quickSetStr(&r.ConnectMode, m, "connectmode")
	quickSetBool(&r.AutoInstall, m, "autoinstall")
	quickSetJson(&r.SSHOpts, m, "sshopts")
	quickSetJson(&r.RemoteOpts, m, "remoteopts")
	quickSetInt64(&r.LastConnectTs, m, "lastconnectts")
	quickSetBool(&r.Archived, m, "archived")
	quickSetInt64(&r.RemoteIdx, m, "remoteidx")
	quickSetBool(&r.Local, m, "local")
	quickSetJson(&r.StateVars, m, "statevars")
	quickSetJson(&r.OpenAIOpts, m, "openaiopts")
	return true
}

func (cmd *CmdType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	rtn["screenid"] = cmd.ScreenId
	rtn["cmdid"] = cmd.CmdId
	rtn["remoteownerid"] = cmd.Remote.OwnerId
	rtn["remoteid"] = cmd.Remote.RemoteId
	rtn["remotename"] = cmd.Remote.Name
	rtn["cmdstr"] = cmd.CmdStr
	rtn["rawcmdstr"] = cmd.RawCmdStr
	rtn["festate"] = quickJson(cmd.FeState)
	rtn["statebasehash"] = cmd.StatePtr.BaseHash
	rtn["statediffhasharr"] = quickJsonArr(cmd.StatePtr.DiffHashArr)
	rtn["termopts"] = quickJson(cmd.TermOpts)
	rtn["origtermopts"] = quickJson(cmd.OrigTermOpts)
	rtn["status"] = cmd.Status
	rtn["startpk"] = quickJson(cmd.StartPk)
	rtn["doneinfo"] = quickJson(cmd.DoneInfo)
	rtn["runout"] = quickJson(cmd.RunOut)
	rtn["rtnstate"] = cmd.RtnState
	rtn["rtnbasehash"] = cmd.RtnStatePtr.BaseHash
	rtn["rtndiffhasharr"] = quickJsonArr(cmd.RtnStatePtr.DiffHashArr)
	return rtn
}

func (cmd *CmdType) FromMap(m map[string]interface{}) bool {
	quickSetStr(&cmd.ScreenId, m, "screenid")
	quickSetStr(&cmd.CmdId, m, "cmdid")
	quickSetStr(&cmd.Remote.OwnerId, m, "remoteownerid")
	quickSetStr(&cmd.Remote.RemoteId, m, "remoteid")
	quickSetStr(&cmd.Remote.Name, m, "remotename")
	quickSetStr(&cmd.CmdStr, m, "cmdstr")
	quickSetStr(&cmd.RawCmdStr, m, "rawcmdstr")
	quickSetJson(&cmd.FeState, m, "festate")
	quickSetStr(&cmd.StatePtr.BaseHash, m, "statebasehash")
	quickSetJsonArr(&cmd.StatePtr.DiffHashArr, m, "statediffhasharr")
	quickSetJson(&cmd.TermOpts, m, "termopts")
	quickSetJson(&cmd.OrigTermOpts, m, "origtermopts")
	quickSetStr(&cmd.Status, m, "status")
	quickSetJson(&cmd.StartPk, m, "startpk")
	quickSetJson(&cmd.DoneInfo, m, "doneinfo")
	quickSetJson(&cmd.RunOut, m, "runout")
	quickSetBool(&cmd.RtnState, m, "rtnstate")
	quickSetStr(&cmd.RtnStatePtr.BaseHash, m, "rtnbasehash")
	quickSetJsonArr(&cmd.RtnStatePtr.DiffHashArr, m, "rtndiffhasharr")
	return true
}

func makeNewLineCmd(screenId string, userId string, cmdId string, renderer string) *LineType {
	rtn := &LineType{}
	rtn.ScreenId = screenId
	rtn.UserId = userId
	rtn.LineId = scbase.GenPromptUUID()
	rtn.Ts = time.Now().UnixMilli()
	rtn.LineLocal = true
	rtn.LineType = LineTypeCmd
	rtn.CmdId = cmdId
	rtn.ContentHeight = LineNoHeight
	rtn.Renderer = renderer
	return rtn
}

func makeNewLineText(screenId string, userId string, text string) *LineType {
	rtn := &LineType{}
	rtn.ScreenId = screenId
	rtn.UserId = userId
	rtn.LineId = scbase.GenPromptUUID()
	rtn.Ts = time.Now().UnixMilli()
	rtn.LineLocal = true
	rtn.LineType = LineTypeText
	rtn.Text = text
	rtn.ContentHeight = LineNoHeight
	return rtn
}

func makeNewLineOpenAI(screenId string, userId string, cmdId string) *LineType {
	rtn := &LineType{}
	rtn.ScreenId = screenId
	rtn.UserId = userId
	rtn.LineId = scbase.GenPromptUUID()
	rtn.CmdId = cmdId
	rtn.Ts = time.Now().UnixMilli()
	rtn.LineLocal = true
	rtn.LineType = LineTypeOpenAI
	rtn.ContentHeight = LineNoHeight
	rtn.Renderer = CmdRendererOpenAI
	return rtn
}

func AddCommentLine(ctx context.Context, screenId string, userId string, commentText string) (*LineType, error) {
	rtnLine := makeNewLineText(screenId, userId, commentText)
	err := InsertLine(ctx, rtnLine, nil)
	if err != nil {
		return nil, err
	}
	return rtnLine, nil
}

func AddOpenAILine(ctx context.Context, screenId string, userId string, cmd *CmdType) (*LineType, error) {
	rtnLine := makeNewLineOpenAI(screenId, userId, cmd.CmdId)
	err := InsertLine(ctx, rtnLine, cmd)
	if err != nil {
		return nil, err
	}
	return rtnLine, nil
}

func AddCmdLine(ctx context.Context, screenId string, userId string, cmd *CmdType, renderer string) (*LineType, error) {
	rtnLine := makeNewLineCmd(screenId, userId, cmd.CmdId, renderer)
	err := InsertLine(ctx, rtnLine, cmd)
	if err != nil {
		return nil, err
	}
	return rtnLine, nil
}

func EnsureLocalRemote(ctx context.Context) error {
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
		RemoteId:            scbase.GenPromptUUID(),
		RemoteType:          RemoteTypeSsh,
		RemoteAlias:         LocalRemoteAlias,
		RemoteCanonicalName: fmt.Sprintf("%s@%s", user.Username, hostName),
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
	sudoRemote := &RemoteType{
		RemoteId:            scbase.GenPromptUUID(),
		RemoteType:          RemoteTypeSsh,
		RemoteAlias:         "sudo",
		RemoteCanonicalName: fmt.Sprintf("sudo@%s@%s", user.Username, hostName),
		RemoteUser:          "root",
		RemoteHost:          hostName,
		ConnectMode:         ConnectModeManual,
		AutoInstall:         true,
		SSHOpts:             &SSHOpts{Local: true, IsSudo: true},
		RemoteOpts:          &RemoteOptsType{Color: "red"},
		Local:               true,
	}
	err = UpsertRemote(ctx, sudoRemote)
	if err != nil {
		return err
	}
	log.Printf("[db] added sudo remote '%s', id=%s\n", sudoRemote.RemoteCanonicalName, sudoRemote.RemoteId)
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
		CmdStoreType:        CmdStoreTypeScreen,
	}
	query := `INSERT INTO client ( clientid, userid, activesessionid, userpublickeybytes, userprivatekeybytes, winsize) 
                          VALUES (:clientid,:userid,:activesessionid,:userpublickeybytes,:userprivatekeybytes,:winsize)`
	tx.NamedExec(query, dbutil.ToDBMap(c, false))
	log.Printf("create new clientid[%s] userid[%s] with public/private keypair\n", c.ClientId, c.UserId)
	return nil
}

func EnsureClientData(ctx context.Context) (*ClientData, error) {
	rtn, err := WithTxRtn(ctx, func(tx *TxWrap) (*ClientData, error) {
		query := `SELECT count(*) FROM client`
		count := tx.GetInt(query)
		if count > 1 {
			return nil, fmt.Errorf("invalid client database, multiple (%d) rows in client table", count)
		}
		if count == 0 {
			createErr := createClientData(tx)
			if createErr != nil {
				return nil, createErr
			}
		}
		cdata := dbutil.GetMappable[*ClientData](tx, `SELECT * FROM client`)
		if cdata == nil {
			return nil, fmt.Errorf("no client data found")
		}
		dbVersion := tx.GetInt(`SELECT version FROM schema_migrations`)
		cdata.DBVersion = dbVersion
		return cdata, nil
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
	return rtn, nil
}

func GetCmdMigrationInfo(ctx context.Context) (*ClientMigrationData, error) {
	return WithTxRtn(ctx, func(tx *TxWrap) (*ClientMigrationData, error) {
		cdata := dbutil.GetMappable[*ClientData](tx, `SELECT * FROM client`)
		if cdata == nil {
			return nil, fmt.Errorf("no client data found")
		}
		if cdata.CmdStoreType == "session" {
			total := tx.GetInt(`SELECT count(*) FROM cmd`)
			posInv := tx.GetInt(`SELECT count(*) FROM cmd_migrate`)
			mdata := &ClientMigrationData{
				MigrationType:  "cmdscreen",
				MigrationPos:   total - posInv,
				MigrationTotal: total,
				MigrationDone:  false,
			}
			return mdata, nil
		}
		// no migration info
		return nil, nil
	})
}

func SetClientOpts(ctx context.Context, clientOpts ClientOptsType) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE client SET clientopts = ?`
		tx.Exec(query, quickJson(clientOpts))
		return nil
	})
	return txErr
}

type cmdMigrationType struct {
	SessionId string
	ScreenId  string
	CmdId     string
}

func getSliceChunk[T any](slice []T, chunkSize int) ([]T, []T) {
	if chunkSize >= len(slice) {
		return slice, nil
	}
	return slice[0:chunkSize], slice[chunkSize:]
}

func processChunk(ctx context.Context, mchunk []cmdMigrationType) error {
	for _, mig := range mchunk {
		newFile, err := scbase.PtyOutFile(mig.ScreenId, mig.CmdId)
		if err != nil {
			log.Printf("ptyoutfile error: %v\n", err)
			continue
		}
		oldFile, err := scbase.PtyOutFile_Sessions(mig.SessionId, mig.CmdId)
		if err != nil {
			log.Printf("ptyoutfile_sessions error: %v\n", err)
			continue
		}
		err = os.Rename(oldFile, newFile)
		if err != nil {
			log.Printf("error renaming %s => %s: %v\n", oldFile, newFile, err)
			continue
		}
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		for _, mig := range mchunk {
			query := `DELETE FROM cmd_migrate WHERE cmdid = ?`
			tx.Exec(query, mig.CmdId)
		}
		return nil
	})
	if txErr != nil {
		return txErr
	}
	return nil
}

func RunCmdScreenMigration() {
	ctx := context.Background()
	startTime := time.Now()
	mdata, err := GetCmdMigrationInfo(ctx)
	if err != nil {
		log.Printf("[prompt] error trying to run cmd migration: %v\n", err)
		return
	}
	if mdata == nil || mdata.MigrationType != "cmdscreen" {
		return
	}
	var migrations []cmdMigrationType
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		tx.Select(&migrations, `SELECT * FROM cmd_migrate`)
		return nil
	})
	if txErr != nil {
		log.Printf("[prompt] error trying to get cmd migrations: %v\n", txErr)
		return
	}
	log.Printf("[db] got %d cmd migrations\n", len(migrations))
	for len(migrations) > 0 {
		var mchunk []cmdMigrationType
		mchunk, migrations = getSliceChunk(migrations, 5)
		err = processChunk(ctx, mchunk)
		if err != nil {
			log.Printf("[prompt] cmd migration failed on chunk: %v\n%#v\n", err, mchunk)
			return
		}
	}
	err = os.RemoveAll(scbase.GetSessionsDir())
	if err != nil {
		log.Printf("[db] cannot remove old sessions dir %s: %v\n", scbase.GetSessionsDir(), err)
	}
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE client SET cmdstoretype = 'screen'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		log.Printf("[db] cannot change client cmdstoretype: %v\n", err)
	}
	log.Printf("[db] cmd screen migration done: %v\n", time.Since(startTime))
	return
}
