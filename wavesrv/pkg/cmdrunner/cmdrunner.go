// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmdrunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kevinburke/ssh_config"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/server"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellenv"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellutil"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shexec"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/bookmarks"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/comp"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/ephemeral"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/history"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/pcloud"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/releasechecker"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/remote"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/remote/openai"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/rtnstate"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/telemetry"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/waveenc"
	"golang.org/x/mod/semver"
)

const (
	HistoryTypeScreen  = "screen"
	HistoryTypeSession = "session"
	HistoryTypeGlobal  = "global"
)

func init() {
	comp.RegisterSimpleCompFn(comp.CGTypeMeta, simpleCompMeta)
	comp.RegisterSimpleCompFn(comp.CGTypeCommandMeta, simpleCompCommandMeta)
}

const DefaultUserId = "user"
const MaxNameLen = 50
const MaxShareNameLen = 150
const MaxRendererLen = 50
const MaxRemoteAliasLen = 50
const PasswordUnchangedSentinel = "--unchanged--"
const DefaultPTERM = "MxM"
const MaxCommandLen = 4096
const MaxSignalLen = 12
const MaxSignalNum = 64
const MaxEvalDepth = 5
const MaxOpenAIAPITokenLen = 100
const MaxOpenAIModelLen = 100
const MaxSidebarSections = 5

const TermFontSizeMin = 8
const TermFontSizeMax = 24

const TsFormatStr = "2006-01-02 15:04:05"

const OpenAIPacketTimeout = 10 * 1000 * time.Millisecond
const OpenAIStreamTimeout = 5 * time.Minute
const OpenAICloudCompletionTelemetryOffErrorMsg = "To ensure responsible usage and prevent misuse, Wave AI requires telemetry to be enabled when using its free AI features.\n\nIf you prefer not to enable telemetry, you can still access Wave AI's features by providing your own OpenAI API key or AI Base URL in the Settings menu. Please note that when using your personal API key, requests will be sent directly to the OpenAI API or the API that you specified with the AI Base URL, without being proxied through Wave's servers.\n\nIf you wish to continue using Wave AI's free features, you can easily enable telemetry by running the '/telemetry:on' command in the terminal. This will allow you to access the free AI features while helping to protect the platform from abuse."

const (
	KwArgRenderer = "renderer"
	KwArgView     = "view"
	KwArgState    = "state"
	KwArgTemplate = "template"
	KwArgLang     = "lang"
	KwArgMinimap  = "minimap"
	KwArgNoHist   = "nohist"
	KwArgSudo     = "sudo"
)

var ColorNames = []string{"yellow", "blue", "pink", "mint", "cyan", "violet", "orange", "green", "red", "white"}
var TabIcons = []string{"square", "sparkle", "fire", "ghost", "cloud", "compass", "crown", "droplet", "graduation-cap", "heart", "file"}
var RemoteColorNames = []string{"red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"}
var RemoteSetArgs = []string{"alias", "connectmode", "key", "password", "autoinstall", "color"}
var ConfirmFlags = []string{"hideshellprompt"}
var SidebarNames = []string{"main"}
var ThemeSources = []string{"light", "dark", "system"}

var ScreenCmds = []string{"run", "comment", "cd", "cr", "clear", "sw", "reset", "signal", "chat"}
var NoHistCmds = []string{"_compgen", "line", "history", "_killserver"}
var GlobalCmds = []string{"session", "screen", "remote", "set", "client", "telemetry", "bookmark", "bookmarks"}

var SetVarNameMap map[string]string = map[string]string{
	"tabcolor": "screen.tabcolor",
	"tabicon":  "screen.tabicon",
	"pterm":    "screen.pterm",
	"anchor":   "screen.anchor",
	"focus":    "screen.focus",
	"line":     "screen.line",
	"index":    "screen.index",
}

var SetVarScopes = []SetVarScope{
	{ScopeName: "global", VarNames: []string{}},
	{ScopeName: "client", VarNames: []string{"telemetry"}},
	{ScopeName: "session", VarNames: []string{"name", "pos", "theme"}},
	{ScopeName: "screen", VarNames: []string{"name", "tabcolor", "tabicon", "pos", "pterm", "anchor", "focus", "line", "index", "theme"}},
	{ScopeName: "line", VarNames: []string{}},
	// connection = remote, remote = remoteinstance
	{ScopeName: "connection", VarNames: []string{"alias", "connectmode", "key", "password", "autoinstall", "color"}},
	{ScopeName: "remote", VarNames: []string{}},
}

var userHostRe = regexp.MustCompile(`^(sudo@)?([a-zA-Z0-9][a-zA-Z0-9._@\\-]*@)?([a-z0-9][a-z0-9.-]*)(?::([0-9]+))?$`)
var remoteAliasRe = regexp.MustCompile("^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
var genericNameRe = regexp.MustCompile("^[a-zA-Z][a-zA-Z0-9_ .()<>,/\"'\\[\\]{}=+$@!*-]*$")
var rendererRe = regexp.MustCompile("^[a-zA-Z][a-zA-Z0-9_.:-]*$")
var positionRe = regexp.MustCompile("^((S?\\+|E?-)?[0-9]+|(\\+|-|S|E))$")
var wsRe = regexp.MustCompile("\\s+")
var sigNameRe = regexp.MustCompile("^((SIG[A-Z0-9]+)|(\\d+))$")

type contextType string

var historyContextKey = contextType("history")
var depthContextKey = contextType("depth")

type SetVarScope struct {
	ScopeName string
	VarNames  []string
}

type historyContextType struct {
	LineId        string
	LineNum       int64
	RemotePtr     *sstore.RemotePtrType
	FeState       sstore.FeStateType
	InitialStatus string
}

type MetaCmdFnType = func(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error)
type MetaCmdEntryType struct {
	IsAlias bool
	Fn      MetaCmdFnType
}

var MetaCmdFnMap = make(map[string]MetaCmdEntryType)

func init() {
	registerCmdFn("run", RunCommand)
	registerCmdFn("eval", EvalCommand)
	registerCmdFn("comment", CommentCommand)
	registerCmdFn("cr", CrCommand)
	registerCmdFn("connect", CrCommand)
	registerCmdFn("_compgen", CompGenCommand)
	registerCmdFn("clear", ClearCommand)
	registerCmdFn("reset", RemoteResetCommand)
	registerCmdFn("reset:cwd", ResetCwdCommand)
	registerCmdFn("signal", SignalCommand)
	registerCmdFn("sync", SyncCommand)
	registerCmdFn("sleep", SleepCommand)

	registerCmdFn("mainview", MainViewCommand)

	registerCmdFn("session", SessionCommand)
	registerCmdFn("session:open", SessionOpenCommand)
	registerCmdAlias("session:new", SessionOpenCommand)
	registerCmdFn("session:set", SessionSetCommand)
	registerCmdFn("session:delete", SessionDeleteCommand)
	registerCmdFn("session:archive", SessionArchiveCommand)
	registerCmdFn("session:showall", SessionShowAllCommand)
	registerCmdFn("session:show", SessionShowCommand)
	registerCmdFn("session:openshared", SessionOpenSharedCommand)
	registerCmdFn("session:termtheme", TermSetThemeCommand)
	registerCmdFn("session:ensureone", SessionEnsureOneCommand)

	registerCmdFn("screen", ScreenCommand)
	registerCmdFn("screen:archive", ScreenArchiveCommand)
	registerCmdFn("screen:delete", ScreenDeleteCommand)
	registerCmdFn("screen:open", ScreenOpenCommand)
	registerCmdAlias("screen:new", ScreenOpenCommand)
	registerCmdFn("screen:set", ScreenSetCommand)
	registerCmdFn("screen:showall", ScreenShowAllCommand)
	registerCmdFn("screen:reset", ScreenResetCommand)
	registerCmdFn("screen:webshare", ScreenWebShareCommand)
	registerCmdFn("screen:reorder", ScreenReorderCommand)
	registerCmdFn("screen:show", ScreenShowCommand)
	registerCmdFn("screen:termtheme", TermSetThemeCommand)

	registerCmdAlias("remote", RemoteCommand)
	registerCmdFn("remote:show", RemoteShowCommand)
	registerCmdFn("remote:showall", RemoteShowAllCommand)
	registerCmdFn("remote:new", RemoteNewCommand)
	registerCmdFn("remote:archive", RemoteArchiveCommand)
	registerCmdFn("remote:set", RemoteSetCommand)
	registerCmdFn("remote:disconnect", RemoteDisconnectCommand)
	registerCmdFn("remote:connect", RemoteConnectCommand)
	registerCmdFn("remote:install", RemoteInstallCommand)
	registerCmdFn("remote:installcancel", RemoteInstallCancelCommand)
	registerCmdFn("remote:reset", RemoteResetCommand)
	registerCmdFn("remote:parse", RemoteConfigParseCommand)

	registerCmdFn("copyfile", CopyFileCommand)

	registerCmdFn("screen:resize", ScreenResizeCommand)

	registerCmdFn("line", LineCommand)
	registerCmdFn("line:show", LineShowCommand)
	registerCmdFn("line:star", LineStarCommand)
	registerCmdFn("line:bookmark", LineBookmarkCommand)
	registerCmdFn("line:pin", LinePinCommand)
	registerCmdFn("line:archive", LineArchiveCommand)
	registerCmdFn("line:delete", LineDeleteCommand)
	registerCmdFn("line:setheight", LineSetHeightCommand)
	registerCmdFn("line:view", LineViewCommand)
	registerCmdFn("line:set", LineSetCommand)
	registerCmdFn("line:restart", LineRestartCommand)
	registerCmdFn("line:minimize", LineMinimizeCommand)

	registerCmdFn("client", ClientCommand)
	registerCmdFn("client:show", ClientShowCommand)
	registerCmdFn("client:set", ClientSetCommand)
	registerCmdFn("client:notifyupdatewriter", ClientNotifyUpdateWriterCommand)
	registerCmdFn("client:accepttos", ClientAcceptTosCommand)
	registerCmdFn("client:setconfirmflag", ClientConfirmFlagCommand)
	registerCmdFn("client:setmainsidebar", ClientSetMainSidebarCommand)
	registerCmdFn("client:setrightsidebar", ClientSetRightSidebarCommand)
	registerCmdFn("client:setglobalshortcut", ClientSetGlobalShortcut)

	registerCmdFn("sidebar:open", SidebarOpenCommand)
	registerCmdFn("sidebar:close", SidebarCloseCommand)
	registerCmdFn("sidebar:add", SidebarAddCommand)
	registerCmdFn("sidebar:remove", SidebarRemoveCommand)

	registerCmdFn("telemetry", TelemetryCommand)
	registerCmdFn("telemetry:on", TelemetryOnCommand)
	registerCmdFn("telemetry:off", TelemetryOffCommand)
	registerCmdFn("telemetry:send", TelemetrySendCommand)
	registerCmdFn("telemetry:show", TelemetryShowCommand)

	registerCmdFn("releasecheck", ReleaseCheckCommand)
	registerCmdFn("releasecheck:autoon", ReleaseCheckOnCommand)
	registerCmdFn("releasecheck:autooff", ReleaseCheckOffCommand)

	registerCmdFn("history", HistoryCommand)
	registerCmdFn("history:viewall", HistoryViewAllCommand)
	registerCmdFn("history:purge", HistoryPurgeCommand)

	registerCmdFn("bookmarks:show", BookmarksShowCommand)

	registerCmdFn("bookmark:set", BookmarkSetCommand)
	registerCmdFn("bookmark:delete", BookmarkDeleteCommand)

	registerCmdFn("chat", OpenAICommand)

	registerCmdFn("_killserver", KillServerCommand)
	registerCmdFn("_dumpstate", DumpStateCommand)

	registerCmdFn("set", SetCommand)

	registerCmdFn("view:stat", ViewStatCommand)
	registerCmdFn("view:test", ViewTestCommand)

	registerCmdFn("edit:test", EditTestCommand)

	// CodeEditCommand is overloaded to do codeedit and codeview
	registerCmdFn("codeedit", CodeEditCommand)
	registerCmdFn("codeview", CodeEditCommand)

	registerCmdFn("imageview", ImageViewCommand)
	registerCmdFn("mdview", MarkdownViewCommand)
	registerCmdFn("markdownview", MarkdownViewCommand)
	registerCmdFn("pdfview", PdfViewCommand)
	registerCmdFn("mediaview", MediaViewCommand)

	registerCmdFn("csvview", CSVViewCommand)

	registerCmdFn("_debug:ri", DebugRemoteInstanceCommand)

	registerCmdFn("sudo:clear", ClearSudoCache)
}

func getValidCommands() []string {
	var rtn []string
	for key, val := range MetaCmdFnMap {
		if val.IsAlias {
			continue
		}
		rtn = append(rtn, "/"+key)
	}
	return rtn
}

func registerCmdFn(cmdName string, fn MetaCmdFnType) {
	MetaCmdFnMap[cmdName] = MetaCmdEntryType{Fn: fn}
}

func registerCmdAlias(cmdName string, fn MetaCmdFnType) {
	MetaCmdFnMap[cmdName] = MetaCmdEntryType{IsAlias: true, Fn: fn}
}

func GetCmdStr(pk *scpacket.FeCommandPacketType) string {
	if pk.MetaSubCmd == "" {
		return pk.MetaCmd
	}
	return pk.MetaCmd + ":" + pk.MetaSubCmd
}

func HandleCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	metaCmd := SubMetaCmd(pk.MetaCmd)
	var cmdName string
	if pk.MetaSubCmd == "" {
		cmdName = metaCmd
	} else {
		cmdName = fmt.Sprintf("%s:%s", pk.MetaCmd, pk.MetaSubCmd)
	}
	entry := MetaCmdFnMap[cmdName]
	if entry.Fn == nil {
		if MetaCmdFnMap[metaCmd].Fn != nil {
			return nil, fmt.Errorf("invalid /%s subcommand '%s'", metaCmd, pk.MetaSubCmd)
		}
		return nil, fmt.Errorf("invalid command '/%s', no handler", cmdName)
	}
	return entry.Fn(ctx, pk)
}

func firstArg(pk *scpacket.FeCommandPacketType) string {
	if len(pk.Args) == 0 {
		return ""
	}
	return pk.Args[0]
}

func argN(pk *scpacket.FeCommandPacketType, n int) string {
	if len(pk.Args) <= n {
		return ""
	}
	return pk.Args[n]
}

// will trim strings for whitespace
func resolveCommaSepListToMap(arg string) map[string]bool {
	if arg == "" {
		return nil
	}
	rtn := make(map[string]bool)
	fields := strings.Split(arg, ",")
	for _, field := range fields {
		field = strings.TrimSpace(field)
		rtn[field] = true
	}
	return rtn
}

func resolveShellType(shellArg string, defaultShell string) (string, error) {
	if shellArg == "" {
		if defaultShell == "" {
			shellArg = packet.ShellType_bash
		} else {
			shellArg = defaultShell
		}
	}
	if shellArg != packet.ShellType_bash && shellArg != packet.ShellType_zsh {
		return "", fmt.Errorf("invalid shell type %q", shellArg)
	}
	return shellArg, nil
}

func resolveBool(arg string, def bool) bool {
	if arg == "" {
		return def
	}
	if arg == "0" || arg == "false" {
		return false
	}
	return true
}

func defaultStr(arg string, def string) string {
	if arg == "" {
		return def
	}
	return arg
}

func resolveFile(arg string) (string, error) {
	if arg == "" {
		return "", nil
	}
	fileName := base.ExpandHomeDir(arg)
	if !strings.HasPrefix(fileName, "/") {
		return "", fmt.Errorf("must be absolute, cannot be a relative path")
	}
	fd, err := os.Open(fileName)
	if fd != nil {
		fd.Close()
	}
	if err != nil {
		return "", fmt.Errorf("cannot open file: %v", err)
	}
	return fileName, nil
}

func resolvePosInt(arg string, def int) (int, error) {
	if arg == "" {
		return def, nil
	}
	ival, err := strconv.Atoi(arg)
	if err != nil {
		return 0, err
	}
	if ival <= 0 {
		return 0, fmt.Errorf("must be greater than 0")
	}
	return ival, nil
}

func isAllDigits(arg string) bool {
	if len(arg) == 0 {
		return false
	}
	for i := 0; i < len(arg); i++ {
		if arg[i] >= '0' && arg[i] <= '9' {
			continue
		}
		return false
	}
	return true
}

func resolveNonNegInt(arg string, def int) (int, error) {
	if arg == "" {
		return def, nil
	}
	ival, err := strconv.Atoi(arg)
	if err != nil {
		return 0, err
	}
	if ival < 0 {
		return 0, fmt.Errorf("cannot be negative")
	}
	return ival, nil
}

var histExpansionRe = regexp.MustCompile(`^!(\d+)$`)

func doCmdHistoryExpansion(ctx context.Context, ids resolvedIds, cmdStr string) (string, error) {
	if !strings.HasPrefix(cmdStr, "!") {
		return "", nil
	}
	if strings.HasPrefix(cmdStr, "! ") {
		return "", nil
	}
	if cmdStr == "!!" {
		return doHistoryExpansion(ctx, ids, -1)
	}
	if strings.HasPrefix(cmdStr, "!-") {
		return "", fmt.Errorf("wave does not support negative history offsets, use a stable positive history offset instead: '![linenum]'")
	}
	m := histExpansionRe.FindStringSubmatch(cmdStr)
	if m == nil {
		return "", fmt.Errorf("unsupported history substitution, can use '!!' or '![linenum]'")
	}
	ival, err := strconv.Atoi(m[1])
	if err != nil {
		return "", fmt.Errorf("invalid history expansion")
	}
	return doHistoryExpansion(ctx, ids, ival)
}

func doHistoryExpansion(ctx context.Context, ids resolvedIds, hnum int) (string, error) {
	if hnum == 0 {
		return "", fmt.Errorf("invalid history expansion, cannot expand line number '0'")
	}
	if hnum < -1 {
		return "", fmt.Errorf("invalid history expansion, cannot expand negative history offsets")
	}
	foundHistoryNum := hnum
	if hnum == -1 {
		var err error
		foundHistoryNum, err = history.GetLastHistoryLineNum(ctx, ids.ScreenId)
		if err != nil {
			return "", fmt.Errorf("cannot expand history, error finding last history item: %v", err)
		}
		if foundHistoryNum == 0 {
			return "", fmt.Errorf("cannot expand history, no last history item")
		}
	}
	hitem, err := history.GetHistoryItemByLineNum(ctx, ids.ScreenId, foundHistoryNum)
	if err != nil {
		return "", fmt.Errorf("cannot get history item '%d': %v", foundHistoryNum, err)
	}
	if hitem == nil {
		return "", fmt.Errorf("cannot expand history, history item '%d' not found", foundHistoryNum)
	}
	return hitem.CmdStr, nil
}

func getEvalDepth(ctx context.Context) int {
	depthVal := ctx.Value(depthContextKey)
	if depthVal == nil {
		return 0
	}
	return depthVal.(int)
}

func SyncCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, fmt.Errorf("/sync error: %w", err)
	}
	runPacket := packet.MakeRunPacket()
	runPacket.ReqId = uuid.New().String()
	runPacket.CK = base.MakeCommandKey(ids.ScreenId, scbase.GenWaveUUID())
	runPacket.UsePty = true
	ptermVal := defaultStr(pk.Kwargs["wterm"], DefaultPTERM)
	runPacket.TermOpts, err = GetUITermOpts(pk.UIContext.WinSize, ptermVal)
	if err != nil {
		return nil, fmt.Errorf("/sync error, invalid 'wterm' value %q: %v", ptermVal, err)
	}
	runPacket.Command = ":"
	runPacket.ReturnState = true
	rcOpts := remote.RunCommandOpts{
		SessionId:     ids.SessionId,
		ScreenId:      ids.ScreenId,
		RemotePtr:     ids.Remote.RemotePtr,
		EphemeralOpts: &ephemeral.EphemeralRunOpts{TimeoutMs: ephemeral.DefaultEphemeralTimeoutMs},
	}
	_, callback, err := remote.RunCommand(ctx, rcOpts, runPacket)
	if callback != nil {
		defer callback()
	}
	if err != nil {
		return nil, err
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoMsg:   "syncing state",
		TimeoutMs: 2000,
	})
	return update, nil
}

func getRendererArg(pk *scpacket.FeCommandPacketType) (string, error) {
	rval := pk.Kwargs[KwArgView]
	if rval == "" {
		rval = pk.Kwargs[KwArgRenderer]
	}
	if rval == "" {
		return "", nil
	}
	err := validateRenderer(rval)
	if err != nil {
		return "", err
	}
	return rval, nil
}

func getTemplateArg(pk *scpacket.FeCommandPacketType) (string, error) {
	rval := pk.Kwargs[KwArgTemplate]
	if rval == "" {
		return "", nil
	}
	// TODO validate
	return rval, nil
}

func getLangArg(pk *scpacket.FeCommandPacketType) (string, error) {
	// TODO better error checking
	if len(pk.Kwargs[KwArgLang]) > 50 {
		return "", nil // TODO return error, don't fail silently
	}
	return pk.Kwargs[KwArgLang], nil
}

func RunCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, fmt.Errorf("/run error: %w", err)
	}
	renderer, err := getRendererArg(pk)
	if err != nil {
		return nil, fmt.Errorf("/run error, invalid view/renderer: %w", err)
	}
	templateArg, err := getTemplateArg(pk)
	if err != nil {
		return nil, fmt.Errorf("/run error, invalid template: %w", err)
	}
	langArg, err := getLangArg(pk)
	if err != nil {
		return nil, fmt.Errorf("/run error, invalid lang: %w", err)
	}

	cmdStr := firstArg(pk)
	expandedCmdStr, err := doCmdHistoryExpansion(ctx, ids, cmdStr)
	if err != nil {
		return nil, err
	}
	if expandedCmdStr != "" {
		newPk := scpacket.MakeFeCommandPacket()
		newPk.MetaCmd = "eval"
		newPk.Args = []string{expandedCmdStr}
		newPk.Kwargs = pk.Kwargs
		newPk.RawStr = pk.RawStr
		newPk.UIContext = pk.UIContext
		newPk.Interactive = pk.Interactive
		newPk.EphemeralOpts = pk.EphemeralOpts
		evalDepth := getEvalDepth(ctx)
		ctxWithDepth := context.WithValue(ctx, depthContextKey, evalDepth+1)
		return EvalCommand(ctxWithDepth, newPk)
	}
	isRtnStateCmd := IsReturnStateCommand(cmdStr)
	// runPacket.State is set in remote.RunCommand()
	runPacket := packet.MakeRunPacket()
	runPacket.ReqId = uuid.New().String()
	runPacket.CK = base.MakeCommandKey(ids.ScreenId, scbase.GenWaveUUID())
	runPacket.UsePty = true
	ptermVal := defaultStr(pk.Kwargs["wterm"], DefaultPTERM)
	runPacket.TermOpts, err = GetUITermOpts(pk.UIContext.WinSize, ptermVal)
	if err != nil {
		return nil, fmt.Errorf("/run error, invalid 'pterm' value %q: %v", ptermVal, err)
	}
	runPacket.Command = strings.TrimSpace(cmdStr)
	runPacket.ReturnState = resolveBool(pk.Kwargs["rtnstate"], isRtnStateCmd)
	if sudoArg, ok := pk.Kwargs[KwArgSudo]; ok {
		runPacket.IsSudo = resolveBool(sudoArg, false)
	} else {
		runPacket.IsSudo = IsSudoCommand(cmdStr)
	}
	rcOpts := remote.RunCommandOpts{
		SessionId:     ids.SessionId,
		ScreenId:      ids.ScreenId,
		RemotePtr:     ids.Remote.RemotePtr,
		EphemeralOpts: pk.EphemeralOpts,
	}
	cmd, callback, err := remote.RunCommand(ctx, rcOpts, runPacket)
	if callback != nil {
		defer callback()
	}
	if err != nil {
		return nil, err
	}
	cmd.RawCmdStr = pk.GetRawStr()
	lineState := make(map[string]any)
	if templateArg != "" {
		lineState[sstore.LineState_Template] = templateArg
	}
	if langArg != "" {
		lineState[sstore.LineState_Lang] = langArg
	}

	// If we are running an ephemeral command, we don't want to add the line to the screen
	if pk.EphemeralOpts == nil {
		update, err := addLineForCmd(ctx, "/run", true, ids, cmd, renderer, lineState)
		if err != nil {
			return nil, err
		}
		update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
		// this update is sent asynchronously for timing issues.  the cmd update comes async as well
		// so if we return this directly it sometimes gets evaluated first.  by pushing it on the MainBus
		// it ensures it happens after the command creation event.
		scbus.MainUpdateBus.DoScreenUpdate(ids.ScreenId, update)
	}
	return nil, nil
}

func implementRunInSidebar(ctx context.Context, screenId string, lineId string) (*sstore.ScreenType, error) {
	screen, err := sidebarSetOpen(ctx, "run", screenId, true, "")
	if err != nil {
		return nil, err
	}
	screen.ScreenViewOpts.Sidebar.SidebarLineId = lineId
	err = sstore.ScreenUpdateViewOpts(ctx, screenId, screen.ScreenViewOpts)
	if err != nil {
		return nil, fmt.Errorf("/run error updating screenviewopts: %v", err)
	}
	return screen, nil
}

func addToHistory(ctx context.Context, pk *scpacket.FeCommandPacketType, historyContext historyContextType, isMetaCmd bool, hadError bool) error {
	cmdStr := firstArg(pk)
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return err
	}
	hitem := &history.HistoryItemType{
		HistoryId: scbase.GenWaveUUID(),
		Ts:        time.Now().UnixMilli(),
		UserId:    DefaultUserId,
		SessionId: ids.SessionId,
		ScreenId:  ids.ScreenId,
		LineId:    historyContext.LineId,
		LineNum:   historyContext.LineNum,
		HadError:  hadError,
		CmdStr:    cmdStr,
		IsMetaCmd: isMetaCmd,
		FeState:   historyContext.FeState,
		Status:    historyContext.InitialStatus,
	}
	if hitem.Status == "" {
		if hadError {
			hitem.Status = sstore.CmdStatusError
		} else {
			hitem.Status = "done"
		}
	}
	if !isMetaCmd && historyContext.RemotePtr != nil {
		hitem.Remote = *historyContext.RemotePtr
	}
	err = history.InsertHistoryItem(ctx, hitem)
	if err != nil {
		return err
	}
	return nil
}

func EvalCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("usage: /eval [command], no command passed to eval")
	}
	if len(pk.Args[0]) > MaxCommandLen {
		return nil, fmt.Errorf("command length too long len:%d, max:%d", len(pk.Args[0]), MaxCommandLen)
	}
	evalDepth := getEvalDepth(ctx)
	if pk.Interactive && evalDepth == 0 {
		telemetry.UpdateActivityWrap(ctx, telemetry.ActivityUpdate{NumCommands: 1}, "numcommands")
	}
	if evalDepth > MaxEvalDepth {
		return nil, fmt.Errorf("alias/history expansion max-depth exceeded")
	}
	var historyContext historyContextType
	ctxWithHistory := context.WithValue(ctx, historyContextKey, &historyContext)
	var update scbus.UpdatePacket
	newPk, rtnErr := EvalMetaCommand(ctxWithHistory, pk)

	if rtnErr == nil {
		update, rtnErr = HandleCommand(ctxWithHistory, newPk)
	} else {
		return nil, fmt.Errorf("error in Eval Meta Command: %w", rtnErr)
	}
	if !resolveBool(pk.Kwargs[KwArgNoHist], false) {
		// TODO should this be "pk" or "newPk" (2nd arg)
		err := addToHistory(ctx, pk, historyContext, (newPk.MetaCmd != "run"), (rtnErr != nil))
		if err != nil {
			log.Printf("[error] adding to history: %v\n", err)
			// fall through (non-fatal error)
		}
	}
	var hasModelUpdate bool
	var modelUpdate *scbus.ModelUpdatePacketType
	if update == nil && newPk.EphemeralOpts == nil {
		// We don't want to serve an update if we are processing an ephemeral command
		hasModelUpdate = true
		modelUpdate = scbus.MakeUpdatePacket()
		update = modelUpdate
	} else if mu, ok := update.(*scbus.ModelUpdatePacketType); ok {
		hasModelUpdate = true
		modelUpdate = mu
	}
	if resolveBool(newPk.Kwargs["sidebar"], false) && historyContext.LineId != "" && hasModelUpdate {
		ids, resolveErr := resolveUiIds(ctx, newPk, R_Session|R_Screen)
		// we are ignoring resolveErr (if not nil).  obviously can't add to sidebar and
		// either another error already happened, or this command was never about the sidebar
		if resolveErr == nil {
			screen, sidebarErr := implementRunInSidebar(ctx, ids.ScreenId, historyContext.LineId)
			if sidebarErr == nil {
				sstore.AddScreenUpdate(modelUpdate, screen)
			} else {
				sstore.AddInfoMsgUpdateError(modelUpdate, fmt.Sprintf("cannot move command to sidebar: %v", sidebarErr))
			}
		}
	}
	return update, rtnErr
}

func ScreenArchiveCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session) // don't force R_Screen
	if err != nil {
		return nil, fmt.Errorf("/screen:archive cannot archive screen: %w", err)
	}
	screenId := ids.ScreenId
	if len(pk.Args) > 0 {
		ri, err := resolveSessionScreen(ctx, ids.SessionId, pk.Args[0], ids.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("/screen:archive cannot resolve screen arg: %v", err)
		}
		screenId = ri.Id
	}
	if screenId == "" {
		return nil, fmt.Errorf("/screen:archive no active screen or screen arg passed")
	}
	archiveVal := true
	if len(pk.Args) > 1 {
		archiveVal = resolveBool(pk.Args[1], true)
	}
	var update scbus.UpdatePacket
	if archiveVal {
		update, err = sstore.ArchiveScreen(ctx, ids.SessionId, screenId)
		if err != nil {
			return nil, err
		}
		return update, nil
	} else {
		log.Printf("unarchive screen %s\n", screenId)
		err = sstore.UnArchiveScreen(ctx, ids.SessionId, screenId)
		if err != nil {
			return nil, fmt.Errorf("/screen:archive cannot un-archive screen: %v", err)
		}
		screen, err := sstore.GetScreenById(ctx, screenId)
		if err != nil {
			return nil, fmt.Errorf("/screen:archive cannot get updated screen obj: %v", err)
		}
		update := scbus.MakeUpdatePacket()
		update.AddUpdate(*screen)
		return update, nil
	}
}

func ScreenDeleteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session) // don't force R_Screen
	if err != nil {
		return nil, fmt.Errorf("/screen:delete cannot delete screen: %w", err)
	}
	screenId := ids.ScreenId
	if len(pk.Args) > 0 {
		ri, err := resolveSessionScreen(ctx, ids.SessionId, pk.Args[0], ids.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("/screen:delete cannot resolve screen arg: %v", err)
		}
		screenId = ri.Id
	}
	if screenId == "" {
		return nil, fmt.Errorf("/screen:delete no active screen or screen arg passed")
	}
	runningCmds, err := sstore.GetRunningScreenCmds(ctx, screenId)
	if err != nil {
		return nil, fmt.Errorf("/screen:delete cannot get running cmds: %v", err)
	}
	for _, runningCmd := range runningCmds {
		// send SIGHUP to all running commands in this screen
		remote.SendSignalToCmd(ctx, runningCmd, "SIGHUP")
	}
	update, err := sstore.DeleteScreen(ctx, screenId, false, nil)
	if err != nil {
		return nil, err
	}
	return update, nil
}

func ScreenOpenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session)
	if err != nil {
		return nil, err
	}
	activate := resolveBool(pk.Kwargs["activate"], true)
	newName := pk.Kwargs["name"]
	if newName != "" {
		err := validateName(newName, "screen")
		if err != nil {
			return nil, err
		}
	}
	sco := sstore.ScreenCreateOpts{RtnScreenId: new(string)}
	update, err := sstore.InsertScreen(ctx, ids.SessionId, newName, sco, activate)
	if err != nil {
		return nil, err
	}
	if sco.RtnScreenId == nil {
		return nil, fmt.Errorf("error creating tab, no tab id returned")
	}
	uiContextCopy := *pk.UIContext
	uiContextCopy.ScreenId = *sco.RtnScreenId
	crUpdate, err := doNewTabConnectLocal(ctx, *sco.RtnScreenId, &uiContextCopy)
	if err != nil {
		return nil, err
	}
	update.Merge(crUpdate)
	return update, nil
}

func doNewTabConnectLocal(ctx context.Context, screenId string, uiContext *scpacket.UIContextType) (scbus.UpdatePacket, error) {
	crPk := scpacket.MakeFeCommandPacket()
	crPk.MetaCmd = "connect"
	crPk.Args = []string{"local"}
	crPk.RawStr = "/connect local"
	crPk.UIContext = uiContext
	crUpdate, err := CrCommand(ctx, crPk)
	if err != nil {
		return nil, fmt.Errorf("error creating tab, cannot connect to remote: %w", err)
	}
	return crUpdate, nil
}

func ScreenReorderCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	// Resolve the UI IDs for the session and screen
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}

	// Extract the screen ID and the new index from the packet
	screenId := ids.ScreenId
	newScreenIdxStr := pk.Kwargs["index"]
	newScreenIdx, err := resolvePosInt(newScreenIdxStr, 1)
	if err != nil {
		return nil, fmt.Errorf("invalid new screen index: %v", err)
	}

	// Call SetScreenIdx to update the screen's index in the database
	err = sstore.SetScreenIdx(ctx, ids.SessionId, screenId, newScreenIdx)
	if err != nil {
		return nil, fmt.Errorf("error updating screen index: %v", err)
	}

	// Retrieve all session screens
	screens, err := sstore.GetSessionScreens(ctx, ids.SessionId)
	if err != nil {
		return nil, fmt.Errorf("error retrieving updated screen: %v", err)
	}

	// Prepare the update packet to send back to the client
	update := scbus.MakeUpdatePacket()
	for _, screen := range screens {
		update.AddUpdate(*screen)
	}
	update.AddUpdate(sstore.InfoMsgType{
		InfoMsg:   "screen indices updated successfully",
		TimeoutMs: 2000,
	})

	return update, nil
}

var screenAnchorRe = regexp.MustCompile("^(\\d+)(?::(-?\\d+))?$")

func ScreenSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	var varsUpdated []string
	var setNonAnchor bool // anchor does not receive an update
	updateMap := make(map[string]interface{})
	if pk.Kwargs["name"] != "" {
		newName := pk.Kwargs["name"]
		err = validateName(newName, "screen")
		if err != nil {
			return nil, err
		}
		updateMap[sstore.ScreenField_Name] = newName
		varsUpdated = append(varsUpdated, "name")
		setNonAnchor = true
	}
	if pk.Kwargs["sharename"] != "" {
		shareName := pk.Kwargs["sharename"]
		err = validateShareName(shareName)
		if err != nil {
			return nil, err
		}
		updateMap[sstore.ScreenField_ShareName] = shareName
		varsUpdated = append(varsUpdated, "sharename")
		setNonAnchor = true
	}
	if pk.Kwargs["tabcolor"] != "" {
		color := pk.Kwargs["tabcolor"]
		err = validateColor(color, "screen tabcolor")
		if err != nil {
			return nil, err
		}
		updateMap[sstore.ScreenField_TabColor] = color
		varsUpdated = append(varsUpdated, "tabcolor")
		setNonAnchor = true
	}
	if pk.Kwargs["tabicon"] != "" {
		icon := pk.Kwargs["tabicon"]
		updateMap[sstore.ScreenField_TabIcon] = icon
		varsUpdated = append(varsUpdated, "tabicon")
		setNonAnchor = true
	}
	if pk.Kwargs["pos"] != "" {
		varsUpdated = append(varsUpdated, "pos")
		setNonAnchor = true
	}
	if pk.Kwargs["focus"] != "" {
		focusVal := pk.Kwargs["focus"]
		if focusVal != sstore.ScreenFocusInput && focusVal != sstore.ScreenFocusCmd {
			return nil, fmt.Errorf("/screen:set invalid focus argument %q, must be %s", focusVal, formatStrs([]string{sstore.ScreenFocusInput, sstore.ScreenFocusCmd}, "or", false))
		}
		varsUpdated = append(varsUpdated, "focus")
		updateMap[sstore.ScreenField_Focus] = focusVal
		setNonAnchor = true
	}
	if pk.Kwargs["line"] != "" {
		screen, err := sstore.GetScreenById(ctx, ids.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("/screen:set cannot get screen: %v", err)
		}
		var selectedLineStr string
		if screen.SelectedLine > 0 {
			selectedLineStr = strconv.Itoa(int(screen.SelectedLine))
		}
		ritem, err := resolveLine(ctx, screen.SessionId, screen.ScreenId, pk.Kwargs["line"], selectedLineStr)
		if err != nil {
			return nil, fmt.Errorf("/screen:set error resolving line: %v", err)
		}
		if ritem == nil {
			return nil, fmt.Errorf("/screen:set could not resolve line %q", pk.Kwargs["line"])
		}
		varsUpdated = append(varsUpdated, "line")
		setNonAnchor = true
		updateMap[sstore.ScreenField_SelectedLine] = ritem.Num
	}
	if pk.Kwargs["anchor"] != "" {
		m := screenAnchorRe.FindStringSubmatch(pk.Kwargs["anchor"])
		if m == nil {
			return nil, fmt.Errorf("/screen:set invalid anchor argument (must be [line] or [line]:[offset])")
		}
		anchorLine, _ := strconv.Atoi(m[1])
		varsUpdated = append(varsUpdated, "anchor")
		updateMap[sstore.ScreenField_AnchorLine] = anchorLine
		if m[2] != "" {
			anchorOffset, _ := strconv.Atoi(m[2])
			updateMap[sstore.ScreenField_AnchorOffset] = anchorOffset
		} else {
			updateMap[sstore.ScreenField_AnchorOffset] = 0
		}
	}
	if len(varsUpdated) == 0 {
		return nil, fmt.Errorf("/screen:set no updates, can set %s", formatStrs([]string{"name", "pos", "tabcolor", "tabicon", "focus", "anchor", "line", "sharename"}, "or", false))
	}
	screen, err := sstore.UpdateScreen(ctx, ids.ScreenId, updateMap)
	if err != nil {
		return nil, fmt.Errorf("error updating screen: %v", err)
	}
	if !setNonAnchor {
		return nil, nil
	}

	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*screen, sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("screen updated %s", formatStrs(varsUpdated, "and", false)),
		TimeoutMs: 2000,
	})
	return update, nil
}

func ScreenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session)
	if err != nil {
		return nil, fmt.Errorf("/screen cannot switch to screen: %w", err)
	}
	firstArg := firstArg(pk)
	if firstArg == "" {
		return nil, fmt.Errorf("usage /screen [screen-name|screen-index|screen-id], no param specified")
	}
	ritem, err := resolveSessionScreen(ctx, ids.SessionId, firstArg, ids.ScreenId)
	if err != nil {
		return nil, err
	}
	update, err := sstore.SwitchScreenById(ctx, ids.SessionId, ritem.Id)
	if err != nil {
		return nil, err
	}
	return update, nil
}

var sidebarWidthRe = regexp.MustCompile("^\\d+(px|%)$")

func sidebarSetOpen(ctx context.Context, cmdStr string, screenId string, open bool, width string) (*sstore.ScreenType, error) {
	if width != "" && !sidebarWidthRe.MatchString(width) {
		return nil, fmt.Errorf("/%s invalid width specified, must be either a px value or a percent (e.g. '300px' or '50%%')", cmdStr)
	}
	if strings.HasSuffix(width, "%") {
		percentNum, _ := strconv.Atoi(width[:len(width)-1])
		if percentNum < 10 || percentNum > 90 {
			return nil, fmt.Errorf("/%s invalid width specified, percentage must be between 10%% and 90%%", cmdStr)
		}
	}
	if strings.HasSuffix(width, "px") {
		pxNum, _ := strconv.Atoi(width[:len(width)-2])
		if pxNum < 200 {
			return nil, fmt.Errorf("/%s invalid width specified, minimum sizebar width is 200px", cmdStr)
		}
	}
	screen, err := sstore.GetScreenById(ctx, screenId)
	if err != nil {
		return nil, fmt.Errorf("/%s cannot get screen: %v", cmdStr, err)
	}
	if screen.ScreenViewOpts.Sidebar == nil {
		screen.ScreenViewOpts.Sidebar = &sstore.ScreenSidebarOptsType{}
	}
	screen.ScreenViewOpts.Sidebar.Open = open
	if width != "" {
		screen.ScreenViewOpts.Sidebar.Width = width
	}
	err = sstore.ScreenUpdateViewOpts(ctx, screenId, screen.ScreenViewOpts)
	if err != nil {
		return nil, fmt.Errorf("/%s error updating screenviewopts: %v", cmdStr, err)
	}
	return screen, nil
}

func SidebarOpenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Screen)
	if err != nil {
		return nil, err
	}
	screen, err := sidebarSetOpen(ctx, GetCmdStr(pk), ids.ScreenId, true, pk.Kwargs["width"])
	if err != nil {
		return nil, err
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*screen)
	return update, nil
}

func SidebarCloseCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Screen)
	if err != nil {
		return nil, err
	}
	screen, err := sidebarSetOpen(ctx, GetCmdStr(pk), ids.ScreenId, false, "")
	if err != nil {
		return nil, err
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*screen)
	return update, nil
}

func SidebarAddCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Screen)
	if err != nil {
		return nil, err
	}
	var addLineId string
	if lineArg, ok := pk.Kwargs["line"]; ok {
		lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
		if err != nil {
			return nil, fmt.Errorf("error looking up lineid: %v", err)
		}
		addLineId = lineId
	}
	if addLineId == "" {
		return nil, fmt.Errorf("/%s must specify line=[lineid] to add to the sidebar", GetCmdStr(pk))
	}
	screen, err := sidebarSetOpen(ctx, GetCmdStr(pk), ids.ScreenId, true, pk.Kwargs["width"])
	if err != nil {
		return nil, err
	}
	screen.ScreenViewOpts.Sidebar.SidebarLineId = addLineId
	err = sstore.ScreenUpdateViewOpts(ctx, ids.ScreenId, screen.ScreenViewOpts)
	if err != nil {
		return nil, fmt.Errorf("/%s error updating screenviewopts: %v", GetCmdStr(pk), err)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*screen)
	return update, nil
}

func SidebarRemoveCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Screen)
	if err != nil {
		return nil, err
	}
	screen, err := sstore.GetScreenById(ctx, ids.ScreenId)
	if err != nil {
		return nil, fmt.Errorf("/%s cannot get screeen: %v", GetCmdStr(pk), err)
	}
	sidebar := screen.ScreenViewOpts.Sidebar
	if sidebar == nil {
		return nil, nil
	}
	sidebar.SidebarLineId = ""
	sidebar.Open = false
	err = sstore.ScreenUpdateViewOpts(ctx, ids.ScreenId, screen.ScreenViewOpts)
	if err != nil {
		return nil, fmt.Errorf("/%s error updating screenviewopts: %v", GetCmdStr(pk), err)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*screen)
	return update, nil
}

func createRemoteViewRemoteIdUpdate(remoteId string) scbus.UpdatePacket {
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.RemoteViewType{
		PtyRemoteId: remoteId,
	})
	return update
}

func createRemoteViewRemoteEditUpdate(redit *sstore.RemoteEditType) scbus.UpdatePacket {
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.RemoteViewType{
		RemoteEdit: redit,
	})
	return update
}

func prettyPrintByteSize(size int64) string {
	gbSize := float64(size) / float64(1073741824)
	if gbSize > 1 {
		return fmt.Sprintf("%.2f Gigabytes", gbSize)
	}
	mbSize := float64(size) / float64(1048576)
	if mbSize > 1 {
		return fmt.Sprintf("%.2f Megabytes", mbSize)
	}
	kbSize := float64(size) / float64(1024)
	if kbSize > 1 {
		return fmt.Sprintf("%.2f Kilobytes", kbSize)
	}
	return fmt.Sprintf("%v Bytes", size)
}

// this can only be called in a defer func, because recover() only works inside of a defe
func deferWriteCmdStatus(ctx context.Context, cmd *sstore.CmdType, startTime time.Time, exitSuccess bool, outputPos int64) {
	r := recover()
	if r != nil {
		panicMsg := fmt.Sprintf("panic: %v", r)
		log.Printf("panic: %v\n", panicMsg)
		writeStringToPty(ctx, cmd, panicMsg, &outputPos)
	}
	duration := time.Since(startTime)
	cmdStatus := sstore.CmdStatusDone
	var exitCode int
	if !exitSuccess {
		cmdStatus = sstore.CmdStatusError
		exitCode = 1
	}
	ck := base.MakeCommandKey(cmd.ScreenId, cmd.LineId)
	doneInfo := sstore.CmdDoneDataValues{
		Ts:         time.Now().UnixMilli(),
		ExitCode:   exitCode,
		DurationMs: duration.Milliseconds(),
	}
	update := scbus.MakeUpdatePacket()
	err := sstore.UpdateCmdDoneInfo(context.Background(), update, ck, doneInfo, cmdStatus)
	if err != nil {
		// nothing to do
		log.Printf("error updating cmddoneinfo: %v\n", err)
		return
	}
	screen, err := sstore.UpdateScreenFocusForDoneCmd(ctx, cmd.ScreenId, cmd.LineId)
	if err != nil {
		log.Printf("error trying to update screen focus type: %v\n", err)
		// fall-through (nothing to do)
	}
	if screen != nil {
		update.AddUpdate(*screen)
	}
	scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
}

func checkForWriteReady(ctx context.Context, iter *packet.RpcResponseIter) (string, error) {
	readyIf, err := iter.Next(ctx)
	if err != nil {
		return "", fmt.Errorf("error getting write ready response: %v\r\n", err)
	}
	readyPk, ok := readyIf.(*packet.WriteFileReadyPacketType)
	if !ok {
		return "", fmt.Errorf("bad write ready packet received %v", readyIf)
	}
	if readyPk.Error != "" {
		return "", fmt.Errorf("ready error: %v", readyPk.Error)
	}
	return readyPk.RespId, nil
}

func checkForWriteFinished(ctx context.Context, iter *packet.RpcResponseIter) error {
	doneIf, err := iter.Next(ctx)
	if err != nil {
		return fmt.Errorf("error while getting done response: %v", err)
	}
	writeDonePk, ok := doneIf.(*packet.WriteFileDonePacketType)
	if !ok {
		return fmt.Errorf("bad done packet received: %T", doneIf)
	}
	if writeDonePk.Error != "" {
		return fmt.Errorf("done error: %v", writeDonePk.Error)
	}
	return nil
}

func doCopyLocalFileToRemote(ctx context.Context, cmd *sstore.CmdType, remote_msh *remote.MShellProc, localPath string, destPath string, outputPos int64) {
	var exitSuccess bool
	startTime := time.Now()
	defer func() {
		deferWriteCmdStatus(ctx, cmd, startTime, exitSuccess, outputPos)
	}()
	localFile, err := os.Open(localPath)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error, unable to open file %v: %v\r\n", localFile, localPath), &outputPos)
		return
	}
	defer localFile.Close()
	writePk := packet.MakeWriteFilePacket()
	writePk.ReqId = uuid.New().String()
	writePk.Path = destPath
	iter, err := remote_msh.WriteFile(ctx, writePk)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error starting file write: %v\r\n", err), &outputPos)
		return
	}
	defer iter.Close()
	_, err = checkForWriteReady(ctx, iter)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Write ready packet error: %v\r\n", err), &outputPos)
		return
	}
	fileStat, err := localFile.Stat()
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("error: could not get file stat: %v", err), &outputPos)
		return
	}
	fileSizeBytes := fileStat.Size()
	bytesWritten := int64(0)
	lastFileTransferPercentage := float64(0)
	fileTransferPercentage := float64(0)
	writeStringToPty(ctx, cmd, fmt.Sprintf("Source File Size: %s\r\n", prettyPrintByteSize(fileSizeBytes)), &outputPos)
	writeStringToPty(ctx, cmd, "[", &outputPos)
	var buffer [server.MaxFileDataPacketSize]byte
	bufSlice := buffer[:]
	for {
		dataPk := packet.MakeFileDataPacket(writePk.ReqId)
		bytesRead, err := io.ReadFull(localFile, bufSlice)
		if err == io.ErrUnexpectedEOF || err == io.EOF {
			dataPk.Eof = true
		} else if err != nil {
			dataErr := fmt.Sprintf("error reading file data: %v", err)
			dataPk.Error = dataErr
			remote_msh.SendFileData(dataPk)
			writeStringToPty(ctx, cmd, dataErr, &outputPos)
			return
		}
		if bytesRead > 0 {
			dataPk.Data = make([]byte, bytesRead)
			copy(dataPk.Data, bufSlice[0:bytesRead])
			bytesWritten += int64(len(dataPk.Data))
			fileTransferPercentage = float64(bytesWritten) / float64(fileSizeBytes)

			if fileTransferPercentage-lastFileTransferPercentage > float64(0.05) {
				writeStringToPty(ctx, cmd, "-", &outputPos)
				lastFileTransferPercentage = fileTransferPercentage
			}
		}
		remote_msh.SendFileData(dataPk)
		if dataPk.Eof {
			break
		}
	}
	err = checkForWriteFinished(ctx, iter)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Write finished packet error %v", err), &outputPos)
		return
	}
	writeStringToPty(ctx, cmd, "] done. \r\n", &outputPos)
	writeStringToPty(ctx, cmd, fmt.Sprintf("Finished transferring. Transferred %v bytes\r\n", fileSizeBytes), &outputPos)
	exitSuccess = true
}

func getStatusBarString(filePercentageInt int) string {
	statusBarString := "\x1b[2k\r["
	for count := 0; count < 20; count++ {
		if (filePercentageInt - count*5) > 0 {
			statusBarString += "-"
		} else {
			statusBarString += " "
		}
	}
	if filePercentageInt < 100 {
		statusBarString += fmt.Sprintf("] %v%%", filePercentageInt)
	} else {
		statusBarString += "]"
	}
	return statusBarString
}

func doCopyRemoteFileToRemote(ctx context.Context, cmd *sstore.CmdType, sourceMsh *remote.MShellProc, destMsh *remote.MShellProc, sourcePath string, destPath string, outputPos int64) {
	var exitSuccess bool
	startTime := time.Now()
	defer func() {
		deferWriteCmdStatus(ctx, cmd, startTime, exitSuccess, outputPos)
	}()
	streamPk := packet.MakeStreamFilePacket()
	streamPk.ReqId = uuid.New().String()
	streamPk.Path = sourcePath
	sourceStreamIter, err := sourceMsh.StreamFile(ctx, streamPk)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error getting file data packet: %v\r\n", err), &outputPos)
		return
	}
	defer sourceStreamIter.Close()
	respIf, err := sourceStreamIter.Next(ctx)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error getting next packet: %v\r\n", err), &outputPos)
		return
	}
	resp, ok := respIf.(*packet.StreamFileResponseType)
	if !ok {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error in getting packet response: %v\r\n", err), &outputPos)
		return
	}
	if resp == nil || resp.Error != "" {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Response packet has error: %v\r\n", err), &outputPos)
		return
	}
	fileSizeBytes := resp.Info.Size
	if fileSizeBytes == 0 {
		writeStringToPty(ctx, cmd, "Source file does not exist or is empty - exiting\r\n", &outputPos)
		return
	}
	writeStringToPty(ctx, cmd, fmt.Sprintf("Source File Size: %v\r\n", prettyPrintByteSize(fileSizeBytes)), &outputPos)
	writePk := packet.MakeWriteFilePacket()
	writePk.ReqId = uuid.New().String()
	writePk.Path = destPath
	destWriteIter, err := destMsh.WriteFile(ctx, writePk)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error starting file write: %v\r\n", err), &outputPos)
		return
	}
	defer destWriteIter.Close()
	_, err = checkForWriteReady(ctx, destWriteIter)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Write ready packet error: %v\r\n", err), &outputPos)
		return
	}
	bytesWritten := int64(0)
	lastFilePercentageInt := int(0)
	fileTransferPercentage := float64(0)
	writeStringToPty(ctx, cmd, "[", &outputPos)
	for {
		dataPkIf, err := sourceStreamIter.Next(ctx)
		if err != nil {
			log.Printf("error in read-file while getting data: %v\n", err)
			return
		}
		if dataPkIf == nil {
			break
		}
		dataPk, ok := dataPkIf.(*packet.FileDataPacketType)
		if !ok {
			writeStringToPty(ctx, cmd, fmt.Sprintf("error in read-file, invalid data packet type: %T\r\n", dataPkIf), &outputPos)
			return
		}
		if dataPk.Error != "" {
			writeStringToPty(ctx, cmd, fmt.Sprintf("in read-file, data packet error: %s\r\n", dataPk.Error), &outputPos)
			return
		}
		writeDataPk := packet.MakeFileDataPacket(writePk.ReqId)
		writeDataPk.Eof = dataPk.Eof
		writeDataPk.Error = dataPk.Error
		writeDataPk.Type = dataPk.Type
		writeDataPk.Data = make([]byte, int64(len(dataPk.Data)))
		copy(writeDataPk.Data, dataPk.Data)
		err = destMsh.SendFileData(writeDataPk)
		if err != nil {
			writeStringToPty(ctx, cmd, fmt.Sprintf("error sending file to dest: %v\r\n", err), &outputPos)
			return
		}
		bytesWritten += int64(len(dataPk.Data))
		fileTransferPercentage = float64(bytesWritten) / float64(fileSizeBytes)
		filePercentageInt := int(fileTransferPercentage * 100)
		if filePercentageInt-lastFilePercentageInt > 5 {
			statusBarString := getStatusBarString(filePercentageInt)
			writeStringToPty(ctx, cmd, statusBarString, &outputPos)
			lastFilePercentageInt = filePercentageInt
		}
	}
	err = checkForWriteFinished(ctx, destWriteIter)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("\r\nWrite finished packet error %v", err), &outputPos)
		return
	}
	writeStringToPty(ctx, cmd, getStatusBarString(100), &outputPos)
	writeStringToPty(ctx, cmd, " done. \r\n", &outputPos)
	writeStringToPty(ctx, cmd, fmt.Sprintf("Finished transferring. Transferred %v bytes\r\n", bytesWritten), &outputPos)
	exitSuccess = true
}

