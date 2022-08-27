package cmdrunner

import (
	"bytes"
	"context"
	"fmt"
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

const DefaultUserId = "sawka"
const MaxNameLen = 50

var genericNameRe = regexp.MustCompile("^[a-zA-Z][a-zA-Z0-9_ .()<>,/\"'\\[\\]{}=+$@!*-]*$")
var positionRe = regexp.MustCompile("^((\\+|-)?[0-9]+|(\\+|-))$")
var wsRe = regexp.MustCompile("\\s+")

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

	registerCmdFn("session", SessionCommand)
	registerCmdFn("session:open", SessionOpenCommand)
	registerCmdAlias("session:new", SessionOpenCommand)
	registerCmdFn("session:set", SessionSetCommand)

	registerCmdFn("screen", ScreenCommand)
	registerCmdFn("screen:close", ScreenCloseCommand)
	registerCmdFn("screen:open", ScreenOpenCommand)
	registerCmdAlias("screen:new", ScreenOpenCommand)

	registerCmdAlias("remote", RemoteCommand)
	registerCmdFn("remote:show", RemoteShowCommand)
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

func RunCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, fmt.Errorf("/run error: %w", err)
	}
	if !ids.RState.IsConnected() {
		return nil, fmt.Errorf("cannot run command, remote '%s' not connected", ids.RemoteDisplayName)
	}
	if ids.RemoteState == nil {
		return nil, fmt.Errorf("cannot run command, remote '%s' has no state", ids.RemoteDisplayName)
	}
	cmdId := uuid.New().String()
	cmdStr := firstArg(pk)
	runPacket := packet.MakeRunPacket()
	runPacket.ReqId = uuid.New().String()
	runPacket.CK = base.MakeCommandKey(ids.SessionId, cmdId)
	runPacket.Cwd = ids.RemoteState.Cwd
	runPacket.Env0 = ids.RemoteState.Env0
	runPacket.EnvComplete = true
	runPacket.UsePty = true
	runPacket.TermOpts = &packet.TermOpts{Rows: remote.DefaultTermRows, Cols: remote.DefaultTermCols, Term: remote.DefaultTerm}
	runPacket.Command = strings.TrimSpace(cmdStr)
	cmd, err := remote.RunCommand(ctx, cmdId, ids.RemotePtr, ids.RemoteState, runPacket)
	if err != nil {
		return nil, err
	}
	rtnLine, err := sstore.AddCmdLine(ctx, ids.SessionId, ids.WindowId, DefaultUserId, cmd)
	if err != nil {
		return nil, err
	}
	return sstore.ModelUpdate{Line: rtnLine, Cmd: cmd}, nil
}

func addToHistory(ctx context.Context, pk *scpacket.FeCommandPacketType, update sstore.UpdatePacket, hadError bool) error {
	cmdStr := firstArg(pk)
	ids, err := resolveIds(ctx, pk, R_Session|R_Screen|R_Window)
	if err != nil {
		return err
	}
	lineId, cmdId := sstore.ReadLineCmdIdFromUpdate(update)
	hitem := &sstore.HistoryItemType{
		HistoryId: uuid.New().String(),
		Ts:        time.Now().UnixMilli(),
		UserId:    DefaultUserId,
		SessionId: ids.SessionId,
		ScreenId:  ids.ScreenId,
		WindowId:  ids.WindowId,
		LineId:    lineId,
		HadError:  hadError,
		CmdId:     cmdId,
		CmdStr:    cmdStr,
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
	newPk, err := EvalMetaCommand(ctx, pk)
	if err != nil {
		return nil, err
	}
	update, err := HandleCommand(ctx, newPk)
	if !resolveBool(pk.Kwargs["nohist"], false) {
		err := addToHistory(ctx, pk, update, (err != nil))
		if err != nil {
			fmt.Printf("[error] adding to history: %v\n", err)
			// continue...
		}
	}
	return update, err
}

func ScreenCloseCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Screen)
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
	ids, err := resolveIds(ctx, pk, R_Session)
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

func ScreenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session)
	if err != nil {
		return nil, fmt.Errorf("/screen cannot switch to screen: %w", err)
	}
	firstArg := firstArg(pk)
	if firstArg == "" {
		return nil, fmt.Errorf("usage /screen [screen-name|screen-index|screen-id], no param specified")
	}
	screenIdArg, err := resolveSessionScreen(ctx, ids.SessionId, firstArg)
	if err != nil {
		return nil, err
	}
	update, err := sstore.SwitchScreenById(ctx, ids.SessionId, screenIdArg)
	if err != nil {
		return nil, err
	}
	return update, nil
}

func UnSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	if !ids.RState.IsConnected() {
		return nil, fmt.Errorf("remote '%s' is not connected, cannot unset", ids.RemoteDisplayName)
	}
	if ids.RemoteState == nil {
		return nil, fmt.Errorf("remote '%s' state is not available, cannot unset", ids.RemoteDisplayName)
	}
	envMap := shexec.ParseEnv0(ids.RemoteState.Env0)
	unsetVars := make(map[string]bool)
	for _, argStr := range pk.Args {
		eqIdx := strings.Index(argStr, "=")
		if eqIdx != -1 {
			return nil, fmt.Errorf("invalid argument to setenv, '%s' (cannot contain equal sign)", argStr)
		}
		delete(envMap, argStr)
		unsetVars[argStr] = true
	}
	state := *ids.RemoteState
	state.Env0 = shexec.MakeEnv0(envMap)
	remote, err := sstore.UpdateRemoteState(ctx, ids.SessionId, ids.WindowId, ids.RemotePtr, state)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{
		Sessions: sstore.MakeSessionsUpdateForRemote(ids.SessionId, remote),
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] unset vars: %s", ids.RemoteDisplayName, formatStrs(mapToStrs(unsetVars), "and", false)),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func RemoteShowCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	curRemote := remote.GetRemoteById(ids.RemotePtr.RemoteId)
	if curRemote == nil {
		return nil, fmt.Errorf("invalid remote '%s' (not found)", ids.RemoteDisplayName)
	}
	state := curRemote.GetRemoteState()
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "type", state.RemoteType))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "remoteid", state.RemoteId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "physicalid", state.PhysicalId))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "alias", state.RemoteAlias))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "canonicalname", state.RemoteCanonicalName))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "status", state.Status))
	buf.WriteString(fmt.Sprintf("  %-15s %s\n", "connectmode", state.ConnectMode))
	if ids.RemoteState != nil {
		buf.WriteString(fmt.Sprintf("  %-15s %s\n", "cwd", ids.RemoteState.Cwd))
	}
	output := buf.String()
	return sstore.ModelUpdate{
		Info: &sstore.InfoMsgType{
			InfoTitle: fmt.Sprintf("show remote '%s' info", ids.RemoteDisplayName),
			InfoLines: splitLinesForInfo(output),
		},
	}, nil
}

func RemoteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	return nil, fmt.Errorf("/remote requires a subcommand: %s", formatStrs([]string{"show"}, "or", false))
}

func SetEnvCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	if !ids.RState.IsConnected() {
		return nil, fmt.Errorf("remote '%s' is not connected, cannot setenv", ids.RemoteDisplayName)
	}
	if ids.RemoteState == nil {
		return nil, fmt.Errorf("remote '%s' state is not available, cannot setenv", ids.RemoteDisplayName)
	}
	envMap := shexec.ParseEnv0(ids.RemoteState.Env0)
	if len(pk.Args) == 0 {
		var infoLines []string
		for varName, varVal := range envMap {
			line := fmt.Sprintf("%s=%s", varName, shellescape.Quote(varVal))
			infoLines = append(infoLines, line)
		}
		update := sstore.ModelUpdate{
			Info: &sstore.InfoMsgType{
				InfoTitle: fmt.Sprintf("environment for [%s] remote", ids.RemoteDisplayName),
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
	state := *ids.RemoteState
	state.Env0 = shexec.MakeEnv0(envMap)
	remote, err := sstore.UpdateRemoteState(ctx, ids.SessionId, ids.WindowId, ids.RemotePtr, state)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{
		Sessions: sstore.MakeSessionsUpdateForRemote(ids.SessionId, remote),
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] set vars: %s", ids.RemoteDisplayName, formatStrs(mapToStrs(setVars), "and", false)),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func CrCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Window)
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
		return nil, fmt.Errorf("/cr error: remote '%s' not found", newRemote)
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
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, fmt.Errorf("/cd error: %w", err)
	}
	newDir := firstArg(pk)
	curRemote := remote.GetRemoteById(ids.RemotePtr.RemoteId)
	if curRemote == nil {
		return nil, fmt.Errorf("remote '%s' not found, cannot change directory", ids.RemoteDisplayName)
	}
	if !ids.RState.IsConnected() {
		return nil, fmt.Errorf("remote '%s' is not connected, cannot change directory", ids.RemoteDisplayName)
	}
	if ids.RemoteState == nil {
		return nil, fmt.Errorf("remote '%s' state is not available, cannot change directory", ids.RemoteDisplayName)
	}
	if newDir == "" {
		return sstore.ModelUpdate{
			Info: &sstore.InfoMsgType{
				InfoMsg: fmt.Sprintf("[%s] current directory = %s", ids.RemoteDisplayName, ids.RemoteState.Cwd),
			},
		}, nil
	}
	newDir, err = ids.RState.ExpandHomeDir(newDir)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(newDir, "/") {
		if ids.RemoteState == nil {
			return nil, fmt.Errorf("/cd error: cannot get current remote directory (can only cd with absolute path)")
		}
		newDir = path.Join(ids.RemoteState.Cwd, newDir)
		newDir, err = filepath.Abs(newDir)
		if err != nil {
			return nil, fmt.Errorf("/cd error: error canonicalizing new directory: %w", err)
		}
	}
	cdPacket := packet.MakeCdPacket()
	cdPacket.ReqId = uuid.New().String()
	cdPacket.Dir = newDir
	resp, err := curRemote.PacketRpc(ctx, cdPacket)
	if err != nil {
		return nil, err
	}
	if err = resp.Err(); err != nil {
		return nil, err
	}
	state := *ids.RemoteState
	state.Cwd = newDir
	remote, err := sstore.UpdateRemoteState(ctx, ids.SessionId, ids.WindowId, ids.RemotePtr, state)
	if err != nil {
		return nil, err
	}
	update := sstore.ModelUpdate{
		Sessions: sstore.MakeSessionsUpdateForRemote(ids.SessionId, remote),
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] current directory = %s", ids.RemoteDisplayName, newDir),
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

func doMetaCompGen(ctx context.Context, ids resolvedIds, prefix string, forDisplay bool) ([]string, bool, error) {
	comps, hasMore, err := doCompGen(ctx, ids, prefix, "file", forDisplay)
	if err != nil {
		return nil, false, err
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

func doCompGen(ctx context.Context, ids resolvedIds, prefix string, compType string, forDisplay bool) ([]string, bool, error) {
	if compType == "metacommand" {
		return doMetaCompGen(ctx, ids, prefix, forDisplay)
	}
	if !packet.IsValidCompGenType(compType) {
		return nil, false, fmt.Errorf("/compgen invalid type '%s'", compType)
	}
	cgPacket := packet.MakeCompGenPacket()
	cgPacket.ReqId = uuid.New().String()
	cgPacket.CompType = compType
	cgPacket.Prefix = prefix
	if ids.RemoteState == nil {
		return nil, false, fmt.Errorf("/compgen invalid remote state")
	}
	cgPacket.Cwd = ids.RemoteState.Cwd
	curRemote := remote.GetRemoteById(ids.RemotePtr.RemoteId)
	if curRemote == nil {
		return nil, false, fmt.Errorf("invalid remote, cannot execute command")
	}
	resp, err := curRemote.PacketRpc(ctx, cgPacket)
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
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, fmt.Errorf("/compgen error: %w", err)
	}
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
	comps, hasMore, err := doCompGen(ctx, ids, lastPart, compType, showComps)
	if err != nil {
		return nil, err
	}
	if showComps {
		return makeInfoFromComps(compType, comps, hasMore), nil
	}
	return makeInsertUpdateFromComps(int64(pos), lastPart, comps, hasMore), nil
}

func CommentCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Window)
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

func SessionSetCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session)
	if err != nil {
		return nil, err
	}
	bareSession, err := sstore.GetBareSessionById(ctx, ids.SessionId)
	if err != nil {
		return nil, err
	}
	if bareSession == nil {
		return nil, fmt.Errorf("session '%s' not found", ids.SessionId)
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
	bareSession, err = sstore.GetBareSessionById(ctx, ids.SessionId)
	update := sstore.ModelUpdate{
		Sessions: []*sstore.SessionType{bareSession},
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s]: session updated %s", bareSession.Name, formatStrs(varsUpdated, "and", false)),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func SessionCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	firstArg := firstArg(pk)
	if firstArg == "" {
		return nil, fmt.Errorf("usage /session [name|id|pos], no param specified")
	}
	bareSessions, err := sstore.GetBareSessions(ctx)
	if err != nil {
		return nil, err
	}
	ritems := sessionsToResolveItems(bareSessions)
	ritem, err := genericResolve(firstArg, pk.Kwargs["session"], ritems, "session")
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

func splitLinesForInfo(str string) []string {
	rtn := strings.Split(str, "\n")
	if rtn[len(rtn)-1] == "" {
		return rtn[:len(rtn)-1]
	}
	return rtn
}
