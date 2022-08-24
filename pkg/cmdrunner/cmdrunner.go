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

const (
	R_Session    = 1
	R_Screen     = 2
	R_Window     = 4
	R_Remote     = 8
	R_SessionOpt = 16
	R_ScreenOpt  = 32
	R_WindowOpt  = 64
	R_RemoteOpt  = 128
)

type resolvedIds struct {
	SessionId   string
	ScreenId    string
	WindowId    string
	RemoteId    string
	RemoteName  string
	RemoteState *sstore.RemoteState
}

func SubMetaCmd(cmd string) string {
	switch cmd {
	case "s":
		return "screen"
	case "w":
		return "window"
	case "r":
		return "run"
	case "c":
		return "comment"
	case "e":
		return "eval"
	case "export":
		return "setenv"
	default:
		return cmd
	}
}

var ValidCommands = []string{
	"/run",
	"/eval",
	"/screen", "/screen:open", "/screen:close",
	"/session", "/session:open", "/session:close",
	"/comment",
	"/cd",
	"/compgen",
	"/setenv", "/unset",
	"/remote:show",
}

func HandleCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	switch SubMetaCmd(pk.MetaCmd) {
	case "run":
		return RunCommand(ctx, pk)

	case "eval":
		return EvalCommand(ctx, pk)

	case "screen":
		return ScreenCommand(ctx, pk)

	case "session":
		return SessionCommand(ctx, pk)

	case "comment":
		return CommentCommand(ctx, pk)

	case "cd":
		return CdCommand(ctx, pk)

	case "cr":
		return CrCommand(ctx, pk)

	case "compgen":
		return CompGenCommand(ctx, pk)

	case "setenv":
		return SetEnvCommand(ctx, pk)

	case "unset":
		return UnSetCommand(ctx, pk)

	case "remote":
		return RemoteCommand(ctx, pk)

	default:
		return nil, fmt.Errorf("invalid command '/%s', no handler", pk.MetaCmd)
	}
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

func resolveSessionScreen(ctx context.Context, sessionId string, screenArg string) (string, error) {
	screens, err := sstore.GetSessionScreens(ctx, sessionId)
	if err != nil {
		return "", fmt.Errorf("could not retreive screens for session=%s", sessionId)
	}
	screenNum, err := strconv.Atoi(screenArg)
	if err == nil {
		if screenNum < 1 || screenNum > len(screens) {
			return "", fmt.Errorf("could not resolve screen #%d (out of range), valid screens 1-%d", screenNum, len(screens))
		}
		return screens[screenNum-1].ScreenId, nil
	}
	for _, screen := range screens {
		if screen.ScreenId == screenArg || screen.Name == screenArg {
			return screen.ScreenId, nil
		}
	}
	return "", fmt.Errorf("could not resolve screen '%s' (name/id not found)", screenArg)
}

func resolveSession(ctx context.Context, sessionArg string) (string, error) {
	sessions, err := sstore.GetBareSessions(ctx)
	if err != nil {
		return "", fmt.Errorf("could not retrive bare sessions")
	}
	for _, session := range sessions {
		if session.SessionId == sessionArg || session.Name == sessionArg {
			return session.SessionId, nil
		}
	}
	return "", fmt.Errorf("could not resolve sesssion '%s' (name/id not found)", sessionArg)
}

func resolveSessionId(pk *scpacket.FeCommandPacketType) (string, error) {
	sessionId := pk.Kwargs["session"]
	if sessionId == "" {
		return "", nil
	}
	if _, err := uuid.Parse(sessionId); err != nil {
		return "", fmt.Errorf("invalid sessionid '%s'", sessionId)
	}
	return sessionId, nil
}

func resolveWindowId(pk *scpacket.FeCommandPacketType, sessionId string) (string, error) {
	windowId := pk.Kwargs["window"]
	if windowId == "" {
		return "", nil
	}
	if _, err := uuid.Parse(windowId); err != nil {
		return "", fmt.Errorf("invalid windowid '%s'", windowId)
	}
	return windowId, nil
}