func doCopyLocalFileToLocal(ctx context.Context, cmd *sstore.CmdType, sourcePath string, destPath string, outputPos int64) {
	var exitSuccess bool
	var bytesWritten int64
	startTime := time.Now()
	defer func() {
		deferWriteCmdStatus(ctx, cmd, startTime, exitSuccess, outputPos)
	}()
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("error opening source file %v", err), &outputPos)
		return
	}
	defer sourceFile.Close()
	sourceFileStat, err := sourceFile.Stat()
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("error getting filestat %v", err), &outputPos)
		return
	}
	fileSizeBytes := sourceFileStat.Size()
	writeStringToPty(ctx, cmd, fmt.Sprintf("Source File Size: %v\r\n", prettyPrintByteSize(fileSizeBytes)), &outputPos)
	destFile, err := os.Create(destPath)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("error creating dest file %v", err), &outputPos)
		return
	}
	defer destFile.Close()
	bytesWritten, err = io.Copy(destFile, sourceFile)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("error copying files %v", err), &outputPos)
		return
	}
	writeStringToPty(ctx, cmd, fmt.Sprintf("Finished transferring. Transferred %v bytes\r\n", bytesWritten), &outputPos)
	exitSuccess = true
}

func doCopyRemoteFileToLocal(ctx context.Context, cmd *sstore.CmdType, remote_msh *remote.MShellProc, sourcePath string, localPath string, outputPos int64) {
	var exitSuccess bool
	startTime := time.Now()
	defer func() {
		deferWriteCmdStatus(ctx, cmd, startTime, exitSuccess, outputPos)
	}()
	streamPk := packet.MakeStreamFilePacket()
	streamPk.ReqId = uuid.New().String()
	streamPk.Path = sourcePath
	iter, err := remote_msh.StreamFile(ctx, streamPk)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error getting file data packet: %v\r\n", err), &outputPos)
		return
	}
	defer iter.Close()
	respIf, err := iter.Next(ctx)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error getting next packet: %v\r\n", err), &outputPos)
		return
	}
	resp, ok := respIf.(*packet.StreamFileResponseType)
	if !ok {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error in getting packet response: %v\r\n", err), &outputPos)
		return
	}
	if resp == nil || resp.Error != "" {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Response packet has error: %v\r\n", err), &outputPos)
		return
	}
	fileSizeBytes := resp.Info.Size
	if fileSizeBytes == 0 {
		writeStringToPty(ctx, cmd, "Source file doesn't exist or file is empty - exiting\r\n", &outputPos)
		return
	}
	writeStringToPty(ctx, cmd, fmt.Sprintf("Source File Size: %s\r\n", prettyPrintByteSize(fileSizeBytes)), &outputPos)
	localFile, err := os.Create(localPath)
	if err != nil {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Error creating file on local %v\r\n", err), &outputPos)
		return
	}
	defer localFile.Close()
	bytesWritten := int64(0)
	lastFileTransferPercentage := float64(0)
	fileTransferPercentage := float64(0)
	writeStringToPty(ctx, cmd, "[", &outputPos)
	for {
		dataPkIf, err := iter.Next(ctx)
		if err != nil {
			log.Printf("error in read-file while getting data: %v\n", err)
			return
		}
		if dataPkIf == nil {
			break
		}
		dataPk, ok := dataPkIf.(*packet.FileDataPacketType)
		if !ok {
			writeStringToPty(ctx, cmd, fmt.Sprintf("error in read-file, invalid data packet type: %T\r\n", dataPkIf), &outputPos)
			return
		}
		if dataPk.Error != "" {
			writeStringToPty(ctx, cmd, fmt.Sprintf("in read-file, data packet error: %s", dataPk.Error), &outputPos)
			return
		}
		localFile.Write(dataPk.Data)
		bytesWritten += int64(len(dataPk.Data))
		fileTransferPercentage = float64(bytesWritten) / float64(fileSizeBytes)

		if fileTransferPercentage-lastFileTransferPercentage > float64(0.05) {
			writeStringToPty(ctx, cmd, "-", &outputPos)
			lastFileTransferPercentage = fileTransferPercentage
		}
	}
	writeStringToPty(ctx, cmd, "] done. \r\n", &outputPos)
	writeStringToPty(ctx, cmd, fmt.Sprintf("Finished transferring. Transferred %v bytes\n", fileSizeBytes), &outputPos)
	exitSuccess = true
}

func writeStringToPty(ctx context.Context, cmd *sstore.CmdType, outputString string, outputPos *int64) {
	outBytes := []byte(outputString)
	update, err := sstore.AppendToCmdPtyBlob(ctx, cmd.ScreenId, cmd.LineId, outBytes, *outputPos)
	*outputPos += int64(len(outBytes))
	if err != nil {
		log.Printf("error writing to pty: %v", err)
	}
	scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
	err = sstore.SetStatusIndicatorLevel(ctx, cmd.ScreenId, sstore.StatusIndicatorLevel_Output, false)
	if err != nil {
		// This is not a fatal error, so just log it
		log.Printf("error setting status indicator level to output in writeStringToPty: %v\n", err)
	}
}

func parseCopyFileParam(info string) (remote string, path string, err error) {
	stringsList := strings.Split(info, ":")
	if len(stringsList) == 1 {
		// use cur remote
		return "", stringsList[0], nil
	} else if len(stringsList) == 2 {
		remote := strings.Trim(stringsList[0], "[] ")
		return remote, stringsList[1], nil
	} else {
		return "error", "error", fmt.Errorf("malformed arguments")
	}
}

func CopyFileCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("usage: /copyfile [file to copy] local=[path to copy to on local]")
	}
	ids, err := resolveUiIds(ctx, pk, R_Screen|R_Session|R_RemoteConnected)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve connected remote id: %v", err)
	}
	sourceInfo := pk.Args[0]
	sourceRemote, sourcePath, err := parseCopyFileParam(sourceInfo)
	var sourceRemoteId *ResolvedRemote
	var destRemoteId *ResolvedRemote
	if err != nil {
		return nil, fmt.Errorf("error: malformed arguments - usage: [remote]:path ")
	} else if sourceRemote == "" {
		// use cur remote
		sourceRemote = ConnectedRemote
		sourceRemoteId = ids.Remote
		if ids.Remote.RemoteCopy.IsLocal() {
			sourceRemote = LocalRemote
		}
	} else {
		pk.Kwargs["remote"] = sourceRemote
		sourceIds, err := resolveUiIds(ctx, pk, R_Remote)
		if err != nil {
			return nil, fmt.Errorf("error resolving remote id %v", err)
		}
		sourceRemoteId = sourceIds.Remote
	}
	destInfo := pk.Args[1]
	destRemote, destPath, err := parseCopyFileParam(destInfo)
	if err != nil {
		return nil, fmt.Errorf("error: malformed arguments - usage: [remote]:path ")
	} else if destRemote == "" {
		destRemote = ConnectedRemote
		destRemoteId = ids.Remote
		if ids.Remote.RemoteCopy.IsLocal() {
			destRemote = LocalRemote
		}
	} else {
		pk.Kwargs["remote"] = destRemote
		destIds, err := resolveUiIds(ctx, pk, R_Remote)
		if err != nil {
			return nil, fmt.Errorf("error resolving remote id %v", err)
		}
		destRemoteId = destIds.Remote
	}
	if destPath == "" {
		return nil, fmt.Errorf("error: malformed arguments - usage: [remote]:path ")
	}

	var sourceFullPath string
	var destFullPath string
	sourceMsh := sourceRemoteId.MShell
	if sourceMsh == nil {
		return nil, fmt.Errorf("failure getting source remote mshell")
	}
	sourceRRState := sourceMsh.GetRemoteRuntimeState()
	sourcePathWithHome, err := sourceRRState.ExpandHomeDir(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("expand home dir err: %v", err)
	}
	sourceFullPath = sourcePathWithHome
	if (sourceRemote == ConnectedRemote || sourceRemote == LocalRemote) && !filepath.IsAbs(sourcePathWithHome) && sourceRemoteId.FeState != nil {
		sourceCwd := sourceRemoteId.FeState["cwd"]
		if sourceCwd != "" {
			sourceFullPath = filepath.Join(sourceCwd, sourcePathWithHome)
		}
	}
	if destPath[len(destPath)-1:] == "/" {
		sourceFileName := filepath.Base(sourceFullPath)
		destPath = filepath.Join(destPath, sourceFileName)
	}
	destMsh := destRemoteId.MShell
	if destMsh == nil {
		return nil, fmt.Errorf("failure getting dest remote mshell")
	}
	destRRState := destMsh.GetRemoteRuntimeState()
	destPathWithHome, err := destRRState.ExpandHomeDir(destPath)
	if err != nil {
		return nil, fmt.Errorf("expand home dir err: %v", err)
	}
	destFullPath = destPathWithHome
	if (destRemote == ConnectedRemote || destRemote == LocalRemote) && !filepath.IsAbs(destPathWithHome) && destRemoteId.FeState != nil {
		destCwd := destRemoteId.FeState["cwd"]
		if destCwd != "" {
			destFullPath = filepath.Join(destCwd, destPathWithHome)
		}
	}
	var outputPos int64
	outputStr := fmt.Sprintf("Copying [%v]:%v to [%v]:%v\r\n", sourceRemoteId.DisplayName, sourceFullPath, destRemoteId.DisplayName, destFullPath)
	termOpts, err := GetUITermOpts(pk.UIContext.WinSize, DefaultPTERM)
	if err != nil {
		return nil, fmt.Errorf("cannot make termopts: %w", err)
	}
	pkTermOpts := convertTermOpts(termOpts)
	cmd, err := makeDynCmd(ctx, "copy file", ids, pk.GetRawStr(), *pkTermOpts, nil)
	writeStringToPty(ctx, cmd, outputStr, &outputPos)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update, err := addLineForCmd(ctx, "/copy file", false, ids, cmd, "", nil)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	if destRemote != ConnectedRemote && destRemoteId != nil && !destRemoteId.RState.IsConnected() {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Attempting to autoconnect to remote %v\r\n", destRemote), &outputPos)
		err = destRemoteId.MShell.TryAutoConnect()
		if err != nil {
			writeStringToPty(ctx, cmd, fmt.Sprintf("Couldn't connect to remote %v\r\n", sourceRemote), &outputPos)
		} else {
			writeStringToPty(ctx, cmd, "Auto connect successful\r\n", &outputPos)
		}
	}
	if sourceRemote != LocalRemote && sourceRemoteId != nil && !sourceRemoteId.RState.IsConnected() {
		writeStringToPty(ctx, cmd, fmt.Sprintf("Attempting to autoconnect to remote %v\r\n", sourceRemote), &outputPos)
		err = sourceRemoteId.MShell.TryAutoConnect()
		if err != nil {
			writeStringToPty(ctx, cmd, fmt.Sprintf("Couldn't connect to remote %v\r\n", sourceRemote), &outputPos)
		} else {
			writeStringToPty(ctx, cmd, "Auto connect successful\r\n", &outputPos)
		}
	}
	scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
	update = scbus.MakeUpdatePacket()
	if destRemote == LocalRemote && sourceRemote == LocalRemote {
		go doCopyLocalFileToLocal(context.Background(), cmd, sourceFullPath, destFullPath, outputPos)
	} else if destRemote == LocalRemote && sourceRemote != LocalRemote {
		go doCopyRemoteFileToLocal(context.Background(), cmd, sourceMsh, sourceFullPath, destFullPath, outputPos)
	} else if destRemote != LocalRemote && sourceRemote == LocalRemote {
		go doCopyLocalFileToRemote(context.Background(), cmd, destMsh, sourceFullPath, destFullPath, outputPos)
	} else if destRemote != LocalRemote && sourceRemote != LocalRemote {
		go doCopyRemoteFileToRemote(context.Background(), cmd, sourceMsh, destMsh, sourceFullPath, destFullPath, outputPos)
	}
	return update, nil
}

func RemoteInstallCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	mshell := ids.Remote.MShell
	go mshell.RunInstall(false)
	return createRemoteViewRemoteIdUpdate(ids.Remote.RemotePtr.RemoteId), nil
}

func RemoteInstallCancelCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	mshell := ids.Remote.MShell
	go mshell.CancelInstall()
	return createRemoteViewRemoteIdUpdate(ids.Remote.RemotePtr.RemoteId), nil
}

func RemoteConnectCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	go ids.Remote.MShell.Launch(true)
	return createRemoteViewRemoteIdUpdate(ids.Remote.RemotePtr.RemoteId), nil
}

func RemoteDisconnectCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	force := resolveBool(pk.Kwargs["force"], false)
	go ids.Remote.MShell.Disconnect(force)
	return createRemoteViewRemoteIdUpdate(ids.Remote.RemotePtr.RemoteId), nil
}

func makeRemoteEditUpdate_new(err error) scbus.UpdatePacket {
	redit := &sstore.RemoteEditType{
		RemoteEdit: true,
	}
	if err != nil {
		redit.ErrorStr = err.Error()
	}
	return createRemoteViewRemoteEditUpdate(redit)
}

func makeRemoteEditErrorReturn_new(visual bool, err error) (scbus.UpdatePacket, error) {
	if visual {
		return makeRemoteEditUpdate_new(err), nil
	}
	return nil, err
}

func makeRemoteEditUpdate_edit(ids resolvedIds, err error) scbus.UpdatePacket {
	redit := &sstore.RemoteEditType{
		RemoteEdit: true,
	}
	redit.RemoteId = ids.Remote.RemotePtr.RemoteId
	if ids.Remote.RemoteCopy.SSHOpts != nil {
		redit.KeyStr = ids.Remote.RemoteCopy.SSHOpts.SSHIdentity
		redit.HasPassword = (ids.Remote.RemoteCopy.SSHOpts.SSHPassword != "")
	}
	if err != nil {
		redit.ErrorStr = err.Error()
	}
	return createRemoteViewRemoteEditUpdate(redit)
}

func makeRemoteEditErrorReturn_edit(ids resolvedIds, visual bool, err error) (scbus.UpdatePacket, error) {
	if visual {
		return makeRemoteEditUpdate_edit(ids, err), nil
	}
	return nil, err
}

type RemoteEditArgs struct {
	CanonicalName string
	SSHOpts       *sstore.SSHOpts
	ConnectMode   string
	Alias         string
	AutoInstall   bool
	Color         string
	ShellPref     string
	EditMap       map[string]interface{}
}

func parseRemoteEditArgs(isNew bool, pk *scpacket.FeCommandPacketType, isLocal bool) (*RemoteEditArgs, error) {
	var canonicalName string
	var sshOpts *sstore.SSHOpts
	var isSudo bool

	if isNew {
		if len(pk.Args) == 0 {
			return nil, fmt.Errorf("/remote:new must specify user@host argument (set visual=1 to edit in UI)")
		}
		userHost := pk.Args[0]
		m := userHostRe.FindStringSubmatch(userHost)
		if m == nil {
			return nil, fmt.Errorf("invalid format of user@host argument")
		}
		sudoStr, remoteUser, remoteHost, remotePortStr := m[1], m[2], m[3], m[4]
		remoteUser = strings.Trim(remoteUser, "@")
		var uhPort int
		if remotePortStr != "" {
			var err error
			uhPort, err = strconv.Atoi(remotePortStr)
			if err != nil {
				return nil, fmt.Errorf("invalid port specified on user@host argument")
			}
		}
		if sudoStr != "" {
			isSudo = true
		}
		if pk.Kwargs["sudo"] != "" {
			sudoArg := resolveBool(pk.Kwargs["sudo"], false)
			if isSudo && !sudoArg {
				return nil, fmt.Errorf("invalid 'sudo' argument, with sudo kw arg set to false")
			}
			if !isSudo && sudoArg {
				isSudo = true
			}
		}
		sshOpts = &sstore.SSHOpts{
			Local:   false,
			SSHHost: remoteHost,
			SSHUser: remoteUser,
			IsSudo:  isSudo,
		}
		portVal, err := resolvePosInt(pk.Kwargs["port"], 0)
		if err != nil {
			return nil, fmt.Errorf("invalid port %q: %v", pk.Kwargs["port"], err)
		}
		if portVal != 0 && uhPort != 0 && portVal != uhPort {
			return nil, fmt.Errorf("invalid port argument, does not match port specified in 'user@host:port' argument")
		}
		if portVal == 0 && uhPort != 0 {
			portVal = uhPort
		}
		if portVal < 0 || portVal > 65535 {
			// 0 is used as a sentinel value for the default in this case
			return nil, fmt.Errorf("invalid port argument, \"%d\" is not in the range of 1 to 65535", portVal)
		}
		sshOpts.SSHPort = portVal
		if remoteUser == "" {
			canonicalName = remoteHost
		} else {
			canonicalName = remoteUser + "@" + remoteHost
		}
		if portVal != 0 && portVal != 22 {
			canonicalName = canonicalName + ":" + strconv.Itoa(portVal)
		}
		if isSudo {
			canonicalName = "sudo@" + canonicalName
		}
	} else {
		if pk.Kwargs["sudo"] != "" {
			return nil, fmt.Errorf("cannot update 'sudo' value")
		}
		if pk.Kwargs["port"] != "" {
			return nil, fmt.Errorf("cannot update 'port' value")
		}
	}
	alias := pk.Kwargs["alias"]
	if alias != "" {
		if len(alias) > MaxRemoteAliasLen {
			return nil, fmt.Errorf("alias too long, max length = %d", MaxRemoteAliasLen)
		}
		if !remoteAliasRe.MatchString(alias) {
			return nil, fmt.Errorf("invalid alias format")
		}
	}
	var shellPref string
	if isNew {
		shellPref = sstore.ShellTypePref_Detect
	}
	if pk.Kwargs["shellpref"] != "" {
		shellPref = pk.Kwargs["shellpref"]
	}
	if shellPref != "" && shellPref != packet.ShellType_bash && shellPref != packet.ShellType_zsh && shellPref != sstore.ShellTypePref_Detect {
		return nil, fmt.Errorf("invalid shellpref %q, must be %s", shellPref, formatStrs([]string{packet.ShellType_bash, packet.ShellType_zsh, sstore.ShellTypePref_Detect}, "or", false))
	}
	var connectMode string
	if isNew {
		connectMode = sstore.ConnectModeAuto
	}
	if pk.Kwargs["connectmode"] != "" {
		connectMode = pk.Kwargs["connectmode"]
	}
	if connectMode != "" && !sstore.IsValidConnectMode(connectMode) {
		err := fmt.Errorf("invalid connectmode %q: valid modes are %s", connectMode, formatStrs([]string{sstore.ConnectModeStartup, sstore.ConnectModeAuto, sstore.ConnectModeManual}, "or", false))
		return nil, err
	}
	keyFile, err := resolveFile(pk.Kwargs["key"])
	if err != nil {
		return nil, fmt.Errorf("invalid ssh keyfile %q: %v", pk.Kwargs["key"], err)
	}
	color := pk.Kwargs["color"]
	if color != "" {
		err := validateRemoteColor(color, "remote color")
		if err != nil {
			return nil, err
		}
	}
	sshPassword := pk.Kwargs["password"]
	if sshOpts != nil {
		sshOpts.SSHIdentity = keyFile
		sshOpts.SSHPassword = sshPassword
	}

	// set up editmap
	editMap := make(map[string]interface{})
	if _, found := pk.Kwargs[sstore.RemoteField_Alias]; found {
		editMap[sstore.RemoteField_Alias] = alias
	}
	if connectMode != "" {
		if isLocal {
			return nil, fmt.Errorf("Cannot edit connect mode for 'local' remote")
		}
		editMap[sstore.RemoteField_ConnectMode] = connectMode
	}
	if _, found := pk.Kwargs["key"]; found {
		if isLocal {
			return nil, fmt.Errorf("Cannot edit ssh key file for 'local' remote")
		}
		editMap[sstore.RemoteField_SSHKey] = keyFile
	}
	if _, found := pk.Kwargs[sstore.RemoteField_Color]; found {
		editMap[sstore.RemoteField_Color] = color
	}
	if _, found := pk.Kwargs["password"]; found && pk.Kwargs["password"] != PasswordUnchangedSentinel {
		if isLocal {
			return nil, fmt.Errorf("Cannot edit ssh password for 'local' remote")
		}
		editMap[sstore.RemoteField_SSHPassword] = sshPassword
	}
	if _, found := pk.Kwargs["shellpref"]; found {
		editMap[sstore.RemoteField_ShellPref] = shellPref
	}

	return &RemoteEditArgs{
		SSHOpts:       sshOpts,
		ConnectMode:   connectMode,
		Alias:         alias,
		AutoInstall:   true,
		CanonicalName: canonicalName,
		Color:         color,
		EditMap:       editMap,
		ShellPref:     shellPref,
	}, nil
}

func RemoteNewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	visualEdit := resolveBool(pk.Kwargs["visual"], false)
	isSubmitted := resolveBool(pk.Kwargs["submit"], false)
	if visualEdit && !isSubmitted && len(pk.Args) == 0 {
		return makeRemoteEditUpdate_new(nil), nil
	}
	editArgs, err := parseRemoteEditArgs(true, pk, false)
	if err != nil {
		return nil, fmt.Errorf("/remote:new %v", err)
	}
	r := &sstore.RemoteType{
		RemoteId:            scbase.GenWaveUUID(),
		RemoteType:          sstore.RemoteTypeSsh,
		RemoteAlias:         editArgs.Alias,
		RemoteCanonicalName: editArgs.CanonicalName,
		RemoteUser:          editArgs.SSHOpts.SSHUser,
		RemoteHost:          editArgs.SSHOpts.SSHHost,
		ConnectMode:         editArgs.ConnectMode,
		AutoInstall:         editArgs.AutoInstall,
		SSHOpts:             editArgs.SSHOpts,
		SSHConfigSrc:        sstore.SSHConfigSrcTypeManual,
		ShellPref:           editArgs.ShellPref,
	}
	if editArgs.Color != "" {
		r.RemoteOpts = &sstore.RemoteOptsType{Color: editArgs.Color}
	}
	err = remote.AddRemote(ctx, r, true)
	if err != nil {
		return nil, fmt.Errorf("cannot create remote %q: %v", r.RemoteCanonicalName, err)
	}
	// SUCCESS
	return createRemoteViewRemoteIdUpdate(r.RemoteId), nil
}

func RemoteSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	visualEdit := resolveBool(pk.Kwargs["visual"], false)
	isSubmitted := resolveBool(pk.Kwargs["submit"], false)
	editArgs, err := parseRemoteEditArgs(false, pk, ids.Remote.MShell.IsLocal())
	if err != nil {
		return makeRemoteEditErrorReturn_edit(ids, visualEdit, fmt.Errorf("/remote:new %v", err))
	}
	if visualEdit && !isSubmitted && len(editArgs.EditMap) == 0 {
		return makeRemoteEditUpdate_edit(ids, nil), nil
	}
	if !visualEdit && len(editArgs.EditMap) == 0 {
		return nil, fmt.Errorf("/remote:set no updates, can set %s.  (set visual=1 to edit in UI)", formatStrs(RemoteSetArgs, "or", false))
	}
	err = ids.Remote.MShell.UpdateRemote(ctx, editArgs.EditMap)
	if err != nil {
		return makeRemoteEditErrorReturn_edit(ids, visualEdit, fmt.Errorf("/remote:new error updating remote: %v", err))
	}
	if visualEdit {
		return createRemoteViewRemoteIdUpdate(ids.Remote.RemoteCopy.RemoteId), nil
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("remote %q updated", ids.Remote.DisplayName),
		TimeoutMs: 2000,
	})
	return update, nil
}

func RemoteShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	state := ids.Remote.RState
	return createRemoteViewRemoteIdUpdate(state.RemoteId), nil
}

func RemoteShowAllCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	stateArr := remote.GetAllRemoteRuntimeState()
	var buf bytes.Buffer
	for _, rstate := range stateArr {
		var name string
		if rstate.RemoteAlias == "" {
			name = rstate.RemoteCanonicalName
		} else {
			name = fmt.Sprintf("%s (%s)", rstate.RemoteCanonicalName, rstate.RemoteAlias)
		}
		buf.WriteString(fmt.Sprintf("%-12s %-5s %8s  %s\n", rstate.Status, rstate.RemoteType, rstate.RemoteId[0:8], name))
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.RemoteViewType{
		RemoteShowAll: true,
	})
	return update, nil
}

func resolveSshConfigPatterns(configFiles []string) ([]string, error) {
	// using two separate containers to track order and have O(1) lookups
	// since go does not have an ordered map primitive
	var discoveredPatterns []string
	alreadyUsed := make(map[string]bool)
	alreadyUsed[""] = true // this excludes the empty string from potential alias
	var openedFiles []fs.File

	defer func() {
		for _, openedFile := range openedFiles {
			openedFile.Close()
		}
	}()

	var errs []error
	for _, configFile := range configFiles {
		fd, openErr := os.Open(configFile)
		openedFiles = append(openedFiles, fd)
		if fd == nil {
			errs = append(errs, openErr)
			continue
		}

		cfg, _ := ssh_config.Decode(fd)
		for _, host := range cfg.Hosts {
			// for each host, find the first good alias
			for _, hostPattern := range host.Patterns {
				hostPatternStr := hostPattern.String()
				if strings.Index(hostPatternStr, "*") == -1 || alreadyUsed[hostPatternStr] == true {
					discoveredPatterns = append(discoveredPatterns, hostPatternStr)
					alreadyUsed[hostPatternStr] = true
					break
				}
			}
		}
	}
	if len(errs) == len(configFiles) {
		errs = append([]error{fmt.Errorf("no ssh config files could be opened:\n")}, errs...)
		return nil, errors.Join(errs...)
	}
	if len(discoveredPatterns) == 0 {
		return nil, fmt.Errorf("no compatible hostnames found in ssh config files")
	}

	return discoveredPatterns, nil
}

type HostInfoType struct {
	Host          string
	User          string
	CanonicalName string
	Port          int
	SshKeyFile    string
	ConnectMode   string
	Ignore        bool
	ShellPref     string
}

func createSshImportSummary(changeList map[string][]string) string {
	totalNumChanges := len(changeList["create"]) + len(changeList["delete"]) + len(changeList["update"]) + len(changeList["createErr"]) + len(changeList["deleteErr"]) + len(changeList["updateErr"])
	if totalNumChanges == 0 {
		return "No changes made from ssh config import"
	}
	remoteStatusMsgs := map[string]string{
		"delete":    "Deleted %d connection%s: %s",
		"create":    "Created %d connection%s: %s",
		"update":    "Edited %d connection%s: %s",
		"deleteErr": "Error deleting %d connection%s: %s",
		"createErr": "Error creating %d connection%s: %s",
		"updateErr": "Error editing %d connection%s: %s",
	}

	changeTypeKeys := []string{"delete", "create", "update", "deleteErr", "createErr", "updateErr"}

	var outMsgs []string
	for _, changeTypeKey := range changeTypeKeys {
		changes := changeList[changeTypeKey]
		if len(changes) > 0 {
			rawStatusMsg := remoteStatusMsgs[changeTypeKey]
			var pluralize string
			if len(changes) == 1 {
				pluralize = ""
			} else {
				pluralize = "s"
			}
			newMsg := fmt.Sprintf(rawStatusMsg, len(changes), pluralize, strings.Join(changes, ", "))
			outMsgs = append(outMsgs, newMsg)
		}
	}

	var pluralize string
	if totalNumChanges == 1 {
		pluralize = ""
	} else {
		pluralize = "s"
	}
	return fmt.Sprintf("%d connection%s changed:\n\n%s", totalNumChanges, pluralize, strings.Join(outMsgs, "\n\n"))
}

