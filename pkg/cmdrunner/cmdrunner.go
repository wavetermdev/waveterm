package cmdrunner

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/alessio/shellescape"
	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const (
	HistoryTypeWindow  = "window"
	HistoryTypeSession = "session"
	HistoryTypeGlobal  = "global"
)

const DefaultUserId = "sawka"
const MaxNameLen = 50
const MaxRemoteAliasLen = 50

var ColorNames = []string{"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"}
var RemoteColorNames = []string{"red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"}

var hostNameRe = regexp.MustCompile("^[a-z][a-z0-9.-]*$")
var userHostRe = regexp.MustCompile("^(sudo@)?([a-z][a-z0-9-]*)@([a-z][a-z0-9.-]*)$")
var remoteAliasRe = regexp.MustCompile("^[a-zA-Z][a-zA-Z0-9_-]*$")
var genericNameRe = regexp.MustCompile("^[a-zA-Z][a-zA-Z0-9_ .()<>,/\"'\\[\\]{}=+$@!*-]*$")
var positionRe = regexp.MustCompile("^((\\+|-)?[0-9]+|(\\+|-))$")
var wsRe = regexp.MustCompile("\\s+")

type contextType string

var historyContextKey = contextType("history")

type historyContextType struct {
	LineId    string
	CmdId     string
	RemotePtr *sstore.RemotePtrType
}

type MetaCmdFnType = func(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error)
type MetaCmdEntryType struct {
	IsAlias bool
	Fn      MetaCmdFnType
}

var MetaCmdFnMap = make(map[string]MetaCmdEntryType)

func init() {
	registerCmdFn("run", RunCommand)
	registerCmdFn("eval", EvalCommand)
	registerCmdFn("comment", CommentCommand)
	registerCmdFn("cd", CdCommand)
	registerCmdFn("cr", CrCommand)
	registerCmdFn("compgen", CompGenCommand)
	registerCmdFn("setenv", SetEnvCommand)
	registerCmdFn("unset", UnSetCommand)
	registerCmdFn("clear", ClearCommand)

	registerCmdFn("session", SessionCommand)
	registerCmdFn("session:open", SessionOpenCommand)
	registerCmdAlias("session:new", SessionOpenCommand)
	registerCmdFn("session:set", SessionSetCommand)
	registerCmdFn("session:delete", SessionDeleteCommand)

	registerCmdFn("screen", ScreenCommand)
	registerCmdFn("screen:close", ScreenCloseCommand)
	registerCmdFn("screen:open", ScreenOpenCommand)
	registerCmdAlias("screen:new", ScreenOpenCommand)
	registerCmdFn("screen:set", ScreenSetCommand)

	registerCmdAlias("remote", RemoteCommand)
	registerCmdFn("remote:show", RemoteShowCommand)
	registerCmdFn("remote:showall", RemoteShowAllCommand)
	registerCmdFn("remote:new", RemoteNewCommand)
	registerCmdFn("remote:archive", RemoteArchiveCommand)
	registerCmdFn("remote:set", RemoteSetCommand)
	registerCmdFn("remote:disconnect", RemoteDisconnectCommand)
	registerCmdFn("remote:connect", RemoteConnectCommand)

	registerCmdFn("window:resize", WindowResizeCommand)

	registerCmdFn("line", LineCommand)
	registerCmdFn("line:show", LineShowCommand)

	registerCmdFn("history", HistoryCommand)
}

func getValidCommands() []string {
	var rtn []string
	for key, val := range MetaCmdFnMap {
		if val.IsAlias {
			continue
		}
		rtn = append(rtn, key)
	}
	return rtn
}

func registerCmdFn(cmdName string, fn MetaCmdFnType) {
	MetaCmdFnMap[cmdName] = MetaCmdEntryType{Fn: fn}
}

func registerCmdAlias(cmdName string, fn MetaCmdFnType) {
	MetaCmdFnMap[cmdName] = MetaCmdEntryType{IsAlias: true, Fn: fn}
}

func HandleCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
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

func resolveBool(arg string, def bool) bool {
	if arg == "" {
		return def
	}
	if arg == "0" || arg == "false" {
		return false
	}
	return true
}

func resolveInt(arg string, def int) (int, error) {
	if arg == "" {
		return def, nil
	}
	ival, err := strconv.Atoi(arg)
	if err != nil {
		return 0, err
	}
	return ival, nil
}

func RunCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_RemoteConnected)
	if err != nil {
		return nil, fmt.Errorf("/run error: %w", err)
	}
	cmdId := uuid.New().String()
	cmdStr := firstArg(pk)
	runPacket := packet.MakeRunPacket()
	runPacket.ReqId = uuid.New().String()
	runPacket.CK = base.MakeCommandKey(ids.SessionId, cmdId)
	runPacket.Cwd = ids.Remote.RemoteState.Cwd
	runPacket.Env0 = ids.Remote.RemoteState.Env0
	runPacket.EnvComplete = true
	runPacket.UsePty = true
	runPacket.TermOpts = &packet.TermOpts{Rows: shexec.DefaultTermRows, Cols: shexec.DefaultTermCols, Term: remote.DefaultTerm, MaxPtySize: shexec.DefaultMaxPtySize}
	if pk.UIContext != nil && pk.UIContext.TermOpts != nil {
		pkOpts := pk.UIContext.TermOpts
		if pkOpts.Cols > 0 {
			runPacket.TermOpts.Cols = base.BoundInt(pkOpts.Cols, shexec.MinTermCols, shexec.MaxTermCols)
		}
		if pkOpts.MaxPtySize > 0 {
			runPacket.TermOpts.MaxPtySize = base.BoundInt64(pkOpts.MaxPtySize, shexec.MinMaxPtySize, shexec.MaxMaxPtySize)
		}
	}
	runPacket.Command = strings.TrimSpace(cmdStr)
	cmd, callback, err := remote.RunCommand(ctx, cmdId, ids.Remote.RemotePtr, ids.Remote.RemoteState, runPacket)
	if callback != nil {
		defer callback()
	}
	if err != nil {
		return nil, err
	}
	rtnLine, err := sstore.AddCmdLine(ctx, ids.SessionId, ids.WindowId, DefaultUserId, cmd)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{Line: rtnLine, Cmd: cmd, Interactive: pk.Interactive}
	sstore.MainBus.SendUpdate(ids.SessionId, update)
	ctxVal := ctx.Value(historyContextKey)
	if ctxVal != nil {
		hctx := ctxVal.(*historyContextType)
		if rtnLine != nil {
			hctx.LineId = rtnLine.LineId
		}
		if cmd != nil {
			hctx.CmdId = cmd.CmdId
			hctx.RemotePtr = &cmd.Remote
		}
	}
	return nil, nil
}

func addToHistory(ctx context.Context, pk *scpacket.FeCommandPacketType, historyContext historyContextType, isMetaCmd bool, hadError bool) error {
	cmdStr := firstArg(pk)
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Window)
	if err != nil {
		return err
	}
	hitem := &sstore.HistoryItemType{
		HistoryId: uuid.New().String(),
		Ts:        time.Now().UnixMilli(),
		UserId:    DefaultUserId,
		SessionId: ids.SessionId,
		ScreenId:  ids.ScreenId,
		WindowId:  ids.WindowId,
		LineId:    historyContext.LineId,
		HadError:  hadError,
		CmdId:     historyContext.CmdId,
		CmdStr:    cmdStr,
		IsMetaCmd: isMetaCmd,
	}
	if !isMetaCmd && historyContext.RemotePtr != nil {
		hitem.Remote = *historyContext.RemotePtr
	}
	err = sstore.InsertHistoryItem(ctx, hitem)
	if err != nil {
		return err
	}
	return nil
}

func EvalCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	if len(pk.Args) == 0 {
		return nil, fmt.Errorf("usage: /eval [command], no command passed to eval")
	}
	var historyContext historyContextType
	ctxWithHistory := context.WithValue(ctx, historyContextKey, &historyContext)
	var update sstore.UpdatePacket
	newPk, rtnErr := EvalMetaCommand(ctxWithHistory, pk)
	if rtnErr == nil {
		update, rtnErr = HandleCommand(ctxWithHistory, newPk)
	}
	if !resolveBool(pk.Kwargs["nohist"], false) {
		err := addToHistory(ctx, pk, historyContext, (newPk.MetaCmd != "run"), (rtnErr != nil))
		if err != nil {
			fmt.Printf("[error] adding to history: %v\n", err)
			// continue...
		}
	}
	return update, rtnErr
}

func ScreenCloseCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, fmt.Errorf("/screen:close cannot close screen: %w", err)
	}
	update, err := sstore.DeleteScreen(ctx, ids.SessionId, ids.ScreenId)
	if err != nil {
		return nil, err
	}
	return update, nil
}

func ScreenOpenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session)
	if err != nil {
		return nil, fmt.Errorf("/screen:open cannot open screen: %w", err)
	}
	activate := resolveBool(pk.Kwargs["activate"], true)
	newName := pk.Kwargs["name"]
	if newName != "" {
		err := validateName(newName, "screen")
		if err != nil {
			return nil, err
		}
	}
	update, err := sstore.InsertScreen(ctx, ids.SessionId, newName, activate)
	if err != nil {
		return nil, err
	}
	return update, nil
}

func ScreenSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen)
	if err != nil {
		return nil, err
	}
	var varsUpdated []string
	if pk.Kwargs["name"] != "" {
		newName := pk.Kwargs["name"]
		err = validateName(newName, "screen")
		if err != nil {
			return nil, err
		}
		err = sstore.SetScreenName(ctx, ids.SessionId, ids.ScreenId, newName)
		if err != nil {
			return nil, fmt.Errorf("setting screen name: %v", err)
		}
		varsUpdated = append(varsUpdated, "name")
	}
	if pk.Kwargs["tabcolor"] != "" {
		color := pk.Kwargs["tabcolor"]
		err = validateColor(color, "screen tabcolor")
		if err != nil {
			return nil, err
		}
		screenObj, err := sstore.GetScreenById(ctx, ids.SessionId, ids.ScreenId)
		if err != nil {
			return nil, err
		}
		opts := screenObj.ScreenOpts
		if opts == nil {
			opts = &sstore.ScreenOptsType{}
		}
		opts.TabColor = color
		err = sstore.SetScreenOpts(ctx, ids.SessionId, ids.ScreenId, opts)
		if err != nil {
			return nil, fmt.Errorf("setting screen opts: %v", err)
		}
		varsUpdated = append(varsUpdated, "tabcolor")
	}
	if len(varsUpdated) == 0 {
		return nil, fmt.Errorf("/screen:set no updates, can set %s", formatStrs([]string{"name", "pos", "tabcolor"}, "or", false))
	}
	screenObj, err := sstore.GetScreenById(ctx, ids.SessionId, ids.ScreenId)
	if err != nil {
		return nil, err
	}
	update, session := sstore.MakeSingleSessionUpdate(ids.SessionId)
	session.Screens = append(session.Screens, screenObj)
	update.Info = &sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("screen updated %s", formatStrs(varsUpdated, "and", false)),
		TimeoutMs: 2000,
	}
	return update, nil
}

func ScreenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
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

func UnSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_RemoteConnected)
	if err != nil {
		return nil, fmt.Errorf("cannot unset: %v", err)
	}
	envMap := shexec.ParseEnv0(ids.Remote.RemoteState.Env0)
	unsetVars := make(map[string]bool)
	for _, argStr := range pk.Args {
		eqIdx := strings.Index(argStr, "=")
		if eqIdx != -1 {
			return nil, fmt.Errorf("invalid argument to setenv, '%s' (cannot contain equal sign)", argStr)
		}
		delete(envMap, argStr)
		unsetVars[argStr] = true
	}
	state := *ids.Remote.RemoteState
	state.Env0 = shexec.MakeEnv0(envMap)
	remote, err := sstore.UpdateRemoteState(ctx, ids.SessionId, ids.WindowId, ids.Remote.RemotePtr, state)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{
		Sessions: sstore.MakeSessionsUpdateForRemote(ids.SessionId, remote),
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] unset vars: %s", ids.Remote.DisplayName, formatStrs(mapToStrs(unsetVars), "and", false)),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func RemoteConnectCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	if ids.Remote.RState.IsConnected() {
		return sstore.InfoMsgUpdate("remote %q already connected (no action taken)", ids.Remote.DisplayName), nil
	}
	go ids.Remote.MShell.Launch()
	return sstore.InfoMsgUpdate("remote %q reconnecting", ids.Remote.DisplayName), nil
}

func RemoteDisconnectCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	force := resolveBool(pk.Kwargs["force"], false)
	if !ids.Remote.RState.IsConnected() && !force {
		return sstore.InfoMsgUpdate("remote %q already disconnected (no action taken)", ids.Remote.DisplayName), nil
	}
	numCommands := ids.Remote.MShell.GetNumRunningCommands()
	if numCommands > 0 && !force {
		return nil, fmt.Errorf("remote not disconnected, %q has %d running commands. use 'force=1' to force disconnection", ids.Remote.DisplayName)
	}
	ids.Remote.MShell.Disconnect()
	return sstore.InfoMsgUpdate("remote %q disconnected", ids.Remote.DisplayName), nil
}

func RemoteNewCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	if len(pk.Args) == 0 || pk.Args[0] == "" {
		return nil, fmt.Errorf("/remote:new requires one positional argument of 'user@host'")
	}
	userHost := pk.Args[0]
	m := userHostRe.FindStringSubmatch(userHost)
	if m == nil {
		return nil, fmt.Errorf("/remote:new invalid format of user@host argument")
	}
	sudoStr, remoteUser, remoteHost := m[1], m[2], m[3]
	alias := pk.Kwargs["alias"]
	if alias != "" {
		if len(alias) > MaxRemoteAliasLen {
			return nil, fmt.Errorf("alias too long, max length = %d", MaxRemoteAliasLen)
		}
		if !remoteAliasRe.MatchString(alias) {
			return nil, fmt.Errorf("invalid alias format")
		}
	}
	connectMode := sstore.ConnectModeStartup
	if pk.Kwargs["connectmode"] != "" {
		connectMode = pk.Kwargs["connectmode"]
	}
	if !sstore.IsValidConnectMode(connectMode) {
		return nil, fmt.Errorf("/remote:new invalid connectmode %q: valid modes are %s", connectMode, formatStrs([]string{sstore.ConnectModeStartup, sstore.ConnectModeAuto, sstore.ConnectModeManual}, "or", false))
	}
	var isSudo bool
	if sudoStr != "" {
		isSudo = true
	}
	if pk.Kwargs["sudo"] != "" {
		sudoArg := resolveBool(pk.Kwargs["sudo"], false)
		if isSudo && !sudoArg {
			return nil, fmt.Errorf("/remote:new invalid 'sudo@' argument, with sudo kw arg set to false")
		}
		if !isSudo && sudoArg {
			isSudo = true
			userHost = "sudo@" + userHost
		}
	}
	sshOpts := &sstore.SSHOpts{
		Local:   false,
		SSHHost: remoteHost,
		SSHUser: remoteUser,
	}
	if pk.Kwargs["key"] != "" {
		keyFile := pk.Kwargs["key"]
		fd, err := os.Open(keyFile)
		if fd != nil {
			fd.Close()
		}
		if err != nil {
			return nil, fmt.Errorf("/remote:new invalid key %q (cannot read): %v", keyFile, err)
		}
		sshOpts.SSHIdentity = keyFile
	}
	remoteOpts := &sstore.RemoteOptsType{}
	if pk.Kwargs["color"] != "" {
		color := pk.Kwargs["color"]
		err := validateRemoteColor(color, "remote color")
		if err != nil {
			return nil, err
		}
		remoteOpts.Color = color
	}
	r := &sstore.RemoteType{
		RemoteId:            uuid.New().String(),
		PhysicalId:          "",
		RemoteType:          sstore.RemoteTypeSsh,
		RemoteAlias:         alias,
		RemoteCanonicalName: userHost,
		RemoteSudo:          isSudo,
		RemoteUser:          remoteUser,
		RemoteHost:          remoteHost,
		ConnectMode:         connectMode,
		SSHOpts:             sshOpts,
		RemoteOpts:          remoteOpts,
	}
	err := sstore.InsertRemote(ctx, r)
	if err != nil {
		return nil, fmt.Errorf("cannot create remote %q: %v", r.RemoteCanonicalName, err)
	}
	update := &sstore.ModelUpdate{
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("remote %q created", r.RemoteCanonicalName),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func RemoteSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	fmt.Printf("ids: %v\n", ids)
	return nil, nil
}

func RemoteShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	state := ids.Remote.RState
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "type", state.RemoteType))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "remoteid", state.RemoteId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "physicalid", state.PhysicalId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "alias", state.RemoteAlias))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "canonicalname", state.RemoteCanonicalName))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "status", state.Status))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "connectmode", state.ConnectMode))
	if ids.Remote.RemoteState != nil {
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "cwd", ids.Remote.RemoteState.Cwd))
	}
	return sstore.ModelUpdate{
		Info: &sstore.InfoMsgType{
			InfoTitle: fmt.Sprintf("show remote [%s] info", ids.Remote.DisplayName),
			InfoLines: splitLinesForInfo(buf.String()),
		},
	}, nil
}

func RemoteShowAllCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
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
	return sstore.ModelUpdate{
		Info: &sstore.InfoMsgType{
			InfoTitle: fmt.Sprintf("show all remote info"),
			InfoLines: splitLinesForInfo(buf.String()),
		},
	}, nil
}

func RemoteArchiveCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	update := sstore.InfoMsgUpdate("remote [%s] archived", ids.Remote.DisplayName)
	return update, nil
}

func RemoteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	return nil, fmt.Errorf("/remote requires a subcommand: %s", formatStrs([]string{"show"}, "or", false))
}

func SetEnvCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_RemoteConnected)
	if err != nil {
		return nil, fmt.Errorf("cannot setenv: %v", err)
	}
	envMap := shexec.ParseEnv0(ids.Remote.RemoteState.Env0)
	if len(pk.Args) == 0 {
		var infoLines []string
		for varName, varVal := range envMap {
			line := fmt.Sprintf("%s=%s", varName, shellescape.Quote(varVal))
			infoLines = append(infoLines, line)
		}
		update := sstore.ModelUpdate{
			Info: &sstore.InfoMsgType{
				InfoTitle: fmt.Sprintf("environment for remote [%s]", ids.Remote.DisplayName),
				InfoLines: infoLines,
			},
		}
		return update, nil
	}
	setVars := make(map[string]bool)
	for _, argStr := range pk.Args {
		eqIdx := strings.Index(argStr, "=")
		if eqIdx == -1 {
			return nil, fmt.Errorf("invalid argument to setenv, '%s' (no equal sign)", argStr)
		}
		envName := argStr[:eqIdx]
		envVal := argStr[eqIdx+1:]
		envMap[envName] = envVal
		setVars[envName] = true
	}
	state := *ids.Remote.RemoteState
	state.Env0 = shexec.MakeEnv0(envMap)
	remote, err := sstore.UpdateRemoteState(ctx, ids.SessionId, ids.WindowId, ids.Remote.RemotePtr, state)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{
		Sessions: sstore.MakeSessionsUpdateForRemote(ids.SessionId, remote),
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] set vars: %s", ids.Remote.DisplayName, formatStrs(mapToStrs(setVars), "and", false)),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func CrCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window)
	if err != nil {
		return nil, fmt.Errorf("/cr error: %w", err)
	}
	newRemote := firstArg(pk)
	if newRemote == "" {
		return nil, nil
	}
	remoteName, rptr, _, _, err := resolveRemote(ctx, newRemote, ids.SessionId, ids.WindowId)
	if err != nil {
		return nil, err
	}
	if rptr == nil {
		return nil, fmt.Errorf("/cr error: remote [%s] not found", newRemote)
	}
	err = sstore.UpdateCurRemote(ctx, ids.SessionId, ids.WindowId, *rptr)
	if err != nil {
		return nil, fmt.Errorf("/cr error: cannot update curremote: %w", err)
	}
	update := sstore.ModelUpdate{
		Window: &sstore.WindowType{
			SessionId: ids.SessionId,
			WindowId:  ids.WindowId,
			CurRemote: *rptr,
		},
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("current remote = %s", remoteName),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func CdCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_RemoteConnected)
	if err != nil {
		return nil, fmt.Errorf("/cd error: %w", err)
	}
	newDir := firstArg(pk)
	if newDir == "" {
		return sstore.ModelUpdate{
			Info: &sstore.InfoMsgType{
				InfoMsg: fmt.Sprintf("[%s] current directory = %s", ids.Remote.DisplayName, ids.Remote.RemoteState.Cwd),
			},
		}, nil
	}
	newDir, err = ids.Remote.RState.ExpandHomeDir(newDir)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(newDir, "/") {
		if ids.Remote.RemoteState == nil {
			return nil, fmt.Errorf("/cd error: cannot get current remote directory (can only cd with absolute path)")
		}
		newDir = path.Join(ids.Remote.RemoteState.Cwd, newDir)
		newDir, err = filepath.Abs(newDir)
		if err != nil {
			return nil, fmt.Errorf("/cd error: error canonicalizing new directory: %w", err)
		}
	}
	cdPacket := packet.MakeCdPacket()
	cdPacket.ReqId = uuid.New().String()
	cdPacket.Dir = newDir
	resp, err := ids.Remote.MShell.PacketRpc(ctx, cdPacket)
	if err != nil {
		return nil, err
	}
	if err = resp.Err(); err != nil {
		return nil, err
	}
	state := *ids.Remote.RemoteState
	state.Cwd = newDir
	remoteInst, err := sstore.UpdateRemoteState(ctx, ids.SessionId, ids.WindowId, ids.Remote.RemotePtr, state)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{
		Sessions: sstore.MakeSessionsUpdateForRemote(ids.SessionId, remoteInst),
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] current directory = %s", ids.Remote.DisplayName, newDir),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func getStrArr(v interface{}, field string) []string {
	if v == nil {
		return nil
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return nil
	}
	fieldVal := m[field]
	if fieldVal == nil {
		return nil
	}
	iarr, ok := fieldVal.([]interface{})
	if !ok {
		return nil
	}
	var sarr []string
	for _, iv := range iarr {
		if sv, ok := iv.(string); ok {
			sarr = append(sarr, sv)
		}
	}
	return sarr
}