func resolveScreenId(ctx context.Context, pk *scpacket.FeCommandPacketType, sessionId string) (string, error) {
	screenArg := pk.Kwargs["screen"]
	if screenArg == "" {
		return "", nil
	}
	if _, err := uuid.Parse(screenArg); err == nil {
		return screenArg, nil
	}
	if sessionId == "" {
		return "", fmt.Errorf("cannot resolve screen without session")
	}
	return resolveSessionScreen(ctx, sessionId, screenArg)
}

// returns (remoteName, remoteId, state, err)
func resolveRemote(ctx context.Context, remoteName string, sessionId string, windowId string) (string, string, *sstore.RemoteState, error) {
	if remoteName == "" {
		return "", "", nil, nil
	}
	remoteId, state, err := sstore.GetRemoteState(ctx, remoteName, sessionId, windowId)
	if err != nil {
		return "", "", nil, fmt.Errorf("cannot resolve remote '%s': %w", remoteName, err)
	}
	if state == nil {
		state, err = remote.GetDefaultRemoteStateById(remoteId)
		if err != nil {
			return "", "", nil, fmt.Errorf("cannot resolve remote '%s': %w", remoteName, err)
		}
	}
	return remoteName, remoteId, state, nil
}

func resolveIds(ctx context.Context, pk *scpacket.FeCommandPacketType, rtype int) (resolvedIds, error) {
	rtn := resolvedIds{}
	if rtype == 0 {
		return rtn, nil
	}
	var err error
	if (rtype&R_Session)+(rtype&R_SessionOpt) > 0 {
		rtn.SessionId, err = resolveSessionId(pk)
		if err != nil {
			return rtn, err
		}
		if rtn.SessionId == "" && (rtype&R_Session) > 0 {
			return rtn, fmt.Errorf("no session")
		}
	}
	if (rtype&R_Window)+(rtype&R_WindowOpt) > 0 {
		rtn.WindowId, err = resolveWindowId(pk, rtn.SessionId)
		if err != nil {
			return rtn, err
		}
		if rtn.WindowId == "" && (rtype&R_Window) > 0 {
			return rtn, fmt.Errorf("no window")
		}

	}
	if (rtype&R_Screen)+(rtype&R_ScreenOpt) > 0 {
		rtn.ScreenId, err = resolveScreenId(ctx, pk, rtn.SessionId)
		if err != nil {
			return rtn, err
		}
		if rtn.ScreenId == "" && (rtype&R_Screen) > 0 {
			return rtn, fmt.Errorf("no screen")
		}
	}
	if (rtype&R_Remote)+(rtype&R_RemoteOpt) > 0 {
		rtn.RemoteName, rtn.RemoteId, rtn.RemoteState, err = resolveRemote(ctx, pk.Kwargs["remote"], rtn.SessionId, rtn.WindowId)
		if err != nil {
			return rtn, err
		}
		if rtn.RemoteId == "" && (rtype&R_Remote) > 0 {
			return rtn, fmt.Errorf("no remote")
		}
	}
	return rtn, nil
}

func RunCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, fmt.Errorf("/run error: %w", err)
	}
	cmdId := uuid.New().String()
	cmdStr := firstArg(pk)
	runPacket := packet.MakeRunPacket()
	runPacket.ReqId = uuid.New().String()
	runPacket.CK = base.MakeCommandKey(ids.SessionId, cmdId)
	runPacket.Cwd = ids.RemoteState.Cwd
	runPacket.Env0 = ids.RemoteState.Env0
	fmt.Printf("run-command FOO [%s]\n", shexec.ParseEnv0(ids.RemoteState.Env0)["FOO"])
	runPacket.EnvComplete = true
	runPacket.UsePty = true
	runPacket.TermOpts = &packet.TermOpts{Rows: remote.DefaultTermRows, Cols: remote.DefaultTermCols, Term: remote.DefaultTerm}
	runPacket.Command = strings.TrimSpace(cmdStr)
	cmd, err := remote.RunCommand(ctx, cmdId, ids.RemoteId, ids.RemoteState, runPacket)
	if err != nil {
		return nil, err
	}
	rtnLine, err := sstore.AddCmdLine(ctx, ids.SessionId, ids.WindowId, DefaultUserId, cmd)
	if err != nil {
		return nil, err
	}
	return sstore.LineUpdate{Line: rtnLine, Cmd: cmd}, nil
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
	// parse metacmd
	commandStr := strings.TrimSpace(pk.Args[0])
	if commandStr == "" {
		return nil, fmt.Errorf("/eval, invalid emtpty command")
	}
	update, err := evalCommandInternal(ctx, pk)
	if !resolveBool(pk.Kwargs["nohist"], false) {
		err := addToHistory(ctx, pk, update, (err != nil))
		if err != nil {
			fmt.Printf("[error] adding to history: %v\n", err)
			// continue...
		}
	}
	return update, err
}