func NewHostInfo(hostName string) (*HostInfoType, error) {
	userName, _ := ssh_config.GetStrict(hostName, "User")
	var canonicalName string
	if userName != "" {
		canonicalName = userName + "@" + hostName
	} else {
		canonicalName = hostName
	}

	// check if canonicalname is okay
	m := userHostRe.FindStringSubmatch(canonicalName)
	if m == nil {
		return nil, fmt.Errorf("could not parse \"%s\" - %s did not fit user@host requirement", hostName, canonicalName)
	}

	portStr, _ := ssh_config.GetStrict(hostName, "Port")
	var portVal int
	if portStr != "" && portStr != "22" {
		canonicalName = canonicalName + ":" + portStr
		var err error
		portVal, err = strconv.Atoi(portStr)
		if err != nil {
			// do not make assumptions about port if incorrectly configured
			return nil, fmt.Errorf("could not parse \"%s\" (%s) - %s could not be converted to a valid port", hostName, canonicalName, portStr)
		}
		if portVal <= 0 || portVal > 65535 {
			return nil, fmt.Errorf("could not parse port \"%d\": number is not valid for a port", portVal)
		}
	}
	identityFile, _ := ssh_config.GetStrict(hostName, "IdentityFile")
	passwordAuth, _ := ssh_config.GetStrict(hostName, "PasswordAuthentication")

	cfgWaveOptionsStr, _ := ssh_config.GetStrict(hostName, "WaveOptions")
	cfgWaveOptionsStr = strings.ToLower(cfgWaveOptionsStr)
	cfgWaveOptions := make(map[string]string)
	setBracketArgs(cfgWaveOptions, cfgWaveOptionsStr)

	shouldIgnore := false
	if result, _ := strconv.ParseBool(cfgWaveOptions["ignore"]); result {
		shouldIgnore = true
	}

	var sshKeyFile string
	connectMode := sstore.ConnectModeAuto
	if cfgWaveOptions["connectmode"] == "manual" {
		connectMode = sstore.ConnectModeManual
	} else if _, err := os.Stat(base.ExpandHomeDir(identityFile)); err == nil {
		sshKeyFile = identityFile
	} else if passwordAuth == "yes" {
		connectMode = sstore.ConnectModeManual
	}

	shellPref := sstore.ShellTypePref_Detect
	if cfgWaveOptions["shellpref"] == "bash" {
		shellPref = "bash"
	} else if cfgWaveOptions["shellpref"] == "zsh" {
		shellPref = "zsh"
	}

	outHostInfo := new(HostInfoType)
	outHostInfo.Host = hostName
	outHostInfo.User = userName
	outHostInfo.CanonicalName = canonicalName
	outHostInfo.Port = portVal
	outHostInfo.SshKeyFile = sshKeyFile
	outHostInfo.ConnectMode = connectMode
	outHostInfo.Ignore = shouldIgnore
	outHostInfo.ShellPref = shellPref
	return outHostInfo, nil
}

func RemoteConfigParseCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	home := base.GetHomeDir()
	localConfig := filepath.Join(home, ".ssh", "config")
	systemConfig := filepath.Join("/etc", "ssh", "config")
	sshConfigFiles := []string{localConfig, systemConfig}
	ssh_config.ReloadConfigs()
	hostPatterns, hostPatternsErr := resolveSshConfigPatterns(sshConfigFiles)
	if hostPatternsErr != nil {
		return nil, hostPatternsErr
	}
	previouslyImportedRemotes, dbQueryErr := sstore.GetAllImportedRemotes(ctx)
	if dbQueryErr != nil {
		return nil, dbQueryErr
	}

	var parsedHostData []*HostInfoType
	hostInfoInConfig := make(map[string]*HostInfoType)
	for _, hostPattern := range hostPatterns {
		hostInfo, hostInfoErr := NewHostInfo(hostPattern)
		if hostInfoErr != nil {
			log.Printf("sshconfig-import: %s", hostInfoErr)
			continue
		}
		parsedHostData = append(parsedHostData, hostInfo)
		hostInfoInConfig[hostInfo.CanonicalName] = hostInfo
	}

	remoteChangeList := make(map[string][]string)

	// remove all previously imported remotes that
	// no longer have a canonical pattern in the config files
	for importedRemoteCanonicalName, importedRemote := range previouslyImportedRemotes {
		var err error
		hostInfo := hostInfoInConfig[importedRemoteCanonicalName]
		if !importedRemote.Archived && (hostInfo == nil || hostInfo.Ignore) {
			err = remote.ArchiveRemote(ctx, importedRemote.RemoteId)
			if err != nil {
				remoteChangeList["deleteErr"] = append(remoteChangeList["deleteErr"], importedRemote.RemoteCanonicalName)
				log.Printf("sshconfig-import: failed to remove remote \"%s\" (%s)\n", importedRemote.RemoteAlias, importedRemote.RemoteCanonicalName)
			} else {
				remoteChangeList["delete"] = append(remoteChangeList["delete"], importedRemote.RemoteCanonicalName)
				log.Printf("sshconfig-import: archived remote \"%s\" (%s)\n", importedRemote.RemoteAlias, importedRemote.RemoteCanonicalName)
			}
		}
	}

	for _, hostInfo := range parsedHostData {
		previouslyImportedRemote := previouslyImportedRemotes[hostInfo.CanonicalName]
		if hostInfo.Ignore {
			log.Printf("sshconfig-import: ignore remote[%s] as specified in config file\n", hostInfo.CanonicalName)
			continue
		}
		if previouslyImportedRemote != nil && !previouslyImportedRemote.Archived {
			// this already existed and was created via import
			// it needs to be updated instead of created
			editMap := make(map[string]interface{})
			editMap[sstore.RemoteField_Alias] = hostInfo.Host
			editMap[sstore.RemoteField_ConnectMode] = hostInfo.ConnectMode
			if hostInfo.SshKeyFile != "" {
				editMap[sstore.RemoteField_SSHKey] = hostInfo.SshKeyFile
			}
			editMap[sstore.RemoteField_ShellPref] = hostInfo.ShellPref
			msh := remote.GetRemoteById(previouslyImportedRemote.RemoteId)
			if msh == nil {
				remoteChangeList["updateErr"] = append(remoteChangeList["updateErr"], hostInfo.CanonicalName)
				log.Printf("strange, msh for remote %s [%s] not found\n", hostInfo.CanonicalName, previouslyImportedRemote.RemoteId)
				continue
			}

			if msh.Remote.ConnectMode == hostInfo.ConnectMode && msh.Remote.SSHOpts.SSHIdentity == hostInfo.SshKeyFile && msh.Remote.RemoteAlias == hostInfo.Host && msh.Remote.ShellPref == hostInfo.ShellPref {
				// silently skip this one. it didn't fail, but no changes were needed
				continue
			}

			err := msh.UpdateRemote(ctx, editMap)
			if err != nil {
				remoteChangeList["updateErr"] = append(remoteChangeList["updateErr"], hostInfo.CanonicalName)
				log.Printf("error updating remote[%s]: %v\n", hostInfo.CanonicalName, err)
				continue
			}
			remoteChangeList["update"] = append(remoteChangeList["update"], hostInfo.CanonicalName)
			log.Printf("sshconfig-import: found previously imported remote with canonical name \"%s\": it has been updated\n", hostInfo.CanonicalName)
		} else {
			sshOpts := &sstore.SSHOpts{
				Local:   false,
				SSHHost: hostInfo.Host,
				SSHUser: hostInfo.User,
				IsSudo:  false,
				SSHPort: hostInfo.Port,
			}
			if hostInfo.SshKeyFile != "" {
				sshOpts.SSHIdentity = hostInfo.SshKeyFile
			}

			// this is new and must be created for the first time
			r := &sstore.RemoteType{
				RemoteId:            scbase.GenWaveUUID(),
				RemoteType:          sstore.RemoteTypeSsh,
				RemoteAlias:         hostInfo.Host,
				RemoteCanonicalName: hostInfo.CanonicalName,
				RemoteUser:          hostInfo.User,
				RemoteHost:          hostInfo.Host,
				ConnectMode:         hostInfo.ConnectMode,
				AutoInstall:         true,
				SSHOpts:             sshOpts,
				SSHConfigSrc:        sstore.SSHConfigSrcTypeImport,
				ShellPref:           sstore.ShellTypePref_Detect,
			}
			err := remote.AddRemote(ctx, r, false)
			if err != nil {
				remoteChangeList["createErr"] = append(remoteChangeList["createErr"], hostInfo.CanonicalName)
				log.Printf("sshconfig-import: failed to add remote \"%s\" (%s): it is being skipped\n", hostInfo.Host, hostInfo.CanonicalName)
				continue
			}
			remoteChangeList["create"] = append(remoteChangeList["create"], hostInfo.CanonicalName)
			log.Printf("sshconfig-import: created remote \"%s\" (%s)\n", hostInfo.Host, hostInfo.CanonicalName)
		}
	}

	outMsg := createSshImportSummary(remoteChangeList)
	visualEdit := resolveBool(pk.Kwargs["visual"], false)
	if visualEdit {
		update := scbus.MakeUpdatePacket()
		update.AddUpdate(sstore.AlertMessageType{
			Title:    "SSH Config Import",
			Message:  outMsg,
			Markdown: true,
		})
		return update, nil
	} else {
		update := scbus.MakeUpdatePacket()
		update.AddUpdate(sstore.InfoMsgType{
			InfoMsg: outMsg,
		})
		return update, nil
	}
}

func ScreenShowAllCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session)
	screenArr, err := sstore.GetSessionScreens(ctx, ids.SessionId)
	if err != nil {
		return nil, fmt.Errorf("/screen:showall error getting screen list: %v", err)
	}
	var buf bytes.Buffer
	for _, screen := range screenArr {
		var archivedStr string
		if screen.Archived {
			archivedStr = " (archived)"
		}
		screenIdxStr := "-"
		if screen.ScreenIdx != 0 {
			screenIdxStr = strconv.Itoa(int(screen.ScreenIdx))
		}
		outStr := fmt.Sprintf("%-30s %s  %s\n", screen.Name+archivedStr, screen.ScreenId, screenIdxStr)
		buf.WriteString(outStr)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: fmt.Sprintf("all screens for session"),
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func ScreenResetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	localRemote := remote.GetLocalRemote()
	if localRemote == nil {
		return nil, fmt.Errorf("error getting local remote (not found)")
	}
	rptr := sstore.RemotePtrType{RemoteId: localRemote.RemoteId}
	sessionUpdate := &sstore.SessionType{SessionId: ids.SessionId}
	ris, err := sstore.ScreenReset(ctx, ids.ScreenId)
	if err != nil {
		return nil, fmt.Errorf("error resetting screen: %v", err)
	}
	sessionUpdate.Remotes = append(sessionUpdate.Remotes, ris...)
	err = sstore.UpdateCurRemote(ctx, ids.ScreenId, rptr)
	if err != nil {
		return nil, fmt.Errorf("cannot reset screen remote back to local: %w", err)
	}
	outputStr := "reset screen state (all remote state reset)"
	cmd, err := makeStaticCmd(ctx, "screen:reset", ids, pk.GetRawStr(), []byte(outputStr))
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update, err := addLineForCmd(ctx, "/screen:reset", false, ids, cmd, "", nil)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive), sessionUpdate)
	return update, nil
}

func RemoteArchiveCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	err = remote.ArchiveRemote(ctx, ids.Remote.RemotePtr.RemoteId)
	if err != nil {
		return nil, fmt.Errorf("archiving remote: %v", err)
	}
	update := sstore.InfoMsgUpdate("remote [%s] archived", ids.Remote.DisplayName)
	localRemote := remote.GetLocalRemote()
	rptr := sstore.RemotePtrType{RemoteId: localRemote.GetRemoteId()}
	err = sstore.UpdateCurRemote(ctx, ids.ScreenId, rptr)
	if err != nil {
		return nil, fmt.Errorf("cannot switch remote back to local: %w", err)
	}
	screen, err := sstore.GetScreenById(ctx, ids.ScreenId)
	if err != nil {
		return nil, fmt.Errorf("cannot get updated screen: %w", err)
	}
	update.AddUpdate(*screen)
	return update, nil
}

func RemoteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	return nil, fmt.Errorf("/remote requires a subcommand: %s", formatStrs([]string{"show"}, "or", false))
}

func crShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType, ids resolvedIds) (scbus.UpdatePacket, error) {
	var buf bytes.Buffer
	riArr, err := sstore.GetRIsForScreen(ctx, ids.SessionId, ids.ScreenId)
	if err != nil {
		return nil, fmt.Errorf("cannot get remote instances: %w", err)
	}
	if len(riArr) == 0 {
		update := scbus.MakeUpdatePacket()
		update.AddUpdate(sstore.InfoMsgType{
			InfoMsg: "this tab has no shell states",
		})
		return update, nil
	}
	for _, ri := range riArr {
		rptr := sstore.RemotePtrType{RemoteId: ri.RemoteId, Name: ri.Name}
		msh := remote.GetRemoteById(ri.RemoteId)
		if msh == nil {
			continue
		}
		baseDisplayName := msh.GetDisplayName()
		displayName := rptr.GetDisplayName(baseDisplayName)
		cwdStr := "-"
		if ri.FeState["cwd"] != "" {
			cwdStr = ri.FeState["cwd"]
		}
		buf.WriteString(fmt.Sprintf("%-30s %-50s\n", displayName, cwdStr))
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: "shell states for tab",
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func GetFullRemoteDisplayName(rptr *sstore.RemotePtrType, rstate *remote.RemoteRuntimeState) string {
	if rptr == nil {
		return "(invalid)"
	}
	if rstate.RemoteAlias != "" {
		fullName := rstate.RemoteAlias
		if rptr.Name != "" {
			fullName = fullName + ":" + rptr.Name
		}
		return fmt.Sprintf("[%s] (%s)", fullName, rstate.RemoteCanonicalName)
	} else {
		if rptr.Name != "" {
			return fmt.Sprintf("[%s:%s]", rstate.RemoteCanonicalName, rptr.Name)
		}
		return fmt.Sprintf("[%s]", rstate.RemoteCanonicalName)
	}
}

func writeErrorToPty(cmd *sstore.CmdType, errStr string, outputPos int64) {
	errPk := openai.CreateErrorPacket(errStr)
	errBytes, err := packet.MarshalPacket(errPk)
	if err != nil {
		log.Printf("error writing error packet to openai response: %v\n", err)
		return
	}
	errCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	update, err := sstore.AppendToCmdPtyBlob(errCtx, cmd.ScreenId, cmd.LineId, errBytes, outputPos)
	if err != nil {
		log.Printf("error writing ptyupdate for openai response: %v\n", err)
		return
	}
	scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
	return
}

func writePacketToPty(ctx context.Context, cmd *sstore.CmdType, pk packet.PacketType, outputPos *int64) error {
	outBytes, err := packet.MarshalPacket(pk)
	if err != nil {
		return err
	}
	update, err := sstore.AppendToCmdPtyBlob(ctx, cmd.ScreenId, cmd.LineId, outBytes, *outputPos)
	if err != nil {
		return err
	}
	*outputPos += int64(len(outBytes))
	scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
	return nil
}

func doOpenAICompletion(cmd *sstore.CmdType, opts *sstore.OpenAIOptsType, prompt []packet.OpenAIPromptMessageType) {
	var outputPos int64
	var hadError bool
	startTime := time.Now()
	ctx, cancelFn := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelFn()
	defer func() {
		r := recover()
		if r != nil {
			panicMsg := fmt.Sprintf("panic: %v", r)
			log.Printf("panic in doOpenAICompletion: %s\n", panicMsg)
			writeErrorToPty(cmd, panicMsg, outputPos)
			hadError = true
		}
		duration := time.Since(startTime)
		cmdStatus := sstore.CmdStatusDone
		var exitCode int
		if hadError {
			cmdStatus = sstore.CmdStatusError
			exitCode = 1
		}
		ck := base.MakeCommandKey(cmd.ScreenId, cmd.LineId)
		doneInfo := sstore.CmdDoneDataValues{
			Ts:         time.Now().UnixMilli(),
			ExitCode:   exitCode,
			DurationMs: duration.Milliseconds(),
		}
		update := scbus.MakeUpdatePacket()
		err := sstore.UpdateCmdDoneInfo(context.Background(), update, ck, doneInfo, cmdStatus)
		if err != nil {
			// nothing to do
			log.Printf("error updating cmddoneinfo (in openai): %v\n", err)
			return
		}
		scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
	}()
	var respPks []*packet.OpenAIPacketType
	var err error
	// run open ai completion locally
	respPks, err = openai.RunCompletion(ctx, opts, prompt)
	if err != nil {
		writeErrorToPty(cmd, fmt.Sprintf("error calling OpenAI API: %v", err), outputPos)
		return
	}
	for _, pk := range respPks {
		err = writePacketToPty(ctx, cmd, pk, &outputPos)
		if err != nil {
			writeErrorToPty(cmd, fmt.Sprintf("error writing response to ptybuffer: %v", err), outputPos)
			return
		}
	}
	return
}

func writePacketToUpdateBus(ctx context.Context, cmd *sstore.CmdType, pk *packet.OpenAICmdInfoChatMessage) {
	update := sstore.UpdateWithAddNewOpenAICmdInfoPacket(ctx, cmd.ScreenId, pk)
	scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
}

func updateAsstResponseAndWriteToUpdateBus(ctx context.Context, cmd *sstore.CmdType, pk *packet.OpenAICmdInfoChatMessage, messageID int) {
	update, err := sstore.UpdateWithUpdateOpenAICmdInfoPacket(ctx, cmd.ScreenId, messageID, pk)
	if err != nil {
		log.Printf("Open AI Update packet err: %v\n", err)
	}
	scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
}

func getCmdInfoEngineeredPrompt(userQuery string, curLineStr string, shellType string, osType string) string {
	promptBase := "You are an AI assistant with deep expertise in command line interfaces, CLI programs, and shell scripting. Your task is to help the user to fix an existing command that will be provided, or if no command is provided, help write a new command that the user requires. Feel free to provide appropriate context, but try to keep your answers short and to the point as the user is asking for help because they are trying to get a task done immediately."
	promptBase = promptBase + " The user is current using the \"" + shellType + "\" shell on " + osType + "."
	promptCurrentCommand := ""
	if strings.TrimSpace(curLineStr) != "" {
		// Enclose the command in triple backticks to format it as a code block.
		promptCurrentCommand = " The user is currently working with the command: ```\n" + curLineStr + "\n```\n\n"
	}
	promptFormattingInstruction := "Please ensure any command line suggestions or code snippets or scripts that are meant to be run by the user are enclosed in triple backquotes for easy copy and paste into the terminal.  Also note that any response you give will be rendered in markdown."
	promptQuestion := " The user's question is:\n\n" + userQuery + ""

	return promptBase + promptCurrentCommand + promptFormattingInstruction + promptQuestion
}

func doOpenAICmdInfoCompletion(cmd *sstore.CmdType, clientId string, opts *sstore.OpenAIOptsType, prompt []packet.OpenAIPromptMessageType, curLineStr string) {
	ctx, cancelFn := context.WithTimeout(context.Background(), OpenAIStreamTimeout)
	defer cancelFn()
	defer func() {
		r := recover()
		if r != nil {
			panicMsg := fmt.Sprintf("panic: %v", r)
			log.Printf("panic in doOpenAICompletion: %s\n", panicMsg)
		}
	}()
	var ch chan *packet.OpenAIPacketType
	var err error
	if opts.BaseURL == "" && opts.APIToken == "" {
		var conn *websocket.Conn
		ch, conn, err = openai.RunCloudCompletionStream(ctx, clientId, opts, prompt)
		if conn != nil {
			defer conn.Close()
		}
	} else {
		ch, err = openai.RunCompletionStream(ctx, opts, prompt)
	}
	asstOutputPk := &packet.OpenAICmdInfoPacketOutputType{
		Model:        "",
		Created:      0,
		FinishReason: "",
		Message:      "",
	}
	asstOutputMessageID := sstore.ScreenMemGetCmdInfoMessageCount(cmd.ScreenId)
	asstMessagePk := &packet.OpenAICmdInfoChatMessage{IsAssistantResponse: true, AssistantResponse: asstOutputPk, MessageID: asstOutputMessageID}
	if err != nil {
		asstOutputPk.Error = fmt.Sprintf("Error calling OpenAI API: %v", err)
		writePacketToUpdateBus(ctx, cmd, asstMessagePk)
		return
	}
	writePacketToUpdateBus(ctx, cmd, asstMessagePk)
	packetTimeout := OpenAIPacketTimeout
	if opts.Timeout >= 0 {
		packetTimeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	doneWaitingForPackets := false
	for !doneWaitingForPackets {
		select {
		case <-time.After(packetTimeout):
			// timeout reading from channel
			doneWaitingForPackets = true
			asstOutputPk.Error = "timeout waiting for server response"
			updateAsstResponseAndWriteToUpdateBus(ctx, cmd, asstMessagePk, asstOutputMessageID)
		case pk, ok := <-ch:
			if ok {
				// got a packet
				if pk.Error != "" {
					asstOutputPk.Error = pk.Error
				}
				if pk.Model != "" && pk.Index == 0 {
					asstOutputPk.Model = pk.Model
					asstOutputPk.Created = pk.Created
					asstOutputPk.FinishReason = pk.FinishReason
					if pk.Text != "" {
						asstOutputPk.Message += pk.Text
					}
				}
				if pk.Index == 0 {
					if pk.FinishReason != "" {
						asstOutputPk.FinishReason = pk.FinishReason
					}
					if pk.Text != "" {
						asstOutputPk.Message += pk.Text
					}
				}
				asstMessagePk.AssistantResponse = asstOutputPk
				updateAsstResponseAndWriteToUpdateBus(ctx, cmd, asstMessagePk, asstOutputMessageID)
			} else {
				// channel closed
				doneWaitingForPackets = true
			}
		}
	}
}

func doOpenAIStreamCompletion(cmd *sstore.CmdType, clientId string, opts *sstore.OpenAIOptsType, prompt []packet.OpenAIPromptMessageType) {
	var outputPos int64
	var hadError bool
	startTime := time.Now()
	ctx, cancelFn := context.WithTimeout(context.Background(), OpenAIStreamTimeout)
	defer cancelFn()
	defer func() {
		r := recover()
		if r != nil {
			panicMsg := fmt.Sprintf("panic: %v", r)
			log.Printf("panic in doOpenAICompletion: %s\n", panicMsg)
			writeErrorToPty(cmd, panicMsg, outputPos)
			hadError = true
		}
		duration := time.Since(startTime)
		cmdStatus := sstore.CmdStatusDone
		var exitCode int
		if hadError {
			cmdStatus = sstore.CmdStatusError
			exitCode = 1
		}
		ck := base.MakeCommandKey(cmd.ScreenId, cmd.LineId)
		doneInfo := sstore.CmdDoneDataValues{
			Ts:         time.Now().UnixMilli(),
			ExitCode:   exitCode,
			DurationMs: duration.Milliseconds(),
		}
		update := scbus.MakeUpdatePacket()
		err := sstore.UpdateCmdDoneInfo(context.Background(), update, ck, doneInfo, cmdStatus)
		if err != nil {
			// nothing to do
			log.Printf("error updating cmddoneinfo (in openai): %v\n", err)
			return
		}
		scbus.MainUpdateBus.DoScreenUpdate(cmd.ScreenId, update)
	}()
	var ch chan *packet.OpenAIPacketType
	var err error
	if opts.APIToken == "" && opts.BaseURL == "" {
		var conn *websocket.Conn
		ch, conn, err = openai.RunCloudCompletionStream(ctx, clientId, opts, prompt)
		if conn != nil {
			defer conn.Close()
		}
	} else {
		ch, err = openai.RunCompletionStream(ctx, opts, prompt)
	}
	if err != nil {
		writeErrorToPty(cmd, fmt.Sprintf("error calling OpenAI API: %v", err), outputPos)
		return
	}
	packetTimeout := OpenAIPacketTimeout
	if opts.Timeout >= 0 {
		packetTimeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	doneWaitingForPackets := false
	for !doneWaitingForPackets {
		select {
		case <-time.After(packetTimeout):
			// timeout reading from channel
			hadError = true
			pk := openai.CreateErrorPacket(fmt.Sprintf("timeout waiting for server response"))
			err = writePacketToPty(ctx, cmd, pk, &outputPos)
			if err != nil {
				log.Printf("error writing response to ptybuffer: %v", err)
				return
			}
			doneWaitingForPackets = true
		case pk, ok := <-ch:
			if ok {
				// got a packet
				if pk.Error != "" {
					hadError = true
				}
				err = writePacketToPty(ctx, cmd, pk, &outputPos)
				if err != nil {
					hadError = true
					log.Printf("error writing response to ptybuffer: %v", err)
					return
				}
			} else {
				// channel closed
				doneWaitingForPackets = true
			}
		}
	}
	return
}

func BuildOpenAIPromptArrayWithContext(messages []*packet.OpenAICmdInfoChatMessage) []packet.OpenAIPromptMessageType {
	rtn := make([]packet.OpenAIPromptMessageType, 0)
	for _, msg := range messages {
		content := msg.UserEngineeredQuery
		if msg.UserEngineeredQuery == "" {
			content = msg.UserQuery
		}
		msgRole := sstore.OpenAIRoleUser
		if msg.IsAssistantResponse {
			msgRole = sstore.OpenAIRoleAssistant
			content = msg.AssistantResponse.Message
		}
		rtn = append(rtn, packet.OpenAIPromptMessageType{Role: msgRole, Content: content})
	}
	return rtn
}

func GetOsTypeFromRuntime() string {
	osVal := runtime.GOOS
	if osVal == "darwin" {
		osVal = "macos"
	}
	return osVal
}

func OpenAICommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, fmt.Errorf("/%s error: %w", GetCmdStr(pk), err)
	}
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	if clientData.OpenAIOpts == nil {
		return nil, fmt.Errorf("error retrieving client open ai options")
	}
	opts := clientData.OpenAIOpts
	if opts.APIToken == "" && opts.BaseURL == "" {
		if clientData.ClientOpts.NoTelemetry {
			return nil, fmt.Errorf(OpenAICloudCompletionTelemetryOffErrorMsg)
		}
	}
	if opts.Model == "" {
		opts.Model = openai.DefaultModel
	}
	if opts.MaxTokens == 0 {
		opts.MaxTokens = openai.DefaultMaxTokens
	}
	promptStr := firstArg(pk)
	ptermVal := defaultStr(pk.Kwargs["wterm"], DefaultPTERM)
	pkTermOpts, err := GetUITermOpts(pk.UIContext.WinSize, ptermVal)
	if err != nil {
		return nil, fmt.Errorf("openai error, invalid 'pterm' value %q: %v", ptermVal, err)
	}
	termOpts := convertTermOpts(pkTermOpts)
	cmd, err := makeDynCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), *termOpts, nil)
	if err != nil {
		return nil, fmt.Errorf("openai error, cannot make dyn cmd")
	}
	if resolveBool(pk.Kwargs["cmdinfo"], false) {
		if promptStr == "" {
			// this is requesting an update without wanting an openai query
			update := sstore.UpdateWithCurrentOpenAICmdInfoChat(cmd.ScreenId, nil)
			if err != nil {
				return nil, fmt.Errorf("error getting update for CmdInfoChat %v", err)
			}
			return update, nil
		}
		curLineStr := defaultStr(pk.Kwargs["curline"], "")
		userQueryPk := &packet.OpenAICmdInfoChatMessage{UserQuery: promptStr, MessageID: sstore.ScreenMemGetCmdInfoMessageCount(cmd.ScreenId)}
		osType := GetOsTypeFromRuntime()
		engineeredQuery := getCmdInfoEngineeredPrompt(promptStr, curLineStr, ids.Remote.ShellType, osType)
		userQueryPk.UserEngineeredQuery = engineeredQuery
		writePacketToUpdateBus(ctx, cmd, userQueryPk)
		prompt := BuildOpenAIPromptArrayWithContext(sstore.ScreenMemGetCmdInfoChat(cmd.ScreenId).Messages)
		go doOpenAICmdInfoCompletion(cmd, clientData.ClientId, opts, prompt, curLineStr)
		update := scbus.MakeUpdatePacket()
		return update, nil
	}
	osType := GetOsTypeFromRuntime()
	engineeredQuery := getCmdInfoEngineeredPrompt(promptStr, "", ids.Remote.ShellType, osType)
	prompt := []packet.OpenAIPromptMessageType{{Role: sstore.OpenAIRoleUser, Content: engineeredQuery}}
	if resolveBool(pk.Kwargs["cmdinfoclear"], false) {
		update := sstore.UpdateWithClearOpenAICmdInfo(cmd.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("error clearing CmdInfoChat: %v", err)
		}
		return update, nil
	}
	if promptStr == "" {
		return nil, fmt.Errorf("openai error, prompt string is blank")
	}
	update := scbus.MakeUpdatePacket()
	go sstore.IncrementNumRunningCmds(cmd.ScreenId, 1)
	line, err := sstore.AddOpenAILine(ctx, ids.ScreenId, DefaultUserId, cmd)
	if err != nil {
		return nil, fmt.Errorf("cannot add new line: %v", err)
	}

	if resolveBool(pk.Kwargs["stream"], true) {
		go doOpenAIStreamCompletion(cmd, clientData.ClientId, opts, prompt)
	} else {
		go doOpenAICompletion(cmd, opts, prompt)
	}
	updateHistoryContext(ctx, line, cmd, nil)
	updateMap := make(map[string]interface{})
	updateMap[sstore.ScreenField_SelectedLine] = line.LineNum
	updateMap[sstore.ScreenField_Focus] = sstore.ScreenFocusInput
	screen, err := sstore.UpdateScreen(ctx, ids.ScreenId, updateMap)
	if err != nil {
		// ignore error again (nothing to do)
		log.Printf("openai error updating screen selected line: %v\n", err)
	}
	sstore.AddLineUpdate(update, line, cmd)
	update.AddUpdate(*screen)
	return update, nil
}

func CrCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, fmt.Errorf("/%s error: %w", GetCmdStr(pk), err)
	}
	newRemote := firstArg(pk)
	if newRemote == "" {
		return crShowCommand(ctx, pk, ids)
	}
	_, rptr, rstate, err := resolveRemote(ctx, newRemote, ids.SessionId, ids.ScreenId)
	if err != nil {
		return nil, err
	}
	if rptr == nil {
		return nil, fmt.Errorf("/%s error: remote %q not found", GetCmdStr(pk), newRemote)
	}
	if rstate.Archived {
		return nil, fmt.Errorf("/%s error: remote %q cannot switch to archived remote", GetCmdStr(pk), newRemote)
	}
	newMsh := remote.GetRemoteById(rptr.RemoteId)
	if newMsh == nil {
		return nil, fmt.Errorf("/%s error: remote %q not found (msh)", GetCmdStr(pk), newRemote)
	}
	if !newMsh.IsConnected() {
		err := newMsh.TryAutoConnect()
		if err != nil {
			return nil, fmt.Errorf("%q is disconnected, auto-connect failed: %w", rstate.GetBaseDisplayName(), err)
		}
		if !newMsh.IsConnected() {
			if newMsh.GetRemoteCopy().ConnectMode == sstore.ConnectModeManual {
				return nil, fmt.Errorf("%q is disconnected (must manually connect)", rstate.GetBaseDisplayName())
			}
			return nil, fmt.Errorf("%q is disconnected", rstate.GetBaseDisplayName())
		}
	}
	err = sstore.UpdateCurRemote(ctx, ids.ScreenId, *rptr)
	if err != nil {
		return nil, fmt.Errorf("/%s error: cannot update curremote: %w", GetCmdStr(pk), err)
	}
	ri, err := sstore.GetRemoteStatePtr(ctx, ids.SessionId, ids.ScreenId, *rptr)
	if err != nil {
		return nil, fmt.Errorf("/%s error looking up connection state: %w", GetCmdStr(pk), err)
	}
	if ri == nil {
		// ok, if ri is nil we need to do a reinit
		verbose := resolveBool(pk.Kwargs["verbose"], false)
		shellType, err := resolveShellType(pk.Kwargs["shell"], rstate.DefaultShellType)
		if err != nil {
			return nil, err
		}
		termOpts, err := GetUITermOpts(pk.UIContext.WinSize, DefaultPTERM)
		if err != nil {
			return nil, fmt.Errorf("cannot make termopts: %w", err)
		}
		pkTermOpts := convertTermOpts(termOpts)
		cmd, err := makeDynCmd(ctx, "connect", ids, pk.GetRawStr(), *pkTermOpts, &makeDynCmdOpts{OverrideRPtr: rptr})
		if err != nil {
			return nil, err
		}
		update, err := addLineForCmd(ctx, "connect", true, ids, cmd, "", nil)
		if err != nil {
			return nil, err
		}
		opts := connectOptsType{
			Verbose:   verbose,
			ShellType: shellType,
			SessionId: ids.SessionId,
			ScreenId:  ids.ScreenId,
			RPtr:      *rptr,
		}
		go doAsyncResetCommand(newMsh, opts, cmd)
		return update, nil
	} else {
		outputStr := fmt.Sprintf("reconnected to %s", GetFullRemoteDisplayName(rptr, rstate))
		cmd, err := makeStaticCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), []byte(outputStr))
		if err != nil {
			// TODO tricky error since the command was a success, but we can't show the output
			return nil, err
		}
		update, err := addLineForCmd(ctx, "/"+GetCmdStr(pk), false, ids, cmd, "", nil)
		if err != nil {
			// TODO tricky error since the command was a success, but we can't show the output
			return nil, err
		}
		update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
		return update, nil
	}
}

type makeDynCmdOpts struct {
	OverrideRPtr *sstore.RemotePtrType
}

func makeDynCmd(ctx context.Context, metaCmd string, ids resolvedIds, cmdStr string, termOpts sstore.TermOpts, opts *makeDynCmdOpts) (*sstore.CmdType, error) {
	var rptr scpacket.RemotePtrType
	if opts != nil && opts.OverrideRPtr != nil {
		rptr = *opts.OverrideRPtr
	} else if ids.Remote != nil {
		rptr = ids.Remote.RemotePtr
	} else {
		local := remote.GetLocalRemote()
		rptr = scpacket.RemotePtrType{RemoteId: local.RemoteId}
	}
	cmd := &sstore.CmdType{
		ScreenId:  ids.ScreenId,
		LineId:    scbase.GenWaveUUID(),
		CmdStr:    cmdStr,
		RawCmdStr: cmdStr,
		Remote:    rptr,
		TermOpts:  termOpts,
		Status:    sstore.CmdStatusRunning,
		RunOut:    nil,
	}
	if ids.Remote != nil && ids.Remote.StatePtr != nil {
		cmd.StatePtr = *ids.Remote.StatePtr
	}
	if ids.Remote != nil && ids.Remote.FeState != nil {
		cmd.FeState = ids.Remote.FeState
	}
	err := sstore.CreateCmdPtyFile(ctx, cmd.ScreenId, cmd.LineId, cmd.TermOpts.MaxPtySize)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, fmt.Errorf("cannot create local ptyout file for %s command: %w", metaCmd, err)
	}
	return cmd, nil
}

func makeStaticCmd(ctx context.Context, metaCmd string, ids resolvedIds, cmdStr string, cmdOutput []byte) (*sstore.CmdType, error) {
	cmd := &sstore.CmdType{
		ScreenId:  ids.ScreenId,
		LineId:    scbase.GenWaveUUID(),
		CmdStr:    cmdStr,
		RawCmdStr: cmdStr,
		Remote:    ids.Remote.RemotePtr,
		TermOpts:  sstore.TermOpts{Rows: shellutil.DefaultTermRows, Cols: shellutil.DefaultTermCols, FlexRows: true, MaxPtySize: remote.DefaultMaxPtySize},
		Status:    sstore.CmdStatusDone,
		RunOut:    nil,
	}
	if ids.Remote.StatePtr != nil {
		cmd.StatePtr = *ids.Remote.StatePtr
	}
	if ids.Remote.FeState != nil {
		cmd.FeState = ids.Remote.FeState
	}
	err := sstore.CreateCmdPtyFile(ctx, cmd.ScreenId, cmd.LineId, cmd.TermOpts.MaxPtySize)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, fmt.Errorf("cannot create local ptyout file for %s command: %w", metaCmd, err)
	}
	// can ignore ptyupdate
	_, err = sstore.AppendToCmdPtyBlob(ctx, ids.ScreenId, cmd.LineId, cmdOutput, 0)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, fmt.Errorf("cannot append to local ptyout file for %s command: %v", metaCmd, err)
	}
	return cmd, nil
}

func addLineForCmd(ctx context.Context, metaCmd string, shouldFocus bool, ids resolvedIds, cmd *sstore.CmdType, renderer string, lineState map[string]any) (*scbus.ModelUpdatePacketType, error) {
	rtnLine, err := sstore.AddCmdLine(ctx, ids.ScreenId, DefaultUserId, cmd, renderer, lineState)
	if err != nil {
		return nil, err
	}
	screen, err := sstore.GetScreenById(ctx, ids.ScreenId)
	if err != nil {
		// ignore error here, because the command has already run (nothing to do)
		log.Printf("%s error getting screen: %v\n", metaCmd, err)
	}
	if screen != nil {
		updateMap := make(map[string]interface{})
		updateMap[sstore.ScreenField_SelectedLine] = rtnLine.LineNum
		if shouldFocus {
			updateMap[sstore.ScreenField_Focus] = sstore.ScreenFocusCmd
		}
		screen, err = sstore.UpdateScreen(ctx, ids.ScreenId, updateMap)
		if err != nil {
			// ignore error again (nothing to do)
			log.Printf("%s error updating screen selected line: %v\n", metaCmd, err)
		}
	}
	update := scbus.MakeUpdatePacket()
	sstore.AddLineUpdate(update, rtnLine, cmd)
	update.AddUpdate(*screen)
	if cmd.Status == sstore.CmdStatusRunning {
		go sstore.IncrementNumRunningCmds(cmd.ScreenId, 1)
	}
	updateHistoryContext(ctx, rtnLine, cmd, cmd.FeState)
	return update, nil
}

func updateHistoryContext(ctx context.Context, line *sstore.LineType, cmd *sstore.CmdType, feState sstore.FeStateType) {
	ctxVal := ctx.Value(historyContextKey)
	if ctxVal == nil {
		return
	}
	hctx := ctxVal.(*historyContextType)
	if line != nil {
		hctx.LineId = line.LineId
		hctx.LineNum = line.LineNum
	}
	if cmd != nil {
		hctx.RemotePtr = &cmd.Remote
		hctx.InitialStatus = cmd.Status
	} else {
		hctx.InitialStatus = sstore.CmdStatusDone
	}
	hctx.FeState = feState
}

func makeInfoFromComps(compType string, comps []string, hasMore bool) scbus.UpdatePacket {
	sort.Slice(comps, func(i int, j int) bool {
		c1 := comps[i]
		c2 := comps[j]
		c1mc := strings.HasPrefix(c1, "^")
		c2mc := strings.HasPrefix(c2, "^")
		if c1mc && !c2mc {
			return true
		}
		if !c1mc && c2mc {
			return false
		}
		return c1 < c2
	})
	if len(comps) == 0 {
		comps = []string{"(no completions)"}
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle:     fmt.Sprintf("%s completions", compType),
		InfoComps:     comps,
		InfoCompsMore: hasMore,
	})
	return update
}

func simpleCompCommandMeta(ctx context.Context, prefix string, compCtx comp.CompContext, args []interface{}) (*comp.CompReturn, error) {
	if strings.HasPrefix(prefix, "/") {
		compsCmd, _ := comp.DoSimpleComp(ctx, comp.CGTypeCommand, prefix, compCtx, nil)
		compsMeta, _ := simpleCompMeta(ctx, prefix, compCtx, nil)
		return comp.CombineCompReturn(comp.CGTypeCommandMeta, compsCmd, compsMeta), nil
	} else {
		compsCmd, _ := comp.DoSimpleComp(ctx, comp.CGTypeCommand, prefix, compCtx, nil)
		compsBareCmd, _ := simpleCompBareCmds(ctx, prefix, compCtx, nil)
		return comp.CombineCompReturn(comp.CGTypeCommand, compsCmd, compsBareCmd), nil
	}
}

func simpleCompBareCmds(ctx context.Context, prefix string, compCtx comp.CompContext, args []interface{}) (*comp.CompReturn, error) {
	rtn := comp.CompReturn{}
	for _, bmc := range BareMetaCmds {
		if strings.HasPrefix(bmc.CmdStr, prefix) {
			rtn.Entries = append(rtn.Entries, comp.CompEntry{Word: bmc.CmdStr, IsMetaCmd: true})
		}
	}
	return &rtn, nil
}

func simpleCompMeta(ctx context.Context, prefix string, compCtx comp.CompContext, args []interface{}) (*comp.CompReturn, error) {
	rtn := comp.CompReturn{}
	validCommands := getValidCommands()
	for _, cmd := range validCommands {
		if strings.HasPrefix(cmd, "/_") && !strings.HasPrefix(prefix, "/_") {
			continue
		}
		if strings.HasPrefix(cmd, prefix) {
			rtn.Entries = append(rtn.Entries, comp.CompEntry{Word: cmd, IsMetaCmd: true})
		}
	}
	return &rtn, nil
}

func doMetaCompGen(ctx context.Context, pk *scpacket.FeCommandPacketType, prefix string, forDisplay bool) ([]string, bool, error) {
	ids, err := resolveUiIds(ctx, pk, 0) // best effort
	var comps []string
	var hasMore bool
	if ids.Remote != nil && ids.Remote.RState.IsConnected() {
		comps, hasMore, err = doCompGen(ctx, pk, prefix, "file", forDisplay)
		if err != nil {
			return nil, false, err
		}
	}
	validCommands := getValidCommands()
	for _, cmd := range validCommands {
		if strings.HasPrefix(cmd, prefix) {
			if forDisplay {
				comps = append(comps, "^"+cmd)
			} else {
				comps = append(comps, cmd)
			}
		}
	}
	return comps, hasMore, nil
}

func doCompGen(ctx context.Context, pk *scpacket.FeCommandPacketType, prefix string, compType string, forDisplay bool) ([]string, bool, error) {
	if compType == "metacommand" {
		return doMetaCompGen(ctx, pk, prefix, forDisplay)
	}
	if !packet.IsValidCompGenType(compType) {
		return nil, false, fmt.Errorf("/_compgen invalid type '%s'", compType)
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, false, fmt.Errorf("/_compgen error: %w", err)
	}
	cgPacket := packet.MakeCompGenPacket()
	cgPacket.ReqId = uuid.New().String()
	cgPacket.CompType = compType
	cgPacket.Prefix = prefix
	cgPacket.Cwd = ids.Remote.FeState["cwd"]
	resp, err := ids.Remote.MShell.PacketRpc(ctx, cgPacket)
	if err != nil {
		return nil, false, err
	}
	if err = resp.Err(); err != nil {
		return nil, false, err
	}
	comps := utilfn.GetStrArr(resp.Data, "comps")
	hasMore := utilfn.GetBool(resp.Data, "hasmore")
	return comps, hasMore, nil
}

func CompGenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, 0) // best-effort
	if err != nil {
		return nil, fmt.Errorf("/_compgen error: %w", err)
	}
	cmdLine := firstArg(pk)
	pos := len(cmdLine)
	if pk.Kwargs["comppos"] != "" {
		posArg, err := strconv.Atoi(pk.Kwargs["comppos"])
		if err != nil {
			return nil, fmt.Errorf("/_compgen invalid comppos '%s': %w", pk.Kwargs["comppos"], err)
		}
		pos = posArg
	}
	if pos < 0 {
		pos = 0
	}
	if pos > len(cmdLine) {
		pos = len(cmdLine)
	}
	showComps := resolveBool(pk.Kwargs["compshow"], false)
	cmdSP := utilfn.StrWithPos{Str: cmdLine, Pos: pos}
	compCtx := comp.CompContext{}
	if ids.Remote != nil {
		rptr := ids.Remote.RemotePtr
		compCtx.RemotePtr = &rptr
		if ids.Remote.FeState != nil {
			compCtx.Cwd = ids.Remote.FeState["cwd"]
		}
	}
	compCtx.ForDisplay = showComps
	crtn, newSP, err := comp.DoCompGen(ctx, cmdSP, compCtx)
	if err != nil {
		return nil, err
	}
	if crtn == nil {
		return nil, nil
	}
	if showComps {
		compStrs := crtn.GetCompDisplayStrs()
		return makeInfoFromComps(crtn.CompType, compStrs, crtn.HasMore), nil
	}
	if newSP == nil || cmdSP == *newSP {
		return nil, nil
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.CmdLineUpdate(utilfn.StrWithPos{Str: newSP.Str, Pos: newSP.Pos}))
	return update, nil
}

func CommentCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, fmt.Errorf("/comment error: %w", err)
	}
	text := firstArg(pk)
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("cannot post empty comment")
	}
	rtnLine, err := sstore.AddCommentLine(ctx, ids.ScreenId, DefaultUserId, text)
	if err != nil {
		return nil, err
	}
	updateHistoryContext(ctx, rtnLine, nil, nil)
	updateMap := make(map[string]interface{})
	updateMap[sstore.ScreenField_SelectedLine] = rtnLine.LineNum
	updateMap[sstore.ScreenField_Focus] = sstore.ScreenFocusInput
	screen, err := sstore.UpdateScreen(ctx, ids.ScreenId, updateMap)
	if err != nil {
		// ignore error again (nothing to do)
		log.Printf("/comment error updating screen selected line: %v\n", err)
	}
	update := scbus.MakeUpdatePacket()
	sstore.AddLineUpdate(update, rtnLine, nil)
	update.AddUpdate(*screen)
	return update, nil
}

func maybeQuote(s string, quote bool) string {
	if quote {
		return fmt.Sprintf("%q", s)
	}
	return s
}

func mapToStrs(m map[string]bool) []string {
	var rtn []string
	for key, val := range m {
		if val {
			rtn = append(rtn, key)
		}
	}
	return rtn
}

func formatStrs(strs []string, conj string, quote bool) string {
	if len(strs) == 0 {
		return "(none)"
	}
	if len(strs) == 1 {
		return maybeQuote(strs[0], quote)
	}
	if len(strs) == 2 {
		return fmt.Sprintf("%s %s %s", maybeQuote(strs[0], quote), conj, maybeQuote(strs[1], quote))
	}
	var buf bytes.Buffer
	for idx := 0; idx < len(strs)-1; idx++ {
		buf.WriteString(maybeQuote(strs[idx], quote))
		buf.WriteString(", ")
	}
	buf.WriteString(conj)
	buf.WriteString(" ")
	buf.WriteString(maybeQuote(strs[len(strs)-1], quote))
	return buf.String()
}

func validateName(name string, typeStr string) error {
	if len(name) > MaxNameLen {
		return fmt.Errorf("%s name too long, max length is %d", typeStr, MaxNameLen)
	}
	if !genericNameRe.MatchString(name) {
		return fmt.Errorf("invalid %s name", typeStr)
	}
	return nil
}

func validateShareName(name string) error {
	if len(name) > MaxShareNameLen {
		return fmt.Errorf("share name too long, max length is %d", MaxShareNameLen)
	}
	for _, ch := range name {
		if !unicode.IsPrint(ch) {
			return fmt.Errorf("invalid character %q in share name", string(ch))
		}
	}
	return nil
}

func validateRenderer(renderer string) error {
	if renderer == "" {
		return nil
	}
	if len(renderer) > MaxRendererLen {
		return fmt.Errorf("renderer name too long, max length is %d", MaxRendererLen)
	}
	if !rendererRe.MatchString(renderer) {
		return fmt.Errorf("invalid renderer format")
	}
	return nil
}

func validateColor(color string, typeStr string) error {
	for _, c := range ColorNames {
		if color == c {
			return nil
		}
	}
	return fmt.Errorf("invalid %s, valid colors are: %s", typeStr, formatStrs(ColorNames, "or", false))
}

func validateRemoteColor(color string, typeStr string) error {
	for _, c := range RemoteColorNames {
		if color == c {
			return nil
		}
	}
	return fmt.Errorf("invalid %s, valid colors are: %s", typeStr, formatStrs(RemoteColorNames, "or", false))
}

func SessionOpenSharedCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	activity := telemetry.ActivityUpdate{ClickShared: 1}
	telemetry.UpdateActivityWrap(ctx, activity, "click-shared")
	return nil, fmt.Errorf("shared sessions are not available in this version of prompt (stay tuned)")
}

func SessionOpenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	activate := resolveBool(pk.Kwargs["activate"], true)
	newName := pk.Kwargs["name"]
	if newName != "" {
		err := validateName(newName, "session")
		if err != nil {
			return nil, err
		}
	}
	update, newSessionId, newScreenId, err := sstore.InsertSessionWithName(ctx, newName, activate)
	if err != nil {
		return nil, err
	}
	uiContextCopy := *pk.UIContext
	uiContextCopy.SessionId = newSessionId
	uiContextCopy.ScreenId = newScreenId
	crUpdate, err := doNewTabConnectLocal(ctx, newScreenId, &uiContextCopy)
	if err != nil {
		return nil, err
	}
	update.Merge(crUpdate)
	return update, nil
}

func SessionEnsureOneCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	numSessions, err := sstore.GetSessionCount(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot get number of sessions: %v", err)
	}
	if numSessions > 0 {
		return nil, nil
	}
	return SessionOpenCommand(ctx, pk)
}

func makeExternLink(urlStr string) string {
	return fmt.Sprintf(`https://extern?%s`, url.QueryEscape(urlStr))
}

func ScreenWebShareCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	return nil, fmt.Errorf("websharing is no longer available")
}

func SessionDeleteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, 0) // don't force R_Session
	if err != nil {
		return nil, err
	}
	sessionId := ""
	if len(pk.Args) >= 1 {
		ritem, err := resolveSession(ctx, pk.Args[0], ids.SessionId)
		if err != nil {
			return nil, fmt.Errorf("/session:delete error resolving session %q: %w", pk.Args[0], err)
		}
		if ritem == nil {
			return nil, fmt.Errorf("/session:delete session %q not found", pk.Args[0])
		}
		sessionId = ritem.Id
	} else {
		sessionId = ids.SessionId
	}
	if sessionId == "" {
		return nil, fmt.Errorf("/session:delete no sessionid found")
	}
	update, err := sstore.DeleteSession(ctx, sessionId)
	if err != nil {
		return nil, fmt.Errorf("cannot delete session: %v", err)
	}
	return update, nil
}

func SessionArchiveCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, 0) // don't force R_Session
	if err != nil {
		return nil, err
	}
	sessionId := ""
	if len(pk.Args) >= 1 {
		ritem, err := resolveSession(ctx, pk.Args[0], ids.SessionId)
		if err != nil {
			return nil, fmt.Errorf("/session:archive error resolving session %q: %w", pk.Args[0], err)
		}
		if ritem == nil {
			return nil, fmt.Errorf("/session:archive session %q not found", pk.Args[0])
		}
		sessionId = ritem.Id
	} else {
		sessionId = ids.SessionId
	}
	if sessionId == "" {
		return nil, fmt.Errorf("/session:archive no sessionid found")
	}
	archiveVal := true
	if len(pk.Args) >= 2 {
		archiveVal = resolveBool(pk.Args[1], true)
	}
	if archiveVal {
		update, err := sstore.ArchiveSession(ctx, sessionId)
		if err != nil {
			return nil, fmt.Errorf("cannot archive session: %v", err)
		}
		update.AddUpdate(sstore.InfoMsgType{
			InfoMsg: "session archived",
		})
		return update, nil
	} else {
		activate := resolveBool(pk.Kwargs["activate"], false)
		update, err := sstore.UnArchiveSession(ctx, sessionId, activate)
		if err != nil {
			return nil, fmt.Errorf("cannot un-archive session: %v", err)
		}
		update.AddUpdate(sstore.InfoMsgType{
			InfoMsg: "session un-archived",
		})
		return update, nil
	}
}

func ScreenShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	screen, err := sstore.GetScreenById(ctx, ids.ScreenId)
	if err != nil {
		return nil, fmt.Errorf("cannot get screen: %v", err)
	}
	if screen == nil {
		return nil, fmt.Errorf("screen not found")
	}
	statePtr, err := sstore.GetRemoteStatePtr(ctx, ids.SessionId, ids.ScreenId, ids.Remote.RemotePtr)
	if err != nil {
		return nil, fmt.Errorf("cannot resolve current screen stateptr: %v", err)
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "screenid", screen.ScreenId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "name", screen.Name))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "screenidx", screen.ScreenIdx))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "tabcolor", screen.ScreenOpts.TabColor))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "tabicon", screen.ScreenOpts.TabIcon))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "selectedline", screen.SelectedLine))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "curremote", GetFullRemoteDisplayName(&screen.CurRemote, &ids.Remote.RState)))
	if statePtr != nil {
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "stateptr-base", statePtr.BaseHash))
		buf.WriteString(fmt.Sprintf("  %-15s %v\n", "stateptr-diff", statePtr.DiffHashArr))
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: "screen info",
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func TermSetThemeCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	id, ok := pk.Kwargs["id"]
	if !ok {
		return nil, fmt.Errorf("id key not provided")
	}
	themeName, themeNameOk := pk.Kwargs["name"]
	feOpts := clientData.FeOpts
	if feOpts.TermTheme == nil {
		feOpts.TermTheme = make(map[string]string)
	}
	if themeNameOk && themeName != "" {
		feOpts.TermTheme[id] = themeName
	} else {
		delete(feOpts.TermTheme, id)
	}
	err = sstore.UpdateClientFeOpts(ctx, feOpts)
	if err != nil {
		return nil, fmt.Errorf("error updating client feopts: %v", err)
	}
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*clientData)
	return update, nil
}

func SessionShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session)
	if err != nil {
		return nil, err
	}
	session, err := sstore.GetSessionById(ctx, ids.SessionId)
	if err != nil {
		return nil, fmt.Errorf("cannot get session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found")
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "sessionid", session.SessionId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "name", session.Name))
	if session.SessionIdx != 0 {
		buf.WriteString(fmt.Sprintf("  %-15s %d\n", "index", session.SessionIdx))
	}
	if session.Archived {
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "archived", "true"))
		ts := time.UnixMilli(session.ArchivedTs)
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "archivedts", ts.Format(TsFormatStr)))
	}
	stats, err := sstore.GetSessionStats(ctx, ids.SessionId)
	if err != nil {
		return nil, fmt.Errorf("error getting session stats: %w", err)
	}
	var screenArchiveStr string
	if stats.NumArchivedScreens > 0 {
		screenArchiveStr = fmt.Sprintf(" (%d archived)", stats.NumArchivedScreens)
	}
	buf.WriteString(fmt.Sprintf("  %-15s %d%s\n", "screens", stats.NumScreens, screenArchiveStr))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "lines", stats.NumLines))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "cmds", stats.NumCmds))
	buf.WriteString(fmt.Sprintf("  %-15s %0.2fM\n", "disksize", float64(stats.DiskStats.TotalSize)/1000000))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "disk-location", stats.DiskStats.Location))
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: "session info",
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func SessionShowAllCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	sessions, err := sstore.GetBareSessions(ctx)
	if err != nil {
		return nil, fmt.Errorf("error retrieving sessions: %v", err)
	}
	var buf bytes.Buffer
	for _, session := range sessions {
		var archivedStr string
		if session.Archived {
			archivedStr = " (archived)"
		}
		sessionIdxStr := "-"
		if session.SessionIdx != 0 {
			sessionIdxStr = strconv.Itoa(int(session.SessionIdx))
		}
		outStr := fmt.Sprintf("%-30s %s  %s\n", session.Name+archivedStr, session.SessionId, sessionIdxStr)
		buf.WriteString(outStr)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: "all sessions",
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func SessionSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session)
	if err != nil {
		return nil, err
	}
	var varsUpdated []string
	if pk.Kwargs["name"] != "" {
		newName := pk.Kwargs["name"]
		err = validateName(newName, "session")
		if err != nil {
			return nil, err
		}
		err = sstore.SetSessionName(ctx, ids.SessionId, newName)
		if err != nil {
			return nil, fmt.Errorf("setting session name: %v", err)
		}
		varsUpdated = append(varsUpdated, "name")
	}
	if len(varsUpdated) == 0 {
		return nil, fmt.Errorf("/session:set no updates, can set %s", formatStrs([]string{"name", "pos"}, "or", false))
	}
	bareSession, err := sstore.GetBareSessionById(ctx, ids.SessionId)
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*bareSession, sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("session updated %s", formatStrs(varsUpdated, "and", false)),
		TimeoutMs: 2000,
	})
	return update, nil
}

func SleepCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	sleepTimeLimit := 10000
	if len(pk.Args) < 1 {
		return nil, fmt.Errorf("no argument found - usage: /sleep [ms]")
	}
	sleepArg := pk.Args[0]
	sleepArgInt, err := strconv.Atoi(sleepArg)
	if err != nil {
		return nil, fmt.Errorf("couldn't parse sleep arg: %v", err)
	}
	if sleepArgInt > sleepTimeLimit {
		return nil, fmt.Errorf("sleep arg is too long, max value is %v", sleepTimeLimit)
	}
	time.Sleep(time.Duration(sleepArgInt) * time.Millisecond)
	update := scbus.MakeUpdatePacket()
	return update, nil
}

func MainViewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) < 1 {
		return nil, fmt.Errorf("no argument found - usage: /mainview [view]")
	}
	update := scbus.MakeUpdatePacket()
	mainViewArg := pk.Args[0]
	if mainViewArg == sstore.MainViewSession {
		update.AddUpdate(&MainViewUpdate{MainView: sstore.MainViewSession})
	} else if mainViewArg == sstore.MainViewConnections {
		update.AddUpdate(&MainViewUpdate{MainView: sstore.MainViewConnections})
	} else if mainViewArg == sstore.MainViewSettings {
		update.AddUpdate(&MainViewUpdate{MainView: sstore.MainViewSettings})
	} else if mainViewArg == sstore.MainViewHistory {
		return nil, fmt.Errorf("use /history instead")
	} else if mainViewArg == sstore.MainViewBookmarks {
		return nil, fmt.Errorf("use /bookmarks instead")
	} else {
		return nil, fmt.Errorf("unrecognized main view")
	}
	return update, nil
}

func SessionCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, 0)
	if err != nil {
		return nil, err
	}
	firstArg := firstArg(pk)
	if firstArg == "" {
		return nil, fmt.Errorf("usage /session [name|id|pos], no param specified")
	}
	ritem, err := resolveSession(ctx, firstArg, ids.SessionId)
	if err != nil {
		return nil, err
	}
	err = sstore.SetActiveSessionId(ctx, ritem.Id)
	if err != nil {
		return nil, err
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.ActiveSessionIdUpdate(ritem.Id))
	update.AddUpdate(sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("switched to session %q", ritem.Name),
		TimeoutMs: 2000,
	})

	// Reset the status indicator for the new active screen
	session, err := sstore.GetSessionById(ctx, ritem.Id)
	if err != nil {
		return nil, fmt.Errorf("cannot get session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found")
	}
	err = sstore.ResetStatusIndicator_Update(update, session.ActiveScreenId)
	if err != nil {
		// this is not a fatal error, just log it
		log.Printf("error resetting status indicator after session command: %v\n", err)
	}

	return update, nil
}

type statePtrInfoType struct {
	IsDiff    bool
	BaseHash  string
	DiffHash  string
	StateSize int
}

func getStatePtrInfo(ctx context.Context, statePtr *packet.ShellStatePtr) (statePtrInfoType, error) {
	rtn := statePtrInfoType{}
	if statePtr == nil {
		return rtn, fmt.Errorf("stateptr is nil")
	}
	if len(statePtr.DiffHashArr) > 1 {
		return rtn, fmt.Errorf("stateptr has more than 1 diffhash")
	}
	if len(statePtr.DiffHashArr) == 1 {
		rtn.IsDiff = true
		rtn.BaseHash = statePtr.BaseHash
		rtn.DiffHash = statePtr.DiffHashArr[0]
		stateDiff, err := sstore.GetStateDiff(ctx, rtn.DiffHash)
		if err != nil {
			return rtn, fmt.Errorf("cannot get state diff: %w", err)
		}
		_, encodedDiff := stateDiff.EncodeAndHash()
		rtn.StateSize = len(encodedDiff)
	} else {
		rtn.BaseHash = statePtr.BaseHash
		state, err := sstore.GetStateBase(ctx, rtn.BaseHash)
		if err != nil {
			return rtn, fmt.Errorf("cannot get state base: %w", err)
		}
		_, encodedState := state.EncodeAndHash()
		rtn.StateSize = len(encodedState)
	}
	return rtn, nil
}

func DebugRemoteInstanceCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	slines, err := sstore.GetScreenLinesById(ctx, ids.ScreenId)
	if err != nil {
		return nil, err
	}
	lines := slines.Lines
	if len(lines) > 100 {
		lines = lines[:100]
	}
	cmdMap := make(map[string]*sstore.CmdType)
	for _, cmd := range slines.Cmds {
		cmdMap[cmd.LineId] = cmd
	}
	cmds := make([]*sstore.CmdType, 0, len(lines))
	for _, line := range lines {
		cmds = append(cmds, cmdMap[line.LineId])
	}
	var outputLines []string
	for idx, cmd := range cmds {
		if cmd == nil || cmd.RtnStatePtr.IsEmpty() {
			continue
		}
		line := lines[idx]
		info, err := getStatePtrInfo(ctx, &cmd.RtnStatePtr)
		if err != nil {
			outputLines = append(outputLines, fmt.Sprintf("line %5d | err %v", line.LineNum, err))
			continue
		}
		outputStr := ""
		if info.IsDiff {
			outputStr = fmt.Sprintf("line %5d | diff %8s-%8s | size %8d", line.LineNum, info.BaseHash[0:8], info.DiffHash[0:8], info.StateSize)
		} else {
			outputStr = fmt.Sprintf("line %5d | base %8s %8s | size %8d", line.LineNum, info.BaseHash[0:8], "", info.StateSize)
		}
		outputLines = append(outputLines, outputStr)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: "remote instance",
		InfoLines: outputLines,
	})
	return update, nil
}

func ClearSudoCache(ctx context.Context, pk *scpacket.FeCommandPacketType) (rtnUpdate scbus.UpdatePacket, rtnErr error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	ids.Remote.MShell.ClearCachedSudoPw()
	pluralize := ""

	clearAll := resolveBool(pk.Kwargs["all"], false)
	if clearAll {
		for _, proc := range remote.GetRemoteMap() {
			proc.ClearCachedSudoPw()
		}
		pluralize = "s"
	}

	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("sudo password%s cleared", pluralize),
		TimeoutMs: 2000,
	})
	return update, nil
}

func RemoteResetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (rtnUpdate scbus.UpdatePacket, rtnErr error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	if !ids.Remote.MShell.IsConnected() {
		return nil, fmt.Errorf("cannot reinit, remote is not connected")
	}
	verbose := resolveBool(pk.Kwargs["verbose"], false)
	shellType, err := resolveShellType(pk.Kwargs["shell"], ids.Remote.ShellType)
	if err != nil {
		return nil, err
	}
	termOpts, err := GetUITermOpts(pk.UIContext.WinSize, DefaultPTERM)
	if err != nil {
		return nil, fmt.Errorf("cannot make termopts: %w", err)
	}
	pkTermOpts := convertTermOpts(termOpts)
	cmd, err := makeDynCmd(ctx, "reset", ids, pk.GetRawStr(), *pkTermOpts, nil)
	if err != nil {
		return nil, err
	}
	update, err := addLineForCmd(ctx, "/reset", true, ids, cmd, "", nil)
	if err != nil {
		return nil, err
	}
	opts := connectOptsType{
		Verbose:   verbose,
		ShellType: shellType,
		SessionId: ids.SessionId,
		ScreenId:  ids.ScreenId,
		RPtr:      ids.Remote.RemotePtr,
	}
	go doAsyncResetCommand(ids.Remote.MShell, opts, cmd)
	return update, nil
}

type connectOptsType struct {
	ShellType string // shell type to connect with
	Verbose   bool   // extra output (show state changes, sizes, etc.)
	SessionId string
	ScreenId  string
	RPtr      sstore.RemotePtrType
}

// this does the asynchroneous part of the connection reset
func doAsyncResetCommand(msh *remote.MShellProc, opts connectOptsType, cmd *sstore.CmdType) {
	ctx, cancelFn := context.WithCancel(context.Background())
	defer cancelFn()
	startTime := time.Now()
	var outputPos int64
	var rtnErr error
	exitSuccess := true
	defer func() {
		if rtnErr != nil {
			exitSuccess = false
			writeStringToPty(ctx, cmd, fmt.Sprintf("\r\nerror: %v", rtnErr), &outputPos)
		}
		deferWriteCmdStatus(ctx, cmd, startTime, exitSuccess, outputPos)
	}()
	dataFn := func(data []byte) {
		writeStringToPty(ctx, cmd, string(data), &outputPos)
	}
	origStatePtr, _ := sstore.GetRemoteStatePtr(ctx, opts.SessionId, opts.ScreenId, opts.RPtr)
	ssPk, err := msh.ReInit(ctx, base.MakeCommandKey(cmd.ScreenId, cmd.LineId), opts.ShellType, dataFn, opts.Verbose)
	if err != nil {
		rtnErr = err
		return
	}
	if ssPk == nil || ssPk.State == nil {
		rtnErr = fmt.Errorf("no state received from connection (nil)")
		return
	}
	feState := sstore.FeStateFromShellState(ssPk.State)
	remoteInst, err := sstore.UpdateRemoteState(ctx, opts.SessionId, opts.ScreenId, opts.RPtr, feState, ssPk.State, nil)
	if err != nil {
		rtnErr = err
		return
	}
	newStatePtr := packet.ShellStatePtr{
		BaseHash: ssPk.State.GetHashVal(false),
	}
	if opts.Verbose && origStatePtr != nil {
		statePtrDiff := fmt.Sprintf("oldstate: %v, newstate: %v\r\n", origStatePtr.BaseHash, newStatePtr.BaseHash)
		writeStringToPty(ctx, cmd, statePtrDiff, &outputPos)
		origFullState, _ := sstore.GetFullState(ctx, *origStatePtr)
		newFullState, _ := sstore.GetFullState(ctx, newStatePtr)
		if origFullState != nil && newFullState != nil {
			var diffBuf bytes.Buffer
			rtnstate.DisplayStateUpdateDiff(&diffBuf, *origFullState, *newFullState)
			diffStr := diffBuf.String()
			diffStr = strings.ReplaceAll(diffStr, "\n", "\r\n")
			writeStringToPty(ctx, cmd, diffStr, &outputPos)
		}
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.MakeSessionUpdateForRemote(opts.SessionId, remoteInst))
	scbus.MainUpdateBus.DoUpdate(update)
}

func ResetCwdCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	statePtr, err := sstore.GetRemoteStatePtr(ctx, ids.SessionId, ids.ScreenId, ids.Remote.RemotePtr)
	if err != nil {
		return nil, err
	}
	if statePtr == nil {
		return nil, fmt.Errorf("no shell state found, cannot reset cwd (run /reset)")
	}
	stateDiff, err := sstore.GetCurStateDiffFromPtr(ctx, statePtr)
	if err != nil {
		return nil, err
	}
	feState := ids.Remote.FeState
	feState["cwd"] = "~"
	stateDiff.Cwd = "~"
	stateDiff.GetHashVal(true)
	remoteInst, err := sstore.UpdateRemoteState(ctx, ids.SessionId, ids.ScreenId, ids.Remote.RemotePtr, feState, nil, stateDiff)
	if err != nil {
		return nil, fmt.Errorf("could not update remote state: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.MakeSessionUpdateForRemote(ids.SessionId, remoteInst), sstore.InteractiveUpdate(pk.Interactive))
	update.AddUpdate(sstore.InfoMsgType{InfoMsg: "reset cwd to ~"})
	return update, nil
}

func ClearCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if resolveBool(pk.Kwargs["archive"], false) {
		update, err := sstore.ArchiveScreenLines(ctx, ids.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("clearing screen (archiving): %v", err)
		}
		update.AddUpdate(sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("screen cleared (all lines archived)"),
			TimeoutMs: 2000,
		})
		return update, nil
	} else {
		update, err := sstore.DeleteScreenLines(ctx, ids.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("clearing screen: %v", err)
		}
		update.AddUpdate(sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("screen cleared"),
			TimeoutMs: 2000,
		})
		return update, nil
	}

}

func HistoryPurgeCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/history:purge requires at least one argument (history id)")
	}
	var historyIds []string
	for _, historyArg := range pk.Args {
		_, err := uuid.Parse(historyArg)
		if err != nil {
			return nil, fmt.Errorf("invalid historyid (must be uuid)")
		}
		historyIds = append(historyIds, historyArg)
	}
	err := history.PurgeHistoryByIds(ctx, historyIds)
	if err != nil {
		return nil, fmt.Errorf("/history:purge error purging items: %v", err)
	}
	return sstore.InfoMsgUpdate("removed history items"), nil
}

const HistoryViewPageSize = 50

var cmdFilterLs = regexp.MustCompile(`^ls(\s|$)`)
var cmdFilterCd = regexp.MustCompile(`^cd(\s|$)`)

func historyCmdFilter(hitem *history.HistoryItemType) bool {
	cmdStr := hitem.CmdStr
	if cmdStr == "" || strings.Index(cmdStr, ";") != -1 || strings.Index(cmdStr, "\n") != -1 {
		return true
	}
	if cmdFilterLs.MatchString(cmdStr) {
		return false
	}
	if cmdFilterCd.MatchString(cmdStr) {
		return false
	}
	return true
}

func HistoryViewAllCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	_, err := resolveUiIds(ctx, pk, 0)
	if err != nil {
		return nil, err
	}
	offset, err := resolveNonNegInt(pk.Kwargs["offset"], 0)
	if err != nil {
		return nil, err
	}
	rawOffset, err := resolveNonNegInt(pk.Kwargs["rawoffset"], 0)
	if err != nil {
		return nil, err
	}
	opts := history.HistoryQueryOpts{MaxItems: HistoryViewPageSize, Offset: offset, RawOffset: rawOffset}
	if pk.Kwargs["text"] != "" {
		opts.SearchText = pk.Kwargs["text"]
	}
	if pk.Kwargs["searchsession"] != "" {
		sessionId, err := resolveSessionArg(pk.Kwargs["searchsession"])
		if err != nil {
			return nil, fmt.Errorf("invalid searchsession: %v", err)
		}
		opts.SessionId = sessionId
	}
	if pk.Kwargs["searchremote"] != "" {
		rptr, err := resolveRemoteArg(pk.Kwargs["searchremote"])
		if err != nil {
			return nil, fmt.Errorf("invalid searchremote: %v", err)
		}
		if rptr != nil {
			opts.RemoteId = rptr.RemoteId
		}
	}
	if pk.Kwargs["fromts"] != "" {
		fromTs, err := resolvePosInt(pk.Kwargs["fromts"], 0)
		if err != nil {
			// no error here anymore (otherwise it jams up the frontend, just ignore and set to 0)
			opts.FromTs = 0
		}
		if fromTs > 0 {
			opts.FromTs = int64(fromTs)
		}
	}
	if pk.Kwargs["meta"] != "" {
		opts.NoMeta = !resolveBool(pk.Kwargs["meta"], true)
	}
	if resolveBool(pk.Kwargs["filter"], false) {
		opts.FilterFn = historyCmdFilter
	}
	if err != nil {
		return nil, fmt.Errorf("invalid meta arg (must be boolean): %v", err)
	}
	hresult, err := history.GetHistoryItems(ctx, opts)
	if err != nil {
		return nil, err
	}
	hvdata := &history.HistoryViewData{
		Items:         hresult.Items,
		Offset:        hresult.Offset,
		RawOffset:     hresult.RawOffset,
		NextRawOffset: hresult.NextRawOffset,
		HasMore:       hresult.HasMore,
	}
	lines, cmds, err := history.GetLineCmdsFromHistoryItems(ctx, hvdata.Items)
	if err != nil {
		return nil, err
	}
	hvdata.Lines = lines
	hvdata.Cmds = cmds
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(&MainViewUpdate{MainView: sstore.MainViewHistory, HistoryView: hvdata})
	return update, nil
}

const DefaultMaxHistoryItems = 10000

func HistoryCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	maxItems, err := resolvePosInt(pk.Kwargs["maxitems"], DefaultMaxHistoryItems)
	if err != nil {
		return nil, fmt.Errorf("invalid maxitems value '%s' (must be a number): %v", pk.Kwargs["maxitems"], err)
	}
	if maxItems < 0 {
		return nil, fmt.Errorf("invalid maxitems value '%d' (cannot be negative)", maxItems)
	}
	if maxItems == 0 {
		maxItems = DefaultMaxHistoryItems
	}
	htype := HistoryTypeScreen
	hSessionId := ids.SessionId
	hScreenId := ids.ScreenId
	if pk.Kwargs["type"] != "" {
		htype = pk.Kwargs["type"]
		if htype != HistoryTypeScreen && htype != HistoryTypeSession && htype != HistoryTypeGlobal {
			return nil, fmt.Errorf("invalid history type '%s', valid types: %s", htype, formatStrs([]string{HistoryTypeScreen, HistoryTypeSession, HistoryTypeGlobal}, "or", false))
		}
	}
	if htype == HistoryTypeGlobal {
		hSessionId = ""
		hScreenId = ""
	} else if htype == HistoryTypeSession {
		hScreenId = ""
	}
	hopts := history.HistoryQueryOpts{MaxItems: maxItems, SessionId: hSessionId, ScreenId: hScreenId}
	hresult, err := history.GetHistoryItems(ctx, hopts)
	if err != nil {
		return nil, err
	}
	show := !resolveBool(pk.Kwargs["noshow"], false)
	if show {
		telemetry.UpdateActivityWrap(ctx, telemetry.ActivityUpdate{HistoryView: 1}, "history")
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(history.HistoryInfoType{
		HistoryType: htype,
		SessionId:   ids.SessionId,
		ScreenId:    ids.ScreenId,
		Items:       hresult.Items,
		Show:        show,
	})
	return update, nil
}

func splitLinesForInfo(str string) []string {
	rtn := strings.Split(str, "\n")
	if rtn[len(rtn)-1] == "" {
		return rtn[:len(rtn)-1]
	}
	return rtn
}

func resizeRunningCommand(ctx context.Context, cmd *sstore.CmdType, newCols int) error {
	feInput := scpacket.MakeFeInputPacket()
	feInput.CK = base.MakeCommandKey(cmd.ScreenId, cmd.LineId)
	feInput.WinSize = &packet.WinSize{Rows: int(cmd.TermOpts.Rows), Cols: newCols}
	msh := remote.GetRemoteById(cmd.Remote.RemoteId)
	if msh == nil {
		return fmt.Errorf("cannot resize, cmd remote not found")
	}
	err := msh.HandleFeInput(feInput)
	if err != nil {
		return err
	}
	newTermOpts := cmd.TermOpts
	newTermOpts.Cols = int64(newCols)
	err = sstore.UpdateCmdTermOpts(ctx, cmd.ScreenId, cmd.LineId, newTermOpts)
	if err != nil {
		return err
	}
	return nil
}

func ScreenResizeCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	colsStr := pk.Kwargs["cols"]
	if colsStr == "" {
		return nil, fmt.Errorf("/screen:resize requires a numeric 'cols' argument")
	}
	cols, err := strconv.Atoi(colsStr)
	if err != nil {
		return nil, fmt.Errorf("/screen:resize requires a numeric 'cols' argument: %v", err)
	}
	if cols <= 0 {
		return nil, fmt.Errorf("/screen:resize invalid zero/negative 'cols' argument")
	}
	cols = base.BoundInt(cols, shexec.MinTermCols, shexec.MaxTermCols)
	runningCmds, err := sstore.GetRunningScreenCmds(ctx, ids.ScreenId)
	if err != nil {
		return nil, fmt.Errorf("/screen:resize cannot get running commands: %v", err)
	}
	if len(runningCmds) == 0 {
		return nil, nil
	}
	includeMap := resolveCommaSepListToMap(pk.Kwargs["include"])
	excludeMap := resolveCommaSepListToMap(pk.Kwargs["exclude"])
	for _, cmd := range runningCmds {
		if excludeMap[cmd.LineId] {
			continue
		}
		if len(includeMap) > 0 && !includeMap[cmd.LineId] {
			continue
		}
		if int(cmd.TermOpts.Cols) != cols {
			resizeRunningCommand(ctx, cmd, cols)
		}
	}
	return nil, nil
}

func LineCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	return nil, fmt.Errorf("/line requires a subcommand: %s", formatStrs([]string{"show", "star", "hide", "delete", "setheight", "set"}, "or", false))
}

func LineSetHeightCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) != 2 {
		return nil, fmt.Errorf("/line:setheight requires 2 arguments (linearg and height)")
	}
	lineArg := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	heightVal, err := resolveNonNegInt(pk.Args[1], 0)
	if err != nil {
		return nil, fmt.Errorf("/line:setheight invalid height val: %v", err)
	}
	if heightVal > 10000 {
		return nil, fmt.Errorf("/line:setheight invalid height val (too large): %d", heightVal)
	}
	err = sstore.UpdateLineHeight(ctx, ids.ScreenId, lineId, heightVal)
	if err != nil {
		return nil, fmt.Errorf("/line:setheight error updating height: %v", err)
	}
	// we don't need to pass the updated line height (it is "write only")
	return nil, nil
}

func LineRestartCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	var lineId string
	if len(pk.Args) >= 1 {
		lineArg := pk.Args[0]
		resolvedLineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
		if err != nil {
			return nil, fmt.Errorf("error looking up lineid: %v", err)
		}
		lineId = resolvedLineId
	} else {
		selectedLineId, err := sstore.GetScreenSelectedLineId(ctx, ids.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("error getting selected lineid: %v", err)
		}
		lineId = selectedLineId
	}
	if lineId == "" {
		return nil, fmt.Errorf("%s requires a lineid to operate on", GetCmdStr(pk))
	}
	line, cmd, err := sstore.GetLineCmdByLineId(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("error getting line: %v", err)
	}
	if line == nil {
		return nil, fmt.Errorf("line not found")
	}
	if cmd == nil {
		return nil, fmt.Errorf("cannot restart line (no cmd found)")
	}
	if cmd.Status == sstore.CmdStatusRunning || cmd.Status == sstore.CmdStatusDetached {
		killCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		err = ids.Remote.MShell.KillRunningCommandAndWait(killCtx, base.MakeCommandKey(ids.ScreenId, lineId))
		if err != nil {
			return nil, err
		}
	}
	ids.Remote.MShell.ResetDataPos(base.MakeCommandKey(ids.ScreenId, lineId))
	err = sstore.ClearCmdPtyFile(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("error clearing existing pty file: %v", err)
	}
	runPacket := packet.MakeRunPacket()
	runPacket.ReqId = uuid.New().String()
	runPacket.CK = base.MakeCommandKey(ids.ScreenId, lineId)
	runPacket.UsePty = true
	// TODO how can we preseve the original termopts?
	runPacket.TermOpts, err = GetUITermOpts(pk.UIContext.WinSize, DefaultPTERM)
	if err != nil {
		return nil, fmt.Errorf("error getting creating termopts for command: %w", err)
	}
	runPacket.Command = cmd.CmdStr
	runPacket.ReturnState = false
	rcOpts := remote.RunCommandOpts{
		SessionId:          ids.SessionId,
		ScreenId:           ids.ScreenId,
		RemotePtr:          ids.Remote.RemotePtr,
		StatePtr:           &cmd.StatePtr,
		NoCreateCmdPtyFile: true,
	}
	cmd, callback, err := remote.RunCommand(ctx, rcOpts, runPacket)
	if callback != nil {
		defer callback()
	}
	if err != nil {
		return nil, err
	}
	sstore.IncrementNumRunningCmds(cmd.ScreenId, 1)
	newTs := time.Now().UnixMilli()
	err = sstore.UpdateCmdForRestart(ctx, runPacket.CK, newTs, cmd.CmdPid, cmd.RemotePid, convertTermOpts(runPacket.TermOpts))
	if err != nil {
		return nil, fmt.Errorf("error updating cmd for restart: %w", err)
	}
	line, cmd, err = sstore.GetLineCmdByLineId(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("error getting updated line/cmd: %w", err)
	}
	cmd.Restarted = true
	update := scbus.MakeUpdatePacket()
	sstore.AddLineUpdate(update, line, cmd)
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	screen, focusErr := focusScreenLine(ctx, ids.ScreenId, line.LineNum)
	if focusErr != nil {
		// not a fatal error, so just log
		log.Printf("error focusing screen line: %v\n", focusErr)
	}
	if screen != nil {
		update.AddUpdate(*screen)
	}
	return update, nil
}

func focusScreenLine(ctx context.Context, screenId string, lineNum int64) (*sstore.ScreenType, error) {
	screen, err := sstore.GetScreenById(ctx, screenId)
	if err != nil {
		return nil, fmt.Errorf("error getting screen: %v", err)
	}
	if screen == nil {
		return nil, fmt.Errorf("screen not found")
	}
	updateMap := make(map[string]interface{})
	updateMap[sstore.ScreenField_SelectedLine] = lineNum
	updateMap[sstore.ScreenField_Focus] = sstore.ScreenFocusCmd
	screen, err = sstore.UpdateScreen(ctx, screenId, updateMap)
	if err != nil {
		return nil, fmt.Errorf("error updating screen: %v", err)
	}
	return screen, nil
}

func LineSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) != 1 {
		return nil, fmt.Errorf("/line:set requires 1 argument (linearg)")
	}
	lineArg := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	var varsUpdated []string
	if renderer, found := pk.Kwargs[KwArgRenderer]; found {
		if err = validateRenderer(renderer); err != nil {
			return nil, fmt.Errorf("invalid renderer value: %w", err)
		}
		err = sstore.UpdateLineRenderer(ctx, ids.ScreenId, lineId, renderer)
		if err != nil {
			return nil, fmt.Errorf("error changing line renderer: %v", err)
		}
		varsUpdated = append(varsUpdated, KwArgRenderer)
	}
	if view, found := pk.Kwargs[KwArgView]; found {
		if err = validateRenderer(view); err != nil {
			return nil, fmt.Errorf("invalid view value: %w", err)
		}
		err = sstore.UpdateLineRenderer(ctx, ids.ScreenId, lineId, view)
		if err != nil {
			return nil, fmt.Errorf("error changing line view: %v", err)
		}
		varsUpdated = append(varsUpdated, KwArgView)
	}
	if stateJson, found := pk.Kwargs[KwArgState]; found {
		if len(stateJson) > sstore.MaxLineStateSize {
			return nil, fmt.Errorf("invalid state value (too large), size[%d], max[%d]", len(stateJson), sstore.MaxLineStateSize)
		}
		var stateMap map[string]any
		err = json.Unmarshal([]byte(stateJson), &stateMap)
		if err != nil {
			return nil, fmt.Errorf("invalid state value, cannot parse json: %v", err)
		}
		err = sstore.UpdateLineState(ctx, ids.ScreenId, lineId, stateMap)
		if err != nil {
			return nil, fmt.Errorf("cannot update linestate: %v", err)
		}
		varsUpdated = append(varsUpdated, KwArgState)
	}
	if len(varsUpdated) == 0 {
		return nil, fmt.Errorf("/line:set requires a value to set: %s", formatStrs([]string{KwArgView, KwArgState}, "or", false))
	}
	updatedLine, err := sstore.GetLineById(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("/line:set cannot retrieve updated line: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	sstore.AddLineUpdate(update, updatedLine, nil)
	update.AddUpdate(sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("line updated %s", formatStrs(varsUpdated, "and", false)),
		TimeoutMs: 2000,
	})
	return update, nil
}

func LineViewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) != 3 {
		return nil, fmt.Errorf("usage /line:view [session] [screen] [line]")
	}
	sessionArg := pk.Args[0]
	screenArg := pk.Args[1]
	lineArg := pk.Args[2]
	sessionId, err := resolveSessionArg(sessionArg)
	if err != nil {
		return nil, fmt.Errorf("/line:view invalid session arg: %v", err)
	}
	if sessionId == "" {
		return nil, fmt.Errorf("/line:view no session found")
	}
	screenRItem, err := resolveSessionScreen(ctx, sessionId, screenArg, "")
	if err != nil {
		return nil, fmt.Errorf("/line:view invalid screen arg: %v", err)
	}
	if screenRItem == nil {
		return nil, fmt.Errorf("/line:view no screen found")
	}
	screen, err := sstore.GetScreenById(ctx, screenRItem.Id)
	if err != nil {
		return nil, fmt.Errorf("/line:view could not get screen: %v", err)
	}
	lineRItem, err := resolveLine(ctx, sessionId, screen.ScreenId, lineArg, "")
	if err != nil {
		return nil, fmt.Errorf("/line:view invalid line arg: %v", err)
	}
	update, err := sstore.SwitchScreenById(ctx, sessionId, screenRItem.Id)
	if err != nil {
		return nil, err
	}
	if lineRItem != nil {
		updateMap := make(map[string]interface{})
		updateMap[sstore.ScreenField_SelectedLine] = lineRItem.Num
		updateMap[sstore.ScreenField_AnchorLine] = lineRItem.Num
		updateMap[sstore.ScreenField_AnchorOffset] = 0
		screen, err = sstore.UpdateScreen(ctx, screenRItem.Id, updateMap)
		if err != nil {
			return nil, err
		}
		update.AddUpdate(*screen)
	}
	return update, nil
}

func BookmarksShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	// no resolve ui ids!
	var tagName string // defaults to ''
	if len(pk.Args) > 0 {
		tagName = pk.Args[0]
	}
	bms, err := bookmarks.GetBookmarks(ctx, tagName)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve bookmarks: %v", err)
	}
	telemetry.UpdateActivityWrap(ctx, telemetry.ActivityUpdate{BookmarksView: 1}, "bookmarks")
	update := scbus.MakeUpdatePacket()

	update.AddUpdate(&MainViewUpdate{
		MainView:      sstore.MainViewBookmarks,
		BookmarksView: &bookmarks.BookmarksUpdate{Bookmarks: bms},
	})
	return update, nil
}

func BookmarkSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/bookmark:set requires one argument (bookmark id)")
	}
	bookmarkArg := pk.Args[0]
	bookmarkId, err := bookmarks.GetBookmarkIdByArg(ctx, bookmarkArg)
	if err != nil {
		return nil, fmt.Errorf("error trying to resolve bookmark: %v", err)
	}
	if bookmarkId == "" {
		return nil, fmt.Errorf("bookmark not found")
	}
	editMap := make(map[string]interface{})
	if descStr, found := pk.Kwargs["desc"]; found {
		editMap[bookmarks.BookmarkField_Desc] = descStr
	}
	if cmdStr, found := pk.Kwargs["cmdstr"]; found {
		editMap[bookmarks.BookmarkField_CmdStr] = cmdStr
	}
	if len(editMap) == 0 {
		return nil, fmt.Errorf("no fields set, can set %s", formatStrs([]string{"desc", "cmdstr"}, "or", false))
	}
	err = bookmarks.EditBookmark(ctx, bookmarkId, editMap)
	if err != nil {
		return nil, fmt.Errorf("error trying to edit bookmark: %v", err)
	}
	bm, err := bookmarks.GetBookmarkById(ctx, bookmarkId, "")
	if err != nil {
		return nil, fmt.Errorf("error retrieving edited bookmark: %v", err)
	}
	bms := []*bookmarks.BookmarkType{bm}
	update := scbus.MakeUpdatePacket()
	bookmarks.AddBookmarksUpdate(update, bms, nil)
	update.AddUpdate(sstore.InfoMsgUpdate("bookmark edited"))
	return update, nil
}

func BookmarkDeleteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/bookmark:delete requires one argument (bookmark id)")
	}
	bookmarkArg := pk.Args[0]
	bookmarkId, err := bookmarks.GetBookmarkIdByArg(ctx, bookmarkArg)
	if err != nil {
		return nil, fmt.Errorf("error trying to resolve bookmark: %v", err)
	}
	if bookmarkId == "" {
		return nil, fmt.Errorf("bookmark not found")
	}
	err = bookmarks.DeleteBookmark(ctx, bookmarkId)
	if err != nil {
		return nil, fmt.Errorf("error deleting bookmark: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	bms := []*bookmarks.BookmarkType{{BookmarkId: bookmarkId, Remove: true}}
	bookmarks.AddBookmarksUpdate(update, bms, nil)
	update.AddUpdate(sstore.InfoMsgUpdate("bookmark deleted"))
	return update, nil
}

func LineBookmarkCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/line:bookmark requires an argument (line number or id)")
	}
	lineArg := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	if lineId == "" {
		return nil, fmt.Errorf("line %q not found", lineArg)
	}
	_, cmdObj, err := sstore.GetLineCmdByLineId(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("/line:bookmark error getting line: %v", err)
	}
	if cmdObj == nil {
		return nil, fmt.Errorf("cannot bookmark non-cmd line")
	}
	existingBmIds, err := bookmarks.GetBookmarkIdsByCmdStr(ctx, cmdObj.CmdStr)
	if err != nil {
		return nil, fmt.Errorf("error trying to retrieve current boookmarks: %v", err)
	}
	var newBmId string
	if len(existingBmIds) > 0 {
		newBmId = existingBmIds[0]
	} else {
		newBm := &bookmarks.BookmarkType{
			BookmarkId:  uuid.New().String(),
			CreatedTs:   time.Now().UnixMilli(),
			CmdStr:      cmdObj.CmdStr,
			Alias:       "",
			Tags:        nil,
			Description: "",
		}
		err = bookmarks.InsertBookmark(ctx, newBm)
		if err != nil {
			return nil, fmt.Errorf("cannot insert bookmark: %v", err)
		}
		newBmId = newBm.BookmarkId
	}
	bms, err := bookmarks.GetBookmarks(ctx, "")
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(&MainViewUpdate{
		MainView:      sstore.MainViewBookmarks,
		BookmarksView: &bookmarks.BookmarksUpdate{Bookmarks: bms, SelectedBookmark: newBmId},
	})
	return update, nil
}

func LinePinCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	return nil, nil
}

func LineStarCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/line:star requires an argument (line number or id)")
	}
	if len(pk.Args) > 2 {
		return nil, fmt.Errorf("/line:star only takes up to 2 arguments (line-number and star-value)")
	}
	lineArg := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	if lineId == "" {
		return nil, fmt.Errorf("line %q not found", lineArg)
	}
	starVal, err := resolveNonNegInt(pk.Args[1], 1)
	if err != nil {
		return nil, fmt.Errorf("/line:star invalid star-value (not integer): %v", err)
	}
	if starVal > 5 {
		return nil, fmt.Errorf("/line:star invalid star-value must be in the range of 0-5")
	}
	err = sstore.UpdateLineStar(ctx, ids.ScreenId, lineId, starVal)
	if err != nil {
		return nil, fmt.Errorf("/line:star error updating star value: %v", err)
	}
	lineObj, err := sstore.GetLineById(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("/line:star error getting line: %v", err)
	}
	if lineObj == nil {
		// no line (which is strange given we checked for it above).  just return a nop.
		return nil, nil
	}
	update := scbus.MakeUpdatePacket()
	sstore.AddLineUpdate(update, lineObj, nil)
	return update, nil
}

func LineArchiveCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/line:archive requires an argument (line number or id)")
	}
	lineArg := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	if lineId == "" {
		return nil, fmt.Errorf("line %q not found", lineArg)
	}
	shouldArchive := true
	if len(pk.Args) >= 2 {
		shouldArchive = resolveBool(pk.Args[1], true)
	}
	err = sstore.SetLineArchivedById(ctx, ids.ScreenId, lineId, shouldArchive)
	if err != nil {
		return nil, fmt.Errorf("/line:archive error updating hidden status: %v", err)
	}
	lineObj, err := sstore.GetLineById(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("/line:archive error getting line: %v", err)
	}
	if lineObj == nil {
		// no line (which is strange given we checked for it above).  just return a nop.
		return nil, nil
	}
	update := scbus.MakeUpdatePacket()
	sstore.AddLineUpdate(update, lineObj, nil)
	return update, nil
}

func LineMinimizeCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/line:minimize requires arguments (line number or id and min value)")
	}
	if len(pk.Args) > 2 {
		return nil, fmt.Errorf("/line:minimize only takes up to 2 argument (line number or id and min value)")
	}
	lineArg1 := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg1)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	if lineId == "" {
		return nil, fmt.Errorf("line %q not found", lineArg1)
	}
	lineArg2 := pk.Args[1]
	minVal := resolveBool(lineArg2, true)
	lineState := make(map[string]any)
	if minVal {
		lineState[sstore.LineState_Min] = minVal
	} else {
		// Remove sstore.LineState_Min from lineState if it exists
		delete(lineState, sstore.LineState_Min)
	}
	err = sstore.UpdateLineState(ctx, ids.ScreenId, lineId, lineState)
	if err != nil {
		return nil, fmt.Errorf("cannot update linestate: %v", err)
	}
	lineObj, err := sstore.GetLineById(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("/line:minimize cannot retrieve updated line: %v", err)
	}
	if lineObj == nil {
		// no line (which is strange given we checked for it above).  just return a nop.
		return nil, nil
	}
	update := scbus.MakeUpdatePacket()
	sstore.AddLineUpdate(update, lineObj, nil)
	return update, nil
}

func LineDeleteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/line:delete requires at least one argument (line number or id)")
	}
	var lineIds []string
	for _, lineArg := range pk.Args {
		lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
		if err != nil {
			return nil, fmt.Errorf("error looking up lineid: %v", err)
		}
		if lineId == "" {
			return nil, fmt.Errorf("line %q not found", lineArg)
		}
		lineIds = append(lineIds, lineId)
	}
	err = sstore.DeleteLinesByIds(ctx, ids.ScreenId, lineIds)
	if err != nil {
		return nil, fmt.Errorf("/line:delete error deleting lines: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	for _, lineId := range lineIds {
		line := &sstore.LineType{ScreenId: ids.ScreenId, LineId: lineId, Remove: true}
		sstore.AddLineUpdate(update, line, nil)
	}
	screen, err := sstore.FixupScreenSelectedLine(ctx, ids.ScreenId)
	if err != nil {
		return nil, fmt.Errorf("/line:delete error fixing up screen: %v", err)
	}
	if screen != nil {
		update.AddUpdate(*screen)
	}
	return update, nil
}

func LineShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/line:show requires an argument (line number or id)")
	}
	lineArg := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	if lineId == "" {
		return nil, fmt.Errorf("line %q not found", lineArg)
	}
	line, cmd, err := sstore.GetLineCmdByLineId(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("error getting line: %v", err)
	}
	if line == nil {
		return nil, fmt.Errorf("line %q not found", lineArg)
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "screenid", line.ScreenId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "lineid", line.LineId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "type", line.LineType))
	lineNumStr := strconv.FormatInt(line.LineNum, 10)
	if line.LineNumTemp {
		lineNumStr = "~" + lineNumStr
	}
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "linenum", lineNumStr))
	ts := time.UnixMilli(line.Ts)
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "ts", ts.Format(TsFormatStr)))
	if line.Ephemeral {
		buf.WriteString(fmt.Sprintf("  %-15s %v\n", "ephemeral", true))
	}
	if line.Renderer != "" {
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "renderer", line.Renderer))
	} else {
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "renderer", "terminal"))
	}
	if cmd != nil {
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "remote", cmd.Remote.MakeFullRemoteRef()))
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "status", cmd.Status))
		if cmd.FeState["cwd"] != "" {
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "cwd", cmd.FeState["cwd"]))
		}
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "termopts", formatTermOpts(cmd.TermOpts)))
		if cmd.TermOpts != cmd.OrigTermOpts {
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "orig-termopts", formatTermOpts(cmd.OrigTermOpts)))
		}
		if cmd.RtnState {
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "rtnstate", "true"))
		}
		stat, _ := sstore.StatCmdPtyFile(ctx, cmd.ScreenId, cmd.LineId)
		if stat == nil {
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "file", "-"))
		} else {
			fileDataStr := fmt.Sprintf("v%d data=%d offset=%d max=%s", stat.Version, stat.DataSize, stat.FileOffset, scbase.NumFormatB2(stat.MaxSize))
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "file", stat.Location))
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "file-data", fileDataStr))
		}
		if cmd.RestartTs > 0 {
			restartTs := time.UnixMilli(cmd.RestartTs)
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "restartts", restartTs.Format(TsFormatStr)))
		}
		if cmd.DoneTs != 0 {
			doneTs := time.UnixMilli(cmd.DoneTs)
			buf.WriteString(fmt.Sprintf("  %-15s %s\n", "donets", doneTs.Format(TsFormatStr)))
			buf.WriteString(fmt.Sprintf("  %-15s %d\n", "exitcode", cmd.ExitCode))
			buf.WriteString(fmt.Sprintf("  %-15s %dms\n", "duration", cmd.DurationMs))
		}
	}
	stateStr := dbutil.QuickJson(line.LineState)
	if len(stateStr) > 80 {
		stateStr = stateStr[0:77] + "..."
	}
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "state", stateStr))
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: fmt.Sprintf("line %d info", line.LineNum),
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func SetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	var setMap map[string]map[string]string
	setMap = make(map[string]map[string]string)
	_, err := resolveUiIds(ctx, pk, 0) // best effort
	if err != nil {
		return nil, err
	}
	for argIdx, rawArgVal := range pk.Args {
		eqIdx := strings.Index(rawArgVal, "=")
		if eqIdx == -1 {
			return nil, fmt.Errorf("/set invalid argument %d, does not contain an '='", argIdx)
		}
		argName := rawArgVal[:eqIdx]
		argVal := rawArgVal[eqIdx+1:]
		ok, scopeName, varName := resolveSetArg(argName)
		if !ok {
			return nil, fmt.Errorf("/set invalid setvar %q", argName)
		}
		if _, ok := setMap[scopeName]; !ok {
			setMap[scopeName] = make(map[string]string)
		}
		setMap[scopeName][varName] = argVal
	}
	return nil, nil
}

func makeStreamFilePk(ids resolvedIds, pk *scpacket.FeCommandPacketType) (*packet.StreamFilePacketType, error) {
	cwd := ids.Remote.FeState["cwd"]
	fileArg := pk.Args[0]
	if fileArg == "" {
		return nil, fmt.Errorf("/view:stat file argument must be set (cannot be empty)")
	}
	streamPk := packet.MakeStreamFilePacket()
	streamPk.ReqId = uuid.New().String()
	if filepath.IsAbs(fileArg) {
		streamPk.Path = fileArg
	} else {
		streamPk.Path = filepath.Join(cwd, fileArg)
	}
	return streamPk, nil
}

func ViewStatCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/view:stat requires an argument (file name)")
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	streamPk, err := makeStreamFilePk(ids, pk)
	if err != nil {
		return nil, err
	}
	streamPk.StatOnly = true
	msh := ids.Remote.MShell
	iter, err := msh.StreamFile(ctx, streamPk)
	if err != nil {
		return nil, fmt.Errorf("/view:stat error: %v", err)
	}
	defer iter.Close()
	respIf, err := iter.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("/view:stat error getting response: %v", err)
	}
	resp, ok := respIf.(*packet.StreamFileResponseType)
	if !ok {
		return nil, fmt.Errorf("/view:stat error, bad response packet type: %T", respIf)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("/view:stat error: %s", resp.Error)
	}
	if resp.Info == nil {
		return nil, fmt.Errorf("/view:stat error, no file info")
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "path", resp.Info.Name))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "size", resp.Info.Size))
	modTs := time.UnixMilli(resp.Info.ModTs)
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "modts", modTs.Format(TsFormatStr)))
	buf.WriteString(fmt.Sprintf("  %-15s %v\n", "isdir", resp.Info.IsDir))
	modeStr := fs.FileMode(resp.Info.Perm).String()
	if len(modeStr) > 9 {
		modeStr = modeStr[len(modeStr)-9:]
	}
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "perms", modeStr))
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: fmt.Sprintf("view stat %q", streamPk.Path),
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func ViewTestCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/view:test requires an argument (file name)")
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	streamPk, err := makeStreamFilePk(ids, pk)
	if err != nil {
		return nil, err
	}
	msh := ids.Remote.MShell
	iter, err := msh.StreamFile(ctx, streamPk)
	if err != nil {
		return nil, fmt.Errorf("/view:test error: %v", err)
	}
	defer iter.Close()
	respIf, err := iter.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("/view:test error getting response: %v", err)
	}
	resp, ok := respIf.(*packet.StreamFileResponseType)
	if !ok {
		return nil, fmt.Errorf("/view:test error, bad response packet type: %T", respIf)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("/view:test error: %s", resp.Error)
	}
	if resp.Info == nil {
		return nil, fmt.Errorf("/view:test error, no file info")
	}
	var buf bytes.Buffer
	var numPackets int
	for {
		dataPkIf, err := iter.Next(ctx)
		if err != nil {
			return nil, fmt.Errorf("/view:test error while getting data: %w", err)
		}
		if dataPkIf == nil {
			break
		}
		dataPk, ok := dataPkIf.(*packet.FileDataPacketType)
		if !ok {
			return nil, fmt.Errorf("/view:test invalid data packet type: %T", dataPkIf)
		}
		if dataPk.Error != "" {
			return nil, fmt.Errorf("/view:test error returned while getting data: %s", dataPk.Error)
		}
		numPackets++
		buf.Write(dataPk.Data)
	}
	buf.WriteString(fmt.Sprintf("\n\ntotal packets: %d\n", numPackets))
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: fmt.Sprintf("view file %q", streamPk.Path),
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func CodeEditCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("%s requires an argument (file name)", GetCmdStr(pk))
	}
	// TODO more error checking on filename format?
	if pk.Args[0] == "" {
		return nil, fmt.Errorf("%s argument cannot be empty", GetCmdStr(pk))
	}
	langArg, err := getLangArg(pk)
	if err != nil {
		return nil, fmt.Errorf("%s invalid 'lang': %v", GetCmdStr(pk), err)
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	outputStr := fmt.Sprintf("%s %q", GetCmdStr(pk), pk.Args[0])
	cmd, err := makeStaticCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), []byte(outputStr))
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	// set the line state
	lineState := make(map[string]any)
	lineState[sstore.LineState_Source] = "file"
	lineState[sstore.LineState_File] = pk.Args[0]
	if GetCmdStr(pk) == "codeview" {
		lineState[sstore.LineState_Mode] = "view"
	} else {
		lineState[sstore.LineState_Mode] = "edit"
	}
	if langArg != "" {
		lineState[sstore.LineState_Lang] = langArg
	}
	if _, ok := pk.Kwargs[KwArgMinimap]; ok {
		lineState[sstore.LineState_Minimap] = resolveBool(pk.Kwargs[KwArgMinimap], false)
	}
	update, err := addLineForCmd(ctx, "/"+GetCmdStr(pk), true, ids, cmd, "code", lineState)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	return update, nil
}

func CSVViewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("%s requires an argument (file name)", GetCmdStr(pk))
	}
	// TODO more error checking on filename format?
	if pk.Args[0] == "" {
		return nil, fmt.Errorf("%s argument cannot be empty", GetCmdStr(pk))
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	outputStr := fmt.Sprintf("%s %q", GetCmdStr(pk), pk.Args[0])
	cmd, err := makeStaticCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), []byte(outputStr))
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	// set the line state
	lineState := make(map[string]any)
	lineState[sstore.LineState_Source] = "file"
	lineState[sstore.LineState_File] = pk.Args[0]
	update, err := addLineForCmd(ctx, "/"+GetCmdStr(pk), true, ids, cmd, "csv", lineState)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	return update, nil
}

func ImageViewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("%s requires an argument (file name)", GetCmdStr(pk))
	}
	// TODO more error checking on filename format?
	if pk.Args[0] == "" {
		return nil, fmt.Errorf("%s argument cannot be empty", GetCmdStr(pk))
	}
	filePath := pk.Args[0]
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	outputStr := fmt.Sprintf("%s %q", GetCmdStr(pk), filePath)
	cmd, err := makeStaticCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), []byte(outputStr))
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	// set the line state
	lineState := make(map[string]any)
	lineState[sstore.LineState_Source] = "file"
	lineState[sstore.LineState_File] = filePath
	update, err := addLineForCmd(ctx, "/"+GetCmdStr(pk), false, ids, cmd, "image", lineState)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	return update, nil
}

func PdfViewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("%s requires an argument (file name)", GetCmdStr(pk))
	}
	// TODO more error checking on filename format?
	if pk.Args[0] == "" {
		return nil, fmt.Errorf("%s argument cannot be empty", GetCmdStr(pk))
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	outputStr := fmt.Sprintf("%s %q", GetCmdStr(pk), pk.Args[0])
	cmd, err := makeStaticCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), []byte(outputStr))
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	// set the line state
	lineState := make(map[string]any)
	lineState[sstore.LineState_Source] = "file"
	lineState[sstore.LineState_File] = pk.Args[0]
	update, err := addLineForCmd(ctx, "/"+GetCmdStr(pk), false, ids, cmd, "pdf", lineState)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	return update, nil
}

func MakeReadFileUrl(screenId string, lineId string, filePath string) (string, error) {
	qvals := make(url.Values)
	qvals.Set("screenid", screenId)
	qvals.Set("lineid", lineId)
	qvals.Set("path", filePath)
	qvals.Set("nonce", uuid.New().String())
	hmacStr, err := waveenc.ComputeUrlHmac([]byte(scbase.WaveAuthKey), "/api/read-file", qvals)
	if err != nil {
		return "", fmt.Errorf("error computing hmac-url: %v", err)
	}
	qvals.Set("hmac", hmacStr)
	return "/api/read-file?" + qvals.Encode(), nil
}

func MediaViewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("%s requires an argument (file name)", GetCmdStr(pk))
	}
	// TODO more error checking on filename format?
	if pk.Args[0] == "" {
		return nil, fmt.Errorf("%s argument cannot be empty", GetCmdStr(pk))
	}
	fileName := pk.Args[0]
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	outputStr := fmt.Sprintf("%s %q", GetCmdStr(pk), fileName)
	cmd, err := makeStaticCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), []byte(outputStr))
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	// compute hmac read-file URL
	readFileUrl, err := MakeReadFileUrl(ids.ScreenId, cmd.LineId, fileName)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, fmt.Errorf("error making read-file url: %v", err)
	}
	// set the line state
	lineState := make(map[string]any)
	lineState[sstore.LineState_FileUrl] = readFileUrl
	lineState[sstore.LineState_File] = fileName
	update, err := addLineForCmd(ctx, "/"+GetCmdStr(pk), false, ids, cmd, "media", lineState)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	return update, nil
}

func MarkdownViewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("%s requires an argument (file name)", GetCmdStr(pk))
	}
	// TODO more error checking on filename format?
	if pk.Args[0] == "" {
		return nil, fmt.Errorf("%s argument cannot be empty", GetCmdStr(pk))
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	outputStr := fmt.Sprintf("%s %q", GetCmdStr(pk), pk.Args[0])
	cmd, err := makeStaticCmd(ctx, GetCmdStr(pk), ids, pk.GetRawStr(), []byte(outputStr))
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	// set the line state
	lineState := make(map[string]any)
	lineState[sstore.LineState_Source] = "file"
	lineState[sstore.LineState_File] = pk.Args[0]
	update, err := addLineForCmd(ctx, "/"+GetCmdStr(pk), false, ids, cmd, "markdown", lineState)
	if err != nil {
		// TODO tricky error since the command was a success, but we can't show the output
		return nil, err
	}
	update.AddUpdate(sstore.InteractiveUpdate(pk.Interactive))
	return update, nil
}

func EditTestCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/edit:test requires an argument (file name)")
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_RemoteConnected)
	if err != nil {
		return nil, err
	}
	content, ok := pk.Kwargs["content"]
	if !ok {
		return nil, fmt.Errorf("/edit:test no content for file specified")
	}
	fileArg := pk.Args[0]
	if fileArg == "" {
		return nil, fmt.Errorf("/view:stat file argument must be set (cannot be empty)")
	}
	writePk := packet.MakeWriteFilePacket()
	writePk.ReqId = uuid.New().String()
	writePk.UseTemp = true
	cwd := ids.Remote.FeState["cwd"]
	if filepath.IsAbs(fileArg) {
		writePk.Path = fileArg
	} else {
		writePk.Path = filepath.Join(cwd, fileArg)
	}
	msh := ids.Remote.MShell
	iter, err := msh.PacketRpcIter(ctx, writePk)
	if err != nil {
		return nil, fmt.Errorf("/edit:test error: %v", err)
	}
	// first packet should be WriteFileReady
	readyIf, err := iter.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("/edit:test error while getting ready response: %w", err)
	}
	readyPk, ok := readyIf.(*packet.WriteFileReadyPacketType)
	if !ok {
		return nil, fmt.Errorf("/edit:test bad ready packet received: %T", readyIf)
	}
	if readyPk.Error != "" {
		return nil, fmt.Errorf("/edit:test %s", readyPk.Error)
	}
	dataPk := packet.MakeFileDataPacket(writePk.ReqId)
	dataPk.Data = []byte(content)
	dataPk.Eof = true
	err = msh.SendFileData(dataPk)
	if err != nil {
		return nil, fmt.Errorf("/edit:test error sending data packet: %v", err)
	}
	doneIf, err := iter.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("/edit:test error while getting done response: %w", err)
	}
	donePk, ok := doneIf.(*packet.WriteFileDonePacketType)
	if !ok {
		return nil, fmt.Errorf("/edit:test bad done packet received: %T", doneIf)
	}
	if donePk.Error != "" {
		return nil, fmt.Errorf("/edit:test %s", donePk.Error)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: fmt.Sprintf("edit test, wrote %q", writePk.Path),
	})
	return update, nil
}

func SignalCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("/signal requires a first argument (line number or id)")
	}
	if len(pk.Args) == 1 {
		return nil, fmt.Errorf("/signal requires a second argument (signal name)")
	}
	lineArg := pk.Args[0]
	lineId, err := sstore.FindLineIdByArg(ctx, ids.ScreenId, lineArg)
	if err != nil {
		return nil, fmt.Errorf("error looking up lineid: %v", err)
	}
	line, cmd, err := sstore.GetLineCmdByLineId(ctx, ids.ScreenId, lineId)
	if err != nil {
		return nil, fmt.Errorf("error getting line: %v", err)
	}
	if line == nil {
		return nil, fmt.Errorf("line %q not found", lineArg)
	}
	if cmd == nil {
		return nil, fmt.Errorf("line %q does not have a command", lineArg)
	}
	if cmd.Status != sstore.CmdStatusRunning {
		return nil, fmt.Errorf("line %q command is not running, cannot send signal", lineArg)
	}
	sigArg := pk.Args[1]
	if isAllDigits(sigArg) {
		val, _ := strconv.Atoi(sigArg)
		if val <= 0 || val > MaxSignalNum {
			return nil, fmt.Errorf("signal number is out of bounds: %q", sigArg)
		}
	} else if !strings.HasPrefix(sigArg, "SIG") {
		sigArg = "SIG" + sigArg
	}
	sigArg = strings.ToUpper(sigArg)
	if len(sigArg) > 12 {
		return nil, fmt.Errorf("invalid signal (too long): %q", sigArg)
	}
	if !sigNameRe.MatchString(sigArg) {
		return nil, fmt.Errorf("invalid signal name/number: %q", sigArg)
	}
	msh := remote.GetRemoteById(cmd.Remote.RemoteId)
	if msh == nil {
		return nil, fmt.Errorf("cannot send signal, no remote found for command")
	}
	if !msh.IsConnected() {
		return nil, fmt.Errorf("cannot send signal, remote is not connected")
	}
	inputPk := scpacket.MakeFeInputPacket()
	inputPk.CK = base.MakeCommandKey(cmd.ScreenId, cmd.LineId)
	inputPk.SigName = sigArg
	err = msh.HandleFeInput(inputPk)
	if err != nil {
		return nil, fmt.Errorf("cannot send signal: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgUpdate("sent line %s signal %s", lineArg, sigArg))
	return update, nil
}

func KillServerCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	go func() {
		log.Printf("received /killserver, shutting down\n")
		time.Sleep(1 * time.Second)
		syscall.Kill(syscall.Getpid(), syscall.SIGINT)
	}()
	return nil, nil
}

func DumpStateCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Remote)
	if err != nil {
		return nil, err
	}
	currentState, err := sstore.GetFullState(ctx, *ids.Remote.StatePtr)
	if err != nil {
		return nil, fmt.Errorf("error getting state: %v", err)
	}
	feState := sstore.FeStateFromShellState(currentState)
	shellenv.DumpVarMapFromState(currentState)
	return sstore.InfoMsgUpdate("current connection state sent to log.  festate: %s", dbutil.QuickJson(feState)), nil
}

func ClientCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	return nil, fmt.Errorf("/client requires a subcommand: %s", formatStrs([]string{"show", "set"}, "or", false))
}

func ClientNotifyUpdateWriterCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	pcloud.ResetUpdateWriterNumFailures()
	sstore.NotifyUpdateWriter()
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgUpdate("notified update writer"))
	return update, nil
}

func boolToStr(v bool, trueStr string, falseStr string) string {
	if v {
		return trueStr
	}
	return falseStr
}

func ClientAcceptTosCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	clientOpts := clientData.ClientOpts
	clientOpts.AcceptedTos = time.Now().UnixMilli()
	err = sstore.SetClientOpts(ctx, clientOpts)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %v", err)
	}
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*clientData)
	return update, nil
}

var confirmKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// confirm flags must be all lowercase and only contain letters, numbers, and underscores (and start with letter)
func ClientConfirmFlagCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	// Check for valid arguments length
	if len(pk.Args) < 2 {
		return nil, fmt.Errorf("invalid arguments: expected at least 2, got %d", len(pk.Args))
	}

	// Extract confirmKey and value from pk.Args
	confirmKey := pk.Args[0]
	if !confirmKeyRe.MatchString(confirmKey) {
		return nil, fmt.Errorf("invalid confirm flag key: %s", confirmKey)
	}
	value := resolveBool(pk.Args[1], true)
	validKey := utilfn.ContainsStr(ConfirmFlags, confirmKey)
	if !validKey {
		return nil, fmt.Errorf("invalid confirm flag key: %s", confirmKey)
	}

	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}

	// Initialize ConfirmFlags if it's nil
	if clientData.ClientOpts.ConfirmFlags == nil {
		clientData.ClientOpts.ConfirmFlags = make(map[string]bool)
	}

	// Set the confirm flag
	clientData.ClientOpts.ConfirmFlags[confirmKey] = value

	err = sstore.SetClientOpts(ctx, clientData.ClientOpts)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %v", err)
	}

	// Retrieve updated client data
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}

	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*clientData)

	return update, nil
}

func ClientSetGlobalShortcut(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	newShortcut := firstArg(pk)
	if len(newShortcut) > 50 {
		return nil, fmt.Errorf("invalid shortcut (maxlen = 50)")
	}
	clientOpts := clientData.ClientOpts
	clientOpts.GlobalShortcut = newShortcut
	clientOpts.GlobalShortcutEnabled = (newShortcut != "")
	err = sstore.SetClientOpts(ctx, clientOpts)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %v", err)
	}
	clientData.ClientOpts = clientOpts
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*clientData)
	return update, nil
}

func ClientSetMainSidebarCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}

	// Handle collapsed
	collapsed, ok := pk.Kwargs["collapsed"]
	if !ok {
		return nil, fmt.Errorf("collapsed key not provided")
	}
	collapsedValue := resolveBool(collapsed, false)

	// Handle width
	var width int
	if w, exists := pk.Kwargs["width"]; exists {
		width, err = resolveNonNegInt(w, 0)
		if err != nil {
			return nil, fmt.Errorf("error resolving width: %v", err)
		}
	} else if clientData.ClientOpts.MainSidebar != nil {
		width = clientData.ClientOpts.MainSidebar.Width
	}

	// Initialize SidebarCollapsed if it's nil
	if clientData.ClientOpts.MainSidebar == nil {
		clientData.ClientOpts.MainSidebar = new(sstore.SidebarValueType)
	}

	// Set the sidebar values
	var sv sstore.SidebarValueType
	sv.Collapsed = collapsedValue
	if width != 0 {
		sv.Width = width
	}
	clientData.ClientOpts.MainSidebar = &sv

	// Update client data
	err = sstore.SetClientOpts(ctx, clientData.ClientOpts)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %v", err)
	}

	// Retrieve updated client data
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}

	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*clientData)

	return update, nil
}

func ClientSetRightSidebarCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}

	// Handle collapsed
	collapsed, ok := pk.Kwargs["collapsed"]
	if !ok {
		return nil, fmt.Errorf("collapsed key not provided")
	}
	collapsedValue := resolveBool(collapsed, false)

	// Handle width
	var width int
	if w, exists := pk.Kwargs["width"]; exists {
		width, err = resolveNonNegInt(w, 0)
		if err != nil {
			return nil, fmt.Errorf("error resolving width: %v", err)
		}
	} else if clientData.ClientOpts.RightSidebar != nil {
		width = clientData.ClientOpts.RightSidebar.Width
	}

	// Initialize SidebarCollapsed if it's nil
	if clientData.ClientOpts.RightSidebar == nil {
		clientData.ClientOpts.RightSidebar = new(sstore.SidebarValueType)
	}

	// Set the sidebar values
	var sv sstore.SidebarValueType
	sv.Collapsed = collapsedValue
	if width != 0 {
		sv.Width = width
	}
	clientData.ClientOpts.RightSidebar = &sv

	// Update client data
	err = sstore.SetClientOpts(ctx, clientData.ClientOpts)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %v", err)
	}

	// Retrieve updated client data
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}

	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*clientData)

	return update, nil
}

func validateOpenAIAPIToken(key string) error {
	if len(key) > MaxOpenAIAPITokenLen {
		return fmt.Errorf("invalid openai token, too long")
	}
	for idx, ch := range key {
		if !unicode.IsPrint(ch) {
			return fmt.Errorf("invalid openai token, char at idx:%d is invalid %q", idx, string(ch))
		}
	}
	return nil
}

func validateOpenAIModel(model string) error {
	if len(model) == 0 {
		return nil
	}
	if len(model) > MaxOpenAIModelLen {
		return fmt.Errorf("invalid openai model, too long")
	}
	for idx, ch := range model {
		if !unicode.IsPrint(ch) {
			return fmt.Errorf("invalid openai model, char at idx:%d is invalid %q", idx, string(ch))
		}
	}
	return nil
}

const MaxFontFamilyLen = 50

var fontfamilyRe = regexp.MustCompile(`^[a-zA-Z0-9_ -]+$`)

func validateFontFamily(fontFamily string) error {
	if len(fontFamily) == 0 {
		return nil
	}
	if len(fontFamily) > MaxFontFamilyLen {
		return fmt.Errorf("invalid font family, too long")
	}
	m := fontfamilyRe.MatchString(fontFamily)
	if !m {
		return fmt.Errorf("invalid font family, must match %q", fontfamilyRe.String())
	}
	return nil
}

func CheckOptionAlias(kwargs map[string]string, aliases ...string) (string, bool) {
	for _, alias := range aliases {
		if val, found := kwargs[alias]; found {
			return val, found
		}
	}
	return "", false
}

func ClientSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	var varsUpdated []string
	if fontSizeStr, found := pk.Kwargs["termfontsize"]; found {
		newFontSize, err := resolveNonNegInt(fontSizeStr, 0)
		if err != nil {
			return nil, fmt.Errorf("invalid termfontsize, must be a number between 8-15: %v", err)
		}
		if newFontSize < TermFontSizeMin || newFontSize > TermFontSizeMax {
			return nil, fmt.Errorf("invalid termfontsize, must be a number between %d-%d", TermFontSizeMin, TermFontSizeMax)
		}
		feOpts := clientData.FeOpts
		feOpts.TermFontSize = newFontSize
		err = sstore.UpdateClientFeOpts(ctx, feOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client feopts: %v", err)
		}
		varsUpdated = append(varsUpdated, "termfontsize")
	}
	if fontFamilyStr, found := pk.Kwargs["termfontfamily"]; found {
		newFontFamily := fontFamilyStr
		err = validateFontFamily(newFontFamily)
		if err != nil {
			return nil, err
		}
		feOpts := clientData.FeOpts
		feOpts.TermFontFamily = newFontFamily
		err = sstore.UpdateClientFeOpts(ctx, feOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client feopts: %v", err)
		}
		varsUpdated = append(varsUpdated, "termfontfamily")
	}
	if themeSourceStr, found := pk.Kwargs["theme"]; found {
		newThemeSource := themeSourceStr
		found := false
		for _, theme := range ThemeSources {
			if newThemeSource == theme {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("invalid theme source")
		}
		feOpts := clientData.FeOpts
		feOpts.Theme = newThemeSource
		err = sstore.UpdateClientFeOpts(ctx, feOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client feopts: %v", err)
		}
		varsUpdated = append(varsUpdated, "theme")
	}
	if termthemeStr, found := pk.Kwargs["termtheme"]; found {
		feOpts := clientData.FeOpts
		if feOpts.TermTheme == nil {
			feOpts.TermTheme = make(map[string]string)
		}
		if termthemeStr == "" {
			delete(feOpts.TermTheme, "global")
		} else {
			feOpts.TermTheme["global"] = termthemeStr
		}
		err = sstore.UpdateClientFeOpts(ctx, feOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client feopts: %v", err)
		}
		varsUpdated = append(varsUpdated, "termtheme")
	}
	if apiToken, found := CheckOptionAlias(pk.Kwargs, "openaiapitoken", "aiapitoken"); found {
		err = validateOpenAIAPIToken(apiToken)
		if err != nil {
			return nil, err
		}
		varsUpdated = append(varsUpdated, "openaiapitoken")
		aiOpts := clientData.OpenAIOpts
		if aiOpts == nil {
			aiOpts = &sstore.OpenAIOptsType{}
			clientData.OpenAIOpts = aiOpts
		}
		aiOpts.APIToken = apiToken
		err = sstore.UpdateClientOpenAIOpts(ctx, *aiOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai api token: %v", err)
		}
	}
	if aiModel, found := CheckOptionAlias(pk.Kwargs, "openaimodel", "aimodel"); found {
		err = validateOpenAIModel(aiModel)
		if err != nil {
			return nil, err
		}
		varsUpdated = append(varsUpdated, "openaimodel")
		aiOpts := clientData.OpenAIOpts
		if aiOpts == nil {
			aiOpts = &sstore.OpenAIOptsType{}
			clientData.OpenAIOpts = aiOpts
		}
		aiOpts.Model = aiModel
		err = sstore.UpdateClientOpenAIOpts(ctx, *aiOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai model: %v", err)
		}
	}
	if maxTokensStr, found := CheckOptionAlias(pk.Kwargs, "openaimaxtokens", "aimaxtokens"); found {
		maxTokens, err := strconv.Atoi(maxTokensStr)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai maxtokens, invalid number: %v", err)
		}
		if maxTokens < 0 || maxTokens > 1000000 {
			return nil, fmt.Errorf("error updating client ai maxtokens, out of range: %d", maxTokens)
		}
		varsUpdated = append(varsUpdated, "openaimaxtokens")
		aiOpts := clientData.OpenAIOpts
		if aiOpts == nil {
			aiOpts = &sstore.OpenAIOptsType{}
			clientData.OpenAIOpts = aiOpts
		}
		aiOpts.MaxTokens = maxTokens
		err = sstore.UpdateClientOpenAIOpts(ctx, *aiOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai maxtokens: %v", err)
		}
	}
	if maxChoicesStr, found := CheckOptionAlias(pk.Kwargs, "openaimaxchoices", "aimaxchoices"); found {
		maxChoices, err := strconv.Atoi(maxChoicesStr)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai maxchoices, invalid number: %v", err)
		}
		if maxChoices < 0 || maxChoices > 10 {
			return nil, fmt.Errorf("error updating client ai maxchoices, out of range: %d", maxChoices)
		}
		varsUpdated = append(varsUpdated, "openaimaxchoices")
		aiOpts := clientData.OpenAIOpts
		if aiOpts == nil {
			aiOpts = &sstore.OpenAIOptsType{}
			clientData.OpenAIOpts = aiOpts
		}
		aiOpts.MaxChoices = maxChoices
		err = sstore.UpdateClientOpenAIOpts(ctx, *aiOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai maxchoices: %v", err)
		}
	}
	if aiBaseURL, found := CheckOptionAlias(pk.Kwargs, "openaibaseurl", "aibaseurl"); found {
		aiOpts := clientData.OpenAIOpts
		if aiOpts == nil {
			aiOpts = &sstore.OpenAIOptsType{}
			clientData.OpenAIOpts = aiOpts
		}
		aiOpts.BaseURL = aiBaseURL
		varsUpdated = append(varsUpdated, "openaibaseurl")
		err = sstore.UpdateClientOpenAIOpts(ctx, *aiOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai base url: %v", err)
		}
	}
	if aiTimeoutStr, found := CheckOptionAlias(pk.Kwargs, "openaitimeout", "aitimeout"); found {
		aiTimeout, err := strconv.ParseFloat(aiTimeoutStr, 64)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai timeout, invalid number: %v", err)
		}
		aiOpts := clientData.OpenAIOpts
		if aiOpts == nil {
			aiOpts = &sstore.OpenAIOptsType{}
			clientData.OpenAIOpts = aiOpts
		}
		aiOpts.Timeout = int(aiTimeout * 1000)
		varsUpdated = append(varsUpdated, "openaitimeout")
		err = sstore.UpdateClientOpenAIOpts(ctx, *aiOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client ai timeout: %v", err)
		}
	}
	if webglStr, found := pk.Kwargs["webgl"]; found {
		webglVal := resolveBool(webglStr, false)
		clientOpts := clientData.ClientOpts
		clientOpts.WebGL = webglVal
		err = sstore.SetClientOpts(ctx, clientOpts)
		if err != nil {
			return nil, fmt.Errorf("error updating client webgl: %v", err)
		}
		varsUpdated = append(varsUpdated, "webgl")
	}
	if len(varsUpdated) == 0 {
		return nil, fmt.Errorf("/client:set requires a value to set: %s", formatStrs([]string{"termfontsize", "termfontfamily", "openaiapitoken", "openaimodel", "openaibaseurl", "openaimaxtokens", "openaimaxchoices", "openaitimeout", "webgl"}, "or", false))
	}
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*clientData)
	update.AddUpdate(sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("client updated %s", formatStrs(varsUpdated, "and", false)),
		TimeoutMs: 2000,
	})
	return update, nil
}

func ClientShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	dbVersion, err := sstore.GetDBVersion(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve db version: %v\n", err)
	}
	clientVersion := "-"
	if pk.UIContext != nil && pk.UIContext.Build != "" {
		clientVersion = pk.UIContext.Build
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "userid", clientData.UserId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "clientid", clientData.ClientId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "telemetry", boolToStr(clientData.ClientOpts.NoTelemetry, "off", "on")))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "release-check", boolToStr(clientData.ClientOpts.NoReleaseCheck, "off", "on")))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "db-version", dbVersion))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "client-version", clientVersion))
	buf.WriteString(fmt.Sprintf("  %-15s %s %s\n", "server-version", scbase.WaveVersion, scbase.BuildTime))
	buf.WriteString(fmt.Sprintf("  %-15s %s (%s)\n", "arch", scbase.ClientArch(), scbase.UnameKernelRelease()))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "termfontsize", clientData.FeOpts.TermFontSize))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "termfontfamily", clientData.FeOpts.TermFontFamily))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "termfontfamily", clientData.FeOpts.Theme))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "aiapitoken", clientData.OpenAIOpts.APIToken))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "aimodel", clientData.OpenAIOpts.Model))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "aimaxtokens", clientData.OpenAIOpts.MaxTokens))
	buf.WriteString(fmt.Sprintf("  %-15s %d\n", "aimaxchoices", clientData.OpenAIOpts.MaxChoices))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "aibaseurl", clientData.OpenAIOpts.BaseURL))
	buf.WriteString(fmt.Sprintf("  %-15s %ss\n", "aitimeout", strconv.FormatFloat((float64(clientData.OpenAIOpts.Timeout)/1000.0), 'f', -1, 64)))
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: fmt.Sprintf("client info"),
		InfoLines: splitLinesForInfo(buf.String()),
	})

	return update, nil
}

func TelemetryCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	return nil, fmt.Errorf("/telemetry requires a subcommand: %s", formatStrs([]string{"show", "on", "off", "send"}, "or", false))
}

func setNoTelemetry(ctx context.Context, clientData *sstore.ClientData, noTelemetryVal bool) error {
	clientOpts := clientData.ClientOpts
	clientOpts.NoTelemetry = noTelemetryVal
	err := sstore.SetClientOpts(ctx, clientOpts)
	if err != nil {
		return fmt.Errorf("error trying to update client telemetry: %v", err)
	}
	log.Printf("client no-telemetry setting updated to %v\n", noTelemetryVal)
	go func() {
		cloudCtx, cancelFn := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelFn()
		err := pcloud.SendNoTelemetryUpdate(cloudCtx, clientOpts.NoTelemetry)
		if err != nil {
			log.Printf("[error] sending no-telemetry update: %v\n", err)
			log.Printf("note that telemetry update has still taken effect locally, and will be respected by the client\n")
		}
	}()
	return nil
}

func TelemetryOnCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	if !clientData.ClientOpts.NoTelemetry {
		return sstore.InfoMsgUpdate("telemetry is already on"), nil
	}
	err = setNoTelemetry(ctx, clientData, false)
	if err != nil {
		return nil, err
	}
	go func() {
		cloudCtx, cancelFn := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelFn()
		err := pcloud.SendTelemetry(cloudCtx, false)
		if err != nil {
			// ignore error, but log
			log.Printf("[error] sending telemetry update (in /telemetry:on): %v\n", err)
		}
	}()
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}
	update := sstore.InfoMsgUpdate("telemetry is now on")
	update.AddUpdate(*clientData)
	return update, nil
}

func TelemetryOffCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	if clientData.ClientOpts.NoTelemetry {
		return sstore.InfoMsgUpdate("telemetry is already off"), nil
	}
	err = setNoTelemetry(ctx, clientData, true)
	if err != nil {
		return nil, err
	}
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}
	update := sstore.InfoMsgUpdate("telemetry is now off")
	update.AddUpdate(*clientData)
	return update, nil
}

func TelemetryShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "telemetry", boolToStr(clientData.ClientOpts.NoTelemetry, "off", "on")))
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(sstore.InfoMsgType{
		InfoTitle: fmt.Sprintf("telemetry info"),
		InfoLines: splitLinesForInfo(buf.String()),
	})
	return update, nil
}

func TelemetrySendCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	force := resolveBool(pk.Kwargs["force"], false)
	if clientData.ClientOpts.NoTelemetry && !force {
		return nil, fmt.Errorf("cannot send telemetry, telemetry is off.  pass force=1 to force the send, or turn on telemetry with /telemetry:on")
	}
	err = pcloud.SendTelemetry(ctx, force)
	if err != nil {
		return nil, fmt.Errorf("failed to send telemetry: %v", err)
	}
	return sstore.InfoMsgUpdate("telemetry sent"), nil
}

func runReleaseCheck(ctx context.Context, force bool) error {
	rslt, err := releasechecker.CheckNewRelease(ctx, force)

	if err != nil {
		return fmt.Errorf("error checking for new release: %v", err)
	}

	if rslt == releasechecker.Failure {
		return fmt.Errorf("error checking for new release, see log for details")
	}

	return nil
}

func setNoReleaseCheck(ctx context.Context, clientData *sstore.ClientData, noReleaseCheckValue bool) error {
	clientOpts := clientData.ClientOpts
	clientOpts.NoReleaseCheck = noReleaseCheckValue
	err := sstore.SetClientOpts(ctx, clientOpts)
	if err != nil {
		return fmt.Errorf("error trying to update client releaseCheck setting: %v", err)
	}
	log.Printf("client no-release-check setting updated to %v\n", noReleaseCheckValue)
	return nil
}

func ReleaseCheckOnCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	if !clientData.ClientOpts.NoReleaseCheck {
		return sstore.InfoMsgUpdate("release check is already on"), nil
	}
	err = setNoReleaseCheck(ctx, clientData, false)
	if err != nil {
		return nil, err
	}

	go func() {
		releaseCheckCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		releaseCheckErr := runReleaseCheck(releaseCheckCtx, true)
		if releaseCheckErr != nil {
			log.Printf("error checking for new release after enabling auto release check: %v\n", releaseCheckErr)
		}
	}()

	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}
	update := sstore.InfoMsgUpdate("automatic release checking is now on")
	update.AddUpdate(*clientData)
	return update, nil
}

func ReleaseCheckOffCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	if clientData.ClientOpts.NoReleaseCheck {
		return sstore.InfoMsgUpdate("release check is already off"), nil
	}
	err = setNoReleaseCheck(ctx, clientData, true)
	if err != nil {
		return nil, err
	}
	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}
	update := sstore.InfoMsgUpdate("automatic release checking is now off")
	update.AddUpdate(*clientData)
	return update, nil
}

func ReleaseCheckCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (scbus.UpdatePacket, error) {
	err := runReleaseCheck(ctx, true)
	if err != nil {
		return nil, err
	}

	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("cannot retrieve updated client data: %v", err)
	}

	var rsp string
	if semver.Compare(scbase.WaveVersion, clientData.ReleaseInfo.LatestVersion) < 0 {
		rsp = "new release available to download: https://www.waveterm.dev/download"
	} else {
		rsp = "no new release available"
	}

	update := sstore.InfoMsgUpdate(rsp)
	update.AddUpdate(*clientData)
	return update, nil
}

func formatTermOpts(termOpts sstore.TermOpts) string {
	if termOpts.Cols == 0 {
		return "???"
	}
	rtnStr := fmt.Sprintf("%dx%d", termOpts.Rows, termOpts.Cols)
	if termOpts.FlexRows {
		rtnStr += " flexrows"
	}
	if termOpts.MaxPtySize > 0 {
		rtnStr += " maxbuf=" + scbase.NumFormatB2(termOpts.MaxPtySize)
	}
	return rtnStr
}

type ColMeta struct {
	Title   string
	MinCols int
	MaxCols int
}

func toInterfaceArr(sarr []string) []interface{} {
	rtn := make([]interface{}, len(sarr))
	for idx, s := range sarr {
		rtn[idx] = s
	}
	return rtn
}

func formatTextTable(totalCols int, data [][]string, colMeta []ColMeta) []string {
	numCols := len(colMeta)
	maxColLen := make([]int, len(colMeta))
	for i, cm := range colMeta {
		maxColLen[i] = cm.MinCols
	}
	for _, row := range data {
		for i := 0; i < numCols && i < len(row); i++ {
			dlen := len(row[i])
			if dlen > maxColLen[i] {
				maxColLen[i] = dlen
			}
		}
	}
	fmtStr := ""
	for idx, clen := range maxColLen {
		if idx != 0 {
			fmtStr += " "
		}
		fmtStr += fmt.Sprintf("%%%ds", clen)
	}
	var rtn []string
	for _, row := range data {
		sval := fmt.Sprintf(fmtStr, toInterfaceArr(row)...)
		rtn = append(rtn, sval)
	}
	return rtn
}

func isValidInScope(scopeName string, varName string) bool {
	for _, varScope := range SetVarScopes {
		if varScope.ScopeName == scopeName {
			return utilfn.ContainsStr(varScope.VarNames, varName)
		}
	}
	return false
}

// returns (is-valid, scope, name)
// TODO write a full resolver to allow for indexed arguments.  e.g. session[1].screen[1].screen.pterm="25x80"
func resolveSetArg(argName string) (bool, string, string) {
	dotIdx := strings.Index(argName, ".")
	if dotIdx == -1 {
		argName = SetVarNameMap[argName]
		dotIdx = strings.Index(argName, ".")
	}
	if argName == "" {
		return false, "", ""
	}
	scopeName := argName[0:dotIdx]
	varName := argName[dotIdx+1:]
	if !isValidInScope(scopeName, varName) {
		return false, "", ""
	}
	return true, scopeName, varName
}