func getBool(v interface{}, field string) bool {
	if v == nil {
		return false
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return false
	}
	fieldVal := m[field]
	if fieldVal == nil {
		return false
	}
	bval, ok := fieldVal.(bool)
	if !ok {
		return false
	}
	return bval
}

func makeInfoFromComps(compType string, comps []string, hasMore bool) sstore.UpdatePacket {
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
	update := sstore.ModelUpdate{
		Info: &sstore.InfoMsgType{
			InfoTitle:     fmt.Sprintf("%s completions", compType),
			InfoComps:     comps,
			InfoCompsMore: hasMore,
		},
	}
	return update
}

func makeInsertUpdateFromComps(pos int64, prefix string, comps []string, hasMore bool) sstore.UpdatePacket {
	if hasMore {
		return nil
	}
	lcp := longestPrefix(prefix, comps)
	if lcp == prefix || len(lcp) < len(prefix) || !strings.HasPrefix(lcp, prefix) {
		return nil
	}
	insertChars := lcp[len(prefix):]
	clu := &sstore.CmdLineType{InsertChars: insertChars, InsertPos: pos}
	return sstore.ModelUpdate{CmdLine: clu}
}

func longestPrefix(root string, comps []string) string {
	if len(comps) == 0 {
		return root
	}
	if len(comps) == 1 {
		comp := comps[0]
		if len(comp) >= len(root) && strings.HasPrefix(comp, root) {
			if strings.HasSuffix(comp, "/") {
				return comps[0]
			}
			return comps[0] + " "
		}
	}
	lcp := comps[0]
	for i := 1; i < len(comps); i++ {
		s := comps[i]
		for j := 0; j < len(lcp); j++ {
			if j >= len(s) || lcp[j] != s[j] {
				lcp = lcp[0:j]
				break
			}
		}
	}
	if len(lcp) < len(root) || !strings.HasPrefix(lcp, root) {
		return root
	}
	return lcp
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
		return nil, false, fmt.Errorf("/compgen invalid type '%s'", compType)
	}
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window|R_RemoteConnected)
	if err != nil {
		return nil, false, fmt.Errorf("compgen error: %w", err)
	}
	cgPacket := packet.MakeCompGenPacket()
	cgPacket.ReqId = uuid.New().String()
	cgPacket.CompType = compType
	cgPacket.Prefix = prefix
	cgPacket.Cwd = ids.Remote.RemoteState.Cwd
	resp, err := ids.Remote.MShell.PacketRpc(ctx, cgPacket)
	if err != nil {
		return nil, false, err
	}
	if err = resp.Err(); err != nil {
		return nil, false, err
	}
	comps := getStrArr(resp.Data, "comps")
	hasMore := getBool(resp.Data, "hasmore")
	return comps, hasMore, nil
}

func CompGenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	cmdLine := firstArg(pk)
	pos := len(cmdLine)
	if pk.Kwargs["comppos"] != "" {
		posArg, err := strconv.Atoi(pk.Kwargs["comppos"])
		if err != nil {
			return nil, fmt.Errorf("/compgen invalid comppos '%s': %w", pk.Kwargs["comppos"], err)
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
	prefix := cmdLine[:pos]
	parts := strings.Split(prefix, " ")
	compType := "file"
	if len(parts) > 0 && len(parts) < 2 && strings.HasPrefix(parts[0], "/") {
		compType = "metacommand"
	} else if len(parts) == 2 && (parts[0] == "cd" || parts[0] == "/cd") {
		compType = "directory"
	} else if len(parts) <= 1 {
		compType = "command"
	}
	lastPart := ""
	if len(parts) > 0 {
		lastPart = parts[len(parts)-1]
	}
	comps, hasMore, err := doCompGen(ctx, pk, lastPart, compType, showComps)
	if err != nil {
		return nil, err
	}
	if showComps {
		return makeInfoFromComps(compType, comps, hasMore), nil
	}
	return makeInsertUpdateFromComps(int64(pos), lastPart, comps, hasMore), nil
}

func CommentCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Window)
	if err != nil {
		return nil, fmt.Errorf("/comment error: %w", err)
	}
	text := firstArg(pk)
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("cannot post empty comment")
	}
	rtnLine, err := sstore.AddCommentLine(ctx, ids.SessionId, ids.WindowId, DefaultUserId, text)
	if err != nil {
		return nil, err
	}
	return sstore.ModelUpdate{Line: rtnLine}, nil
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

func SessionOpenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	activate := resolveBool(pk.Kwargs["activate"], true)
	newName := pk.Kwargs["name"]
	if newName != "" {
		err := validateName(newName, "session")
		if err != nil {
			return nil, err
		}
	}
	update, err := sstore.InsertSessionWithName(ctx, newName, activate)
	if err != nil {
		return nil, err
	}
	return update, nil
}

func SessionDeleteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session)
	if err != nil {
		return nil, err
	}
	err = sstore.DeleteSession(ctx, ids.SessionId)
	if err != nil {
		return nil, fmt.Errorf("cannot delete session: %v", err)
	}
	sessionIds, _ := sstore.GetAllSessionIds(ctx) // ignore error, session is already deleted so that's the main return value
	delSession := &sstore.SessionType{SessionId: ids.SessionId, Remove: true}
	update := sstore.ModelUpdate{
		Sessions: []*sstore.SessionType{delSession},
	}
	if len(sessionIds) > 0 {
		update.ActiveSessionId = sessionIds[0]
	}
	return update, nil
}

func SessionSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
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
	if pk.Kwargs["pos"] != "" {

	}
	if len(varsUpdated) == 0 {
		return nil, fmt.Errorf("/session:set no updates, can set %s", formatStrs([]string{"name", "pos"}, "or", false))
	}
	bareSession, err := sstore.GetBareSessionById(ctx, ids.SessionId)
	update := sstore.ModelUpdate{
		Sessions: []*sstore.SessionType{bareSession},
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("session updated %s", formatStrs(varsUpdated, "and", false)),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func SessionCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, 0)
	if err != nil {
		return nil, err
	}
	firstArg := firstArg(pk)
	if firstArg == "" {
		return nil, fmt.Errorf("usage /session [name|id|pos], no param specified")
	}
	bareSessions, err := sstore.GetBareSessions(ctx)
	if err != nil {
		return nil, err
	}
	ritems := sessionsToResolveItems(bareSessions)
	ritem, err := genericResolve(firstArg, ids.SessionId, ritems, "session")
	if err != nil {
		return nil, err
	}
	err = sstore.SetActiveSessionId(ctx, ritem.Id)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{
		ActiveSessionId: ritem.Id,
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("switched to session %q", ritem.Name),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func ClearCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Window)
	if err != nil {
		return nil, err
	}
	update, err := sstore.ClearWindow(ctx, ids.SessionId, ids.WindowId)
	if err != nil {
		return nil, fmt.Errorf("clearing window: %v", err)
	}
	update.Info = &sstore.InfoMsgType{
		InfoMsg:   fmt.Sprintf("window cleared"),
		TimeoutMs: 2000,
	}
	return update, nil
}