func evalCommandInternal(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	commandStr := strings.TrimSpace(pk.Args[0])
	metaCmd := ""
	metaSubCmd := ""
	if commandStr == "cd" || strings.HasPrefix(commandStr, "cd ") {
		metaCmd = "cd"
		commandStr = strings.TrimSpace(commandStr[2:])
	} else if commandStr == "cr" || strings.HasPrefix(commandStr, "cr ") {
		metaCmd = "cr"
		commandStr = strings.TrimSpace(commandStr[2:])
	} else if commandStr == "export" || strings.HasPrefix(commandStr, "export ") {
		metaCmd = "setenv"
		commandStr = strings.TrimSpace(commandStr[6:])
	} else if commandStr == "setenv" || strings.HasPrefix(commandStr, "setenv ") {
		metaCmd = "setenv"
		commandStr = strings.TrimSpace(commandStr[6:])
	} else if commandStr == "unset" || strings.HasPrefix(commandStr, "unset ") {
		metaCmd = "unset"
		commandStr = strings.TrimSpace(commandStr[5:])
	} else if commandStr[0] == '/' {
		spaceIdx := strings.Index(commandStr, " ")
		if spaceIdx == -1 {
			metaCmd = commandStr[1:]
			commandStr = ""
		} else {
			metaCmd = commandStr[1:spaceIdx]
			commandStr = strings.TrimSpace(commandStr[spaceIdx+1:])
		}
		colonIdx := strings.Index(metaCmd, ":")
		if colonIdx != -1 {
			metaCmd, metaSubCmd = metaCmd[0:colonIdx], metaCmd[colonIdx+1:]
		}
		if metaCmd == "" {
			return nil, fmt.Errorf("invalid command, got bare '/', with no command")
		}
	}
	if metaCmd == "" {
		metaCmd = "run"
	}
	metaCmd = SubMetaCmd(metaCmd)
	newPk := &scpacket.FeCommandPacketType{
		MetaCmd:    metaCmd,
		MetaSubCmd: metaSubCmd,
		Kwargs:     pk.Kwargs,
	}
	if strings.HasSuffix(commandStr, " ?") {
		newPk.Kwargs["ephemeral"] = "1"
		commandStr = commandStr[0 : len(commandStr)-2]
	}
	if metaCmd == "run" || metaCmd == "comment" {
		newPk.Args = []string{commandStr}
	} else if (metaCmd == "setenv" || metaCmd == "unset") && metaSubCmd == "" {
		newPk.Args = strings.Fields(commandStr)
	} else {
		allArgs := strings.Fields(commandStr)
		for _, arg := range allArgs {
			if strings.Index(arg, "=") == -1 {
				newPk.Args = append(newPk.Args, arg)
				continue
			}
			fields := strings.SplitN(arg, "=", 2)
			newPk.Kwargs[fields[0]] = fields[1]
		}
	}
	return HandleCommand(ctx, newPk)
}

func ScreenCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	if pk.MetaSubCmd == "close" {
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
	if pk.MetaSubCmd == "open" || pk.MetaSubCmd == "new" {
		ids, err := resolveIds(ctx, pk, R_Session)
		if err != nil {
			return nil, fmt.Errorf("/screen:open cannot open screen: %w", err)
		}
		activate := resolveBool(pk.Kwargs["activate"], true)
		update, err := sstore.InsertScreen(ctx, ids.SessionId, pk.Kwargs["name"], activate)
		if err != nil {
			return nil, err
		}
		return update, nil
	}
	if pk.MetaSubCmd != "" {
		return nil, fmt.Errorf("invalid /screen subcommand '%s'", pk.MetaSubCmd)
	}
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
	if pk.MetaSubCmd != "" {
		return nil, fmt.Errorf("invalid /unset subcommand '%s'", pk.MetaSubCmd)
	}
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	curRemote := remote.GetRemoteById(ids.RemoteId)
	if curRemote == nil {
		return nil, fmt.Errorf("invalid remote, cannot unset")
	}
	if !curRemote.IsConnected() {
		return nil, fmt.Errorf("remote is not connected, cannot unset")
	}
	if ids.RemoteState == nil {
		return nil, fmt.Errorf("remote state is not available")
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
	remote, err := sstore.UpdateRemoteState(ctx, ids.RemoteName, ids.SessionId, ids.WindowId, ids.RemoteId, state)
	if err != nil {
		return nil, err
	}
	update := sstore.WindowUpdate{
		Window: sstore.WindowType{
			SessionId: ids.SessionId,
			WindowId:  ids.WindowId,
			Remotes:   []*sstore.RemoteInstance{remote},
		},
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] unset vars: %s", ids.RemoteName, makeSetVarsStr(unsetVars)),
			TimeoutMs: 2000,
		},
	}
	return update, nil
}

func RemoteCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	if pk.MetaSubCmd == "show" {
		ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
		if err != nil {
			return nil, err
		}
		curRemote := remote.GetRemoteById(ids.RemoteId)
		if curRemote == nil {
			return nil, fmt.Errorf("invalid remote [%s] (not found)", ids.RemoteName)
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
		return sstore.InfoUpdate{
			Info: &sstore.InfoMsgType{
				InfoTitle: fmt.Sprintf("show remote '%s' info", ids.RemoteName),
				InfoLines: splitLinesForInfo(output),
			},
		}, nil
	}
	if pk.MetaSubCmd != "" {
		return nil, fmt.Errorf("invalid /remote subcommand: '%s'", pk.MetaSubCmd)
	}
	return nil, fmt.Errorf("/remote requires a subcommand: 'show'")
}

func makeSetVarsStr(setVars map[string]bool) string {
	varArr := make([]string, 0, len(setVars))
	for varName, _ := range setVars {
		varArr = append(varArr, varName)
	}
	return strings.Join(varArr, ", ")
}

func SetEnvCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	if pk.MetaSubCmd != "" {
		return nil, fmt.Errorf("invalid /setenv subcommand '%s'", pk.MetaSubCmd)
	}
	ids, err := resolveIds(ctx, pk, R_Session|R_Window|R_Remote)
	if err != nil {
		return nil, err
	}
	curRemote := remote.GetRemoteById(ids.RemoteId)
	if curRemote == nil {
		return nil, fmt.Errorf("invalid remote, cannot setenv")
	}
	if !curRemote.IsConnected() {
		return nil, fmt.Errorf("remote is not connected, cannot setenv")
	}
	if ids.RemoteState == nil {
		return nil, fmt.Errorf("remote state is not available")
	}
	envMap := shexec.ParseEnv0(ids.RemoteState.Env0)
	if len(pk.Args) == 0 {
		var infoLines []string
		for varName, varVal := range envMap {
			line := fmt.Sprintf("%s=%s", varName, shellescape.Quote(varVal))
			infoLines = append(infoLines, line)
		}
		update := sstore.InfoUpdate{
			Info: &sstore.InfoMsgType{
				InfoTitle: fmt.Sprintf("environment for [%s] remote", ids.RemoteName),
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
	remote, err := sstore.UpdateRemoteState(ctx, ids.RemoteName, ids.SessionId, ids.WindowId, ids.RemoteId, state)
	if err != nil {
		return nil, err
	}
	update := sstore.WindowUpdate{
		Window: sstore.WindowType{
			SessionId: ids.SessionId,
			WindowId:  ids.WindowId,
			Remotes:   []*sstore.RemoteInstance{remote},
		},
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] set vars: %s", ids.RemoteName, makeSetVarsStr(setVars)),
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
	remoteName, remoteId, _, err := resolveRemote(ctx, newRemote, ids.SessionId, ids.WindowId)
	fmt.Printf("found: name[%s] id[%s] err[%v]\n", remoteName, remoteId, err)
	if err != nil {
		return nil, err
	}
	if remoteId == "" {
		return nil, fmt.Errorf("/cr error: remote not found")
	}
	err = sstore.UpdateCurRemote(ctx, ids.SessionId, ids.WindowId, remoteName)
	if err != nil {
		return nil, fmt.Errorf("/cr error: cannot update curremote: %w", err)
	}
	update := sstore.WindowUpdate{
		Window: sstore.WindowType{
			SessionId: ids.SessionId,
			WindowId:  ids.WindowId,
			CurRemote: remoteName,
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
	curRemote := remote.GetRemoteById(ids.RemoteId)
	if curRemote == nil {
		return nil, fmt.Errorf("invalid remote, cannot change directory")
	}
	if !curRemote.IsConnected() {
		return nil, fmt.Errorf("remote is not connected, cannot change directory")
	}
	if ids.RemoteState == nil {
		return nil, fmt.Errorf("remote state is not available")
	}
	if newDir == "" {
		return sstore.InfoUpdate{
			Info: &sstore.InfoMsgType{
				InfoMsg: fmt.Sprintf("[%s] current directory = %s", ids.RemoteName, ids.RemoteState.Cwd),
			},
		}, nil
	}
	newDir, err = curRemote.ExpandHomeDir(newDir)
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
	remote, err := sstore.UpdateRemoteState(ctx, ids.RemoteName, ids.SessionId, ids.WindowId, ids.RemoteId, state)
	if err != nil {
		return nil, err
	}
	update := sstore.WindowUpdate{
		Window: sstore.WindowType{
			SessionId: ids.SessionId,
			WindowId:  ids.WindowId,
			Remotes:   []*sstore.RemoteInstance{remote},
		},
		Info: &sstore.InfoMsgType{
			InfoMsg:   fmt.Sprintf("[%s] current directory = %s", ids.RemoteName, newDir),
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
	update := sstore.InfoUpdate{
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
	return sstore.InfoUpdate{CmdLine: clu}
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

var wsRe = regexp.MustCompile("\\s+")

func doMetaCompGen(ctx context.Context, ids resolvedIds, prefix string, forDisplay bool) ([]string, bool, error) {
	comps, hasMore, err := doCompGen(ctx, ids, prefix, "file", forDisplay)
	if err != nil {
		return nil, false, err
	}
	for _, cmd := range ValidCommands {
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
	curRemote := remote.GetRemoteById(ids.RemoteId)
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
	return sstore.LineUpdate{Line: rtnLine}, nil
}

func SessionCommand(ctx context.Context, pk *scpacket.FeCommandPacketType) (sstore.UpdatePacket, error) {
	if pk.MetaSubCmd == "open" || pk.MetaSubCmd == "new" {
		activate := resolveBool(pk.Kwargs["activate"], true)
		update, err := sstore.InsertSessionWithName(ctx, pk.Kwargs["name"], activate)
		if err != nil {
			return nil, err
		}
		return update, nil
	}
	if pk.MetaSubCmd != "" {
		return nil, fmt.Errorf("invalid /session subcommand '%s'", pk.MetaSubCmd)
	}
	firstArg := firstArg(pk)
	if firstArg == "" {
		return nil, fmt.Errorf("usage /session [session-name|session-id], no param specified")
	}
	sessionId, err := resolveSession(ctx, firstArg)
	if err != nil {
		return nil, err
	}
	return sstore.SessionUpdate{ActiveSessionId: sessionId}, nil
}

func splitLinesForInfo(str string) []string {
	rtn := strings.Split(str, "\n")
	if rtn[len(rtn)-1] == "" {
		return rtn[:len(rtn)-1]
	}
	return rtn
}