const DefaultMaxHistoryItems = 10000

func HistoryCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	maxItems, err := resolveInt(pk.Kwargs["maxitems"], DefaultMaxHistoryItems)
	if err != nil {
		return nil, fmt.Errorf("invalid maxitems value '%s' (must be a number): %v", pk.Kwargs["maxitems"], err)
	}
	if maxItems < 0 {
		return nil, fmt.Errorf("invalid maxitems value '%s' (cannot be negative)", maxItems)
	}
	if maxItems == 0 {
		maxItems = DefaultMaxHistoryItems
	}
	htype := HistoryTypeWindow
	hSessionId := ids.SessionId
	hWindowId := ids.WindowId
	if pk.Kwargs["type"] != "" {
		htype = pk.Kwargs["type"]
		if htype != HistoryTypeWindow && htype != HistoryTypeSession && htype != HistoryTypeGlobal {
			return nil, fmt.Errorf("invalid history type '%s', valid types: %s", htype, formatStrs([]string{HistoryTypeWindow, HistoryTypeSession, HistoryTypeGlobal}, "or", false))
		}
	}
	if htype == HistoryTypeGlobal {
		hSessionId = ""
		hWindowId = ""
	} else if htype == HistoryTypeSession {
		hWindowId = ""
	}
	hitems, err := sstore.GetHistoryItems(ctx, hSessionId, hWindowId, sstore.HistoryQueryOpts{MaxItems: maxItems})
	if err != nil {
		return nil, err
	}
	show := !resolveBool(pk.Kwargs["noshow"], false)
	update := &sstore.ModelUpdate{}
	update.History = &sstore.HistoryInfoType{
		HistoryType: htype,
		SessionId:   ids.SessionId,
		WindowId:    ids.WindowId,
		Items:       hitems,
		Show:        show,
	}
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
	fmt.Printf("resize running cmd %s/%s %d => %d\n", cmd.SessionId, cmd.CmdId, cmd.TermOpts.Cols, newCols)
	siPk := packet.MakeSpecialInputPacket()
	siPk.CK = base.MakeCommandKey(cmd.SessionId, cmd.CmdId)
	siPk.WinSize = &packet.WinSize{Rows: int(cmd.TermOpts.Rows), Cols: newCols}
	msh := remote.GetRemoteById(cmd.Remote.RemoteId)
	if msh == nil {
		return fmt.Errorf("cannot resize, cmd remote not found")
	}
	err := msh.SendSpecialInput(siPk)
	if err != nil {
		return err
	}
	newTermOpts := cmd.TermOpts
	newTermOpts.Cols = int64(newCols)
	err = sstore.UpdateCmdTermOpts(ctx, cmd.SessionId, cmd.CmdId, newTermOpts)
	if err != nil {
		return err
	}
	return nil
}

func WindowResizeCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Window)
	if err != nil {
		return nil, err
	}
	colsStr := pk.Kwargs["cols"]
	if colsStr == "" {
		return nil, fmt.Errorf("/window:resize requires a numeric 'cols' argument")
	}
	cols, err := strconv.Atoi(colsStr)
	if err != nil {
		return nil, fmt.Errorf("/window:resize requires a numeric 'cols' argument: %v", err)
	}
	if cols <= 0 {
		return nil, fmt.Errorf("/window:resize invalid zero/negative 'cols' argument")
	}
	cols = base.BoundInt(cols, shexec.MinTermCols, shexec.MaxTermCols)
	runningCmds, err := sstore.GetRunningWindowCmds(ctx, ids.SessionId, ids.WindowId)
	if err != nil {
		return nil, fmt.Errorf("/window:resize cannot get running commands: %v", err)
	}
	if len(runningCmds) == 0 {
		return nil, nil
	}
	for _, cmd := range runningCmds {
		if int(cmd.TermOpts.Cols) != cols {
			resizeRunningCommand(ctx, cmd, cols)
		}
	}
	return nil, nil
}

func LineCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	return nil, fmt.Errorf("/line requires a subcommand: %s", formatStrs([]string{"show"}, "or", false))
}

func LineShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveUiIds(ctx, pk, R_Session|R_Screen|R_Window)
	if err != nil {
		return nil, err
	}
	fmt.Printf("/line:show ids %v\n", ids)
	return nil, nil
}
