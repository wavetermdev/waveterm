// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	BlockController_Shell = "shell"
	BlockController_Cmd   = "cmd"
)

const (
	ConnType_Local = "local"
	ConnType_Wsl   = "wsl"
	ConnType_Ssh   = "ssh"
)

const (
	Status_Running = "running"
	Status_Done    = "done"
	Status_Init    = "init"
)

const (
	DefaultTermMaxFileSize = 256 * 1024
	DefaultHtmlMaxFileSize = 256 * 1024
	MaxInitScriptSize      = 50 * 1024
)

const DefaultTimeout = 2 * time.Second

var globalLock = &sync.Mutex{}
var blockControllerMap = make(map[string]*BlockController)

type BlockInputUnion struct {
	InputData []byte            `json:"inputdata,omitempty"`
	SigName   string            `json:"signame,omitempty"`
	TermSize  *waveobj.TermSize `json:"termsize,omitempty"`
}

type BlockController struct {
	Lock              *sync.Mutex
	ControllerType    string
	TabId             string
	BlockId           string
	BlockDef          *waveobj.BlockDef
	CreatedHtmlFile   bool
	ShellProc         *shellexec.ShellProc
	ShellInputCh      chan *BlockInputUnion
	ShellProcStatus   string
	ShellProcExitCode int
	RunLock           *atomic.Bool
	StatusVersion     int
}

type BlockControllerRuntimeStatus struct {
	BlockId           string `json:"blockid"`
	Version           int    `json:"version"`
	ShellProcStatus   string `json:"shellprocstatus,omitempty"`
	ShellProcConnName string `json:"shellprocconnname,omitempty"`
	ShellProcExitCode int    `json:"shellprocexitcode"`
}

func (bc *BlockController) WithLock(f func()) {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	f()
}

func (bc *BlockController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	bc.WithLock(func() {
		bc.StatusVersion++
		rtn.Version = bc.StatusVersion
		rtn.BlockId = bc.BlockId
		rtn.ShellProcStatus = bc.ShellProcStatus
		if bc.ShellProc != nil {
			rtn.ShellProcConnName = bc.ShellProc.ConnName
		}
		rtn.ShellProcExitCode = bc.ShellProcExitCode
	})
	return &rtn
}

func (bc *BlockController) getShellProc() *shellexec.ShellProc {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	return bc.ShellProc
}

type RunShellOpts struct {
	TermSize waveobj.TermSize `json:"termsize,omitempty"`
}

func (bc *BlockController) UpdateControllerAndSendUpdate(updateFn func() bool) {
	var sendUpdate bool
	bc.WithLock(func() {
		sendUpdate = updateFn()
	})
	if sendUpdate {
		rtStatus := bc.GetRuntimeStatus()
		log.Printf("sending blockcontroller update %#v\n", rtStatus)
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_ControllerStatus,
			Scopes: []string{
				waveobj.MakeORef(waveobj.OType_Tab, bc.TabId).String(),
				waveobj.MakeORef(waveobj.OType_Block, bc.BlockId).String(),
			},
			Data: rtStatus,
		})
	}
}

func HandleTruncateBlockFile(blockId string) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.WriteFile(ctx, blockId, wavebase.BlockFile_Term, nil)
	if err == fs.ErrNotExist {
		return nil
	}
	if err != nil {
		return fmt.Errorf("error truncating blockfile: %w", err)
	}
	err = filestore.WFS.DeleteFile(ctx, blockId, wavebase.BlockFile_Cache)
	if err == fs.ErrNotExist {
		err = nil
	}
	if err != nil {
		log.Printf("error deleting cache file (continuing): %v\n", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: wavebase.BlockFile_Term,
			FileOp:   wps.FileOp_Truncate,
		},
	})
	return nil

}

func HandleAppendBlockFile(blockId string, blockFile string, data []byte) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.AppendData(ctx, blockId, blockFile, data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile: %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_BlockFile,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   wps.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
}

func (bc *BlockController) resetTerminalState(logCtx context.Context) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	wfile, statErr := filestore.WFS.Stat(ctx, bc.BlockId, wavebase.BlockFile_Term)
	if statErr == fs.ErrNotExist || wfile.Size == 0 {
		return
	}
	blocklogger.Debugf(logCtx, "[conndebug] resetTerminalState: resetting terminal state\n")
	// controller type = "shell"
	var buf bytes.Buffer
	// buf.WriteString("\x1b[?1049l") // disable alternative buffer
	buf.WriteString("\x1b[0m")     // reset attributes
	buf.WriteString("\x1b[?25h")   // show cursor
	buf.WriteString("\x1b[?1000l") // disable mouse tracking
	buf.WriteString("\r\n\r\n")
	err := HandleAppendBlockFile(bc.BlockId, wavebase.BlockFile_Term, buf.Bytes())
	if err != nil {
		log.Printf("error appending to blockfile (terminal reset): %v\n", err)
	}
}

func getCustomInitScriptKeyCascade(shellType string) []string {
	if shellType == "bash" {
		return []string{waveobj.MetaKey_CmdInitScriptBash, waveobj.MetaKey_CmdInitScriptSh, waveobj.MetaKey_CmdInitScript}
	}
	if shellType == "zsh" {
		return []string{waveobj.MetaKey_CmdInitScriptZsh, waveobj.MetaKey_CmdInitScriptSh, waveobj.MetaKey_CmdInitScript}
	}
	if shellType == "pwsh" {
		return []string{waveobj.MetaKey_CmdInitScriptPwsh, waveobj.MetaKey_CmdInitScript}
	}
	if shellType == "fish" {
		return []string{waveobj.MetaKey_CmdInitScriptFish, waveobj.MetaKey_CmdInitScript}
	}
	return []string{waveobj.MetaKey_CmdInitScript}
}

func getCustomInitScript(logCtx context.Context, meta waveobj.MetaMapType, connName string, shellType string) string {
	initScriptVal, metaKeyName := getCustomInitScriptValue(meta, connName, shellType)
	if initScriptVal == "" {
		return ""
	}
	if !fileutil.IsInitScriptPath(initScriptVal) {
		blocklogger.Infof(logCtx, "[conndebug] inline initScript (size=%d) found in meta key: %s\n", len(initScriptVal), metaKeyName)
		return initScriptVal
	}
	blocklogger.Infof(logCtx, "[conndebug] initScript detected as a file %q from meta key: %s\n", initScriptVal, metaKeyName)
	initScriptVal, err := wavebase.ExpandHomeDir(initScriptVal)
	if err != nil {
		blocklogger.Infof(logCtx, "[conndebug] cannot expand home dir in Wave initscript file: %v\n", err)
		return fmt.Sprintf("echo \"cannot expand home dir in Wave initscript file, from key %s\";\n", metaKeyName)
	}
	fileData, err := os.ReadFile(initScriptVal)
	if err != nil {
		blocklogger.Infof(logCtx, "[conndebug] cannot open Wave initscript file: %v\n", err)
		return fmt.Sprintf("echo \"cannot open Wave initscript file, from key %s\";\n", metaKeyName)
	}
	if len(fileData) > MaxInitScriptSize {
		blocklogger.Infof(logCtx, "[conndebug] initscript file too large, size=%d, max=%d\n", len(fileData), MaxInitScriptSize)
		return fmt.Sprintf("echo \"initscript file too large, from key %s\";\n", metaKeyName)
	}
	if utilfn.HasBinaryData(fileData) {
		blocklogger.Infof(logCtx, "[conndebug] initscript file contains binary data\n")
		return fmt.Sprintf("echo \"initscript file contains binary data, from key %s\";\n", metaKeyName)
	}
	blocklogger.Infof(logCtx, "[conndebug] initscript file read successfully, size=%d\n", len(fileData))
	return string(fileData)
}

// returns (value, metakey)
func getCustomInitScriptValue(meta waveobj.MetaMapType, connName string, shellType string) (string, string) {
	keys := getCustomInitScriptKeyCascade(shellType)
	connMeta := meta.GetConnectionOverride(connName)
	if connMeta != nil {
		for _, key := range keys {
			if connMeta.HasKey(key) {
				return connMeta.GetString(key, ""), "blockmeta/[" + connName + "]/" + key
			}
		}
	}
	for _, key := range keys {
		if meta.HasKey(key) {
			return meta.GetString(key, ""), "blockmeta/" + key
		}
	}
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	connKeywords := fullConfig.Connections[connName]
	connKeywordsMap := make(map[string]any)
	err := utilfn.ReUnmarshal(&connKeywordsMap, connKeywords)
	if err != nil {
		log.Printf("error re-unmarshalling connKeywords: %v\n", err)
		return "", ""
	}
	ckMeta := waveobj.MetaMapType(connKeywordsMap)
	for _, key := range keys {
		if ckMeta.HasKey(key) {
			return ckMeta.GetString(key, ""), "connections.json/" + connName + "/" + key
		}
	}
	return "", ""
}

func resolveEnvMap(blockId string, blockMeta waveobj.MetaMapType, connName string) (map[string]string, error) {
	rtn := make(map[string]string)
	config := wconfig.GetWatcher().GetFullConfig()
	connKeywords := config.Connections[connName]
	ckEnv := connKeywords.CmdEnv
	for k, v := range ckEnv {
		rtn[k] = v
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	_, envFileData, err := filestore.WFS.ReadFile(ctx, blockId, wavebase.BlockFile_Env)
	if err == fs.ErrNotExist {
		err = nil
	}
	if err != nil {
		return nil, fmt.Errorf("error reading command env file: %w", err)
	}
	if len(envFileData) > 0 {
		envMap := envutil.EnvToMap(string(envFileData))
		for k, v := range envMap {
			rtn[k] = v
		}
	}
	cmdEnv := blockMeta.GetStringMap(waveobj.MetaKey_CmdEnv, true)
	for k, v := range cmdEnv {
		if v == waveobj.MetaMap_DeleteSentinel {
			delete(rtn, k)
			continue
		}
		rtn[k] = v
	}
	connEnv := blockMeta.GetConnectionOverride(connName).GetStringMap(waveobj.MetaKey_CmdEnv, true)
	for k, v := range connEnv {
		if v == waveobj.MetaMap_DeleteSentinel {
			delete(rtn, k)
			continue
		}
		rtn[k] = v
	}
	return rtn, nil
}

// for "cmd" type blocks
func createCmdStrAndOpts(blockId string, blockMeta waveobj.MetaMapType, connName string) (string, *shellexec.CommandOptsType, error) {
	var cmdStr string
	var cmdOpts shellexec.CommandOptsType
	cmdStr = blockMeta.GetString(waveobj.MetaKey_Cmd, "")
	if cmdStr == "" {
		return "", nil, fmt.Errorf("missing cmd in block meta")
	}
	cmdOpts.Cwd = blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
	if cmdOpts.Cwd != "" {
		cwdPath, err := wavebase.ExpandHomeDir(cmdOpts.Cwd)
		if err != nil {
			return "", nil, err
		}
		cmdOpts.Cwd = cwdPath
	}
	useShell := blockMeta.GetBool(waveobj.MetaKey_CmdShell, true)
	if !useShell {
		if strings.Contains(cmdStr, " ") {
			return "", nil, fmt.Errorf("cmd should not have spaces if cmd:shell is false (use cmd:args)")
		}
		cmdArgs := blockMeta.GetStringList(waveobj.MetaKey_CmdArgs)
		// shell escape the args
		for _, arg := range cmdArgs {
			cmdStr = cmdStr + " " + utilfn.ShellQuote(arg, false, -1)
		}
	}
	cmdOpts.ForceJwt = blockMeta.GetBool(waveobj.MetaKey_CmdJwt, false)
	return cmdStr, &cmdOpts, nil
}

func (bc *BlockController) DoRunShellCommand(logCtx context.Context, rc *RunShellOpts, blockMeta waveobj.MetaMapType) error {
	blocklogger.Debugf(logCtx, "[conndebug] DoRunShellCommand\n")
	shellProc, err := bc.setupAndStartShellProcess(logCtx, rc, blockMeta)
	if err != nil {
		return err
	}
	return bc.manageRunningShellProcess(shellProc, rc, blockMeta)
}

func (bc *BlockController) makeSwapToken(ctx context.Context, logCtx context.Context, blockMeta waveobj.MetaMapType, remoteName string, shellType string) *shellutil.TokenSwapEntry {
	token := &shellutil.TokenSwapEntry{
		Token: uuid.New().String(),
		Env:   make(map[string]string),
		Exp:   time.Now().Add(5 * time.Minute),
	}
	token.Env["TERM_PROGRAM"] = "waveterm"
	token.Env["WAVETERM_BLOCKID"] = bc.BlockId
	token.Env["WAVETERM_VERSION"] = wavebase.WaveVersion
	token.Env["WAVETERM"] = "1"
	tabId, err := wstore.DBFindTabForBlockId(ctx, bc.BlockId)
	if err != nil {
		log.Printf("error finding tab for block: %v\n", err)
	} else {
		token.Env["WAVETERM_TABID"] = tabId
	}
	if tabId != "" {
		wsId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
		if err != nil {
			log.Printf("error finding workspace for tab: %v\n", err)
		} else {
			token.Env["WAVETERM_WORKSPACEID"] = wsId
		}
	}
	clientData, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		log.Printf("error getting client data: %v\n", err)
	} else {
		token.Env["WAVETERM_CLIENTID"] = clientData.OID
	}
	token.Env["WAVETERM_CONN"] = remoteName
	envMap, err := resolveEnvMap(bc.BlockId, blockMeta, remoteName)
	if err != nil {
		log.Printf("error resolving env map: %v\n", err)
	}
	for k, v := range envMap {
		token.Env[k] = v
	}
	token.ScriptText = getCustomInitScript(logCtx, blockMeta, remoteName, shellType)
	return token
}

type ConnUnion struct {
	ConnName   string
	ConnType   string
	SshConn    *conncontroller.SSHConn
	WslConn    *wslconn.WslConn
	WshEnabled bool
	ShellPath  string
	ShellOpts  []string
	ShellType  string
}

func getLocalShellPath(blockMeta waveobj.MetaMapType) string {
	shellPath := blockMeta.GetString(waveobj.MetaKey_TermLocalShellPath, "")
	if shellPath != "" {
		return shellPath
	}
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if settings.TermLocalShellPath != "" {
		return settings.TermLocalShellPath
	}
	return shellutil.DetectLocalShellPath()
}

func getLocalShellOpts(blockMeta waveobj.MetaMapType) []string {
	if blockMeta.HasKey(waveobj.MetaKey_TermLocalShellOpts) {
		opts := blockMeta.GetStringList(waveobj.MetaKey_TermLocalShellOpts)
		return append([]string{}, opts...)
	}
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if len(settings.TermLocalShellOpts) > 0 {
		return append([]string{}, settings.TermLocalShellOpts...)
	}
	return nil
}

func (union *ConnUnion) getRemoteInfoAndShellType(blockMeta waveobj.MetaMapType) error {
	if !union.WshEnabled {
		return nil
	}
	if union.ConnType == ConnType_Ssh || union.ConnType == ConnType_Wsl {
		connRoute := wshutil.MakeConnectionRouteId(union.ConnName)
		remoteInfo, err := wshclient.RemoteGetInfoCommand(wshclient.GetBareRpcClient(), &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
		if err != nil {
			// weird error, could flip the wshEnabled flag and allow it to go forward, but the connection should have already been vetted
			return fmt.Errorf("unable to obtain remote info from connserver: %w", err)
		}
		// TODO allow overriding remote shell path
		union.ShellPath = remoteInfo.Shell
	} else {
		union.ShellPath = getLocalShellPath(blockMeta)
	}
	union.ShellType = shellutil.GetShellTypeFromShellPath(union.ShellPath)
	return nil
}

func (bc *BlockController) getConnUnion(logCtx context.Context, remoteName string, blockMeta waveobj.MetaMapType) (ConnUnion, error) {
	rtn := ConnUnion{ConnName: remoteName}
	wshEnabled := !blockMeta.GetBool(waveobj.MetaKey_CmdNoWsh, false)
	if strings.HasPrefix(remoteName, "wsl://") {
		wslName := strings.TrimPrefix(remoteName, "wsl://")
		wslConn := wslconn.GetWslConn(wslName)
		if wslConn == nil {
			return ConnUnion{}, fmt.Errorf("wsl connection not found: %s", remoteName)
		}
		connStatus := wslConn.DeriveConnStatus()
		if connStatus.Status != conncontroller.Status_Connected {
			return ConnUnion{}, fmt.Errorf("wsl connection %s not connected, cannot start shellproc", remoteName)
		}
		rtn.ConnType = ConnType_Wsl
		rtn.WslConn = wslConn
		rtn.WshEnabled = wshEnabled && wslConn.WshEnabled.Load()
	} else if remoteName != "" {
		opts, err := remote.ParseOpts(remoteName)
		if err != nil {
			return ConnUnion{}, fmt.Errorf("invalid ssh remote name (%s): %w", remoteName, err)
		}
		conn := conncontroller.GetConn(opts)
		if conn == nil {
			return ConnUnion{}, fmt.Errorf("ssh connection not found: %s", remoteName)
		}
		connStatus := conn.DeriveConnStatus()
		if connStatus.Status != conncontroller.Status_Connected {
			return ConnUnion{}, fmt.Errorf("ssh connection %s not connected, cannot start shellproc", remoteName)
		}
		rtn.ConnType = ConnType_Ssh
		rtn.SshConn = conn
		rtn.WshEnabled = wshEnabled && conn.WshEnabled.Load()
	} else {
		rtn.ConnType = ConnType_Local
		rtn.WshEnabled = wshEnabled
	}
	err := rtn.getRemoteInfoAndShellType(blockMeta)
	if err != nil {
		return ConnUnion{}, err
	}
	return rtn, nil
}

func (bc *BlockController) setupAndStartShellProcess(logCtx context.Context, rc *RunShellOpts, blockMeta waveobj.MetaMapType) (*shellexec.ShellProc, error) {
	// create a circular blockfile for the output
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	fsErr := filestore.WFS.MakeFile(ctx, bc.BlockId, wavebase.BlockFile_Term, nil, wshrpc.FileOpts{MaxSize: DefaultTermMaxFileSize, Circular: true})
	if fsErr != nil && fsErr != fs.ErrExist {
		return nil, fmt.Errorf("error creating blockfile: %w", fsErr)
	}
	if fsErr == fs.ErrExist {
		// reset the terminal state
		bc.resetTerminalState(logCtx)
	}
	bcInitStatus := bc.GetRuntimeStatus()
	if bcInitStatus.ShellProcStatus == Status_Running {
		return nil, nil
	}
	// TODO better sync here (don't let two starts happen at the same times)
	remoteName := blockMeta.GetString(waveobj.MetaKey_Connection, "")
	connUnion, err := bc.getConnUnion(logCtx, remoteName, blockMeta)
	if err != nil {
		return nil, err
	}
	blocklogger.Infof(logCtx, "[conndebug] remoteName: %q, connType: %s, wshEnabled: %v, shell: %q, shellType: %s\n", remoteName, connUnion.ConnType, connUnion.WshEnabled, connUnion.ShellPath, connUnion.ShellType)
	var cmdStr string
	var cmdOpts shellexec.CommandOptsType
	if bc.ControllerType == BlockController_Shell {
		cmdOpts.Interactive = true
		cmdOpts.Login = true
		cmdOpts.Cwd = blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
		if cmdOpts.Cwd != "" {
			cwdPath, err := wavebase.ExpandHomeDir(cmdOpts.Cwd)
			if err != nil {
				return nil, err
			}
			cmdOpts.Cwd = cwdPath
		}
	} else if bc.ControllerType == BlockController_Cmd {
		var cmdOptsPtr *shellexec.CommandOptsType
		cmdStr, cmdOptsPtr, err = createCmdStrAndOpts(bc.BlockId, blockMeta, remoteName)
		if err != nil {
			return nil, err
		}
		cmdOpts = *cmdOptsPtr
	} else {
		return nil, fmt.Errorf("unknown controller type %q", bc.ControllerType)
	}
	var shellProc *shellexec.ShellProc
	swapToken := bc.makeSwapToken(ctx, logCtx, blockMeta, remoteName, connUnion.ShellType)
	cmdOpts.SwapToken = swapToken
	blocklogger.Debugf(logCtx, "[conndebug] created swaptoken: %s\n", swapToken.Token)
	if connUnion.ConnType == ConnType_Wsl {
		wslConn := connUnion.WslConn
		if !connUnion.WshEnabled {
			shellProc, err = shellexec.StartWslShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, wslConn)
			if err != nil {
				return nil, err
			}
		} else {
			sockName := wslConn.GetDomainSocketName()
			rpcContext := wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId, Conn: wslConn.GetName()}
			jwtStr, err := wshutil.MakeClientJWTToken(rpcContext, sockName)
			if err != nil {
				return nil, fmt.Errorf("error making jwt token: %w", err)
			}
			swapToken.SockName = sockName
			swapToken.RpcContext = &rpcContext
			swapToken.Env[wshutil.WaveJwtTokenVarName] = jwtStr
			shellProc, err = shellexec.StartWslShellProc(ctx, rc.TermSize, cmdStr, cmdOpts, wslConn)
			if err != nil {
				wslConn.SetWshError(err)
				wslConn.WshEnabled.Store(false)
				blocklogger.Infof(logCtx, "[conndebug] error starting wsl shell proc with wsh: %v\n", err)
				blocklogger.Infof(logCtx, "[conndebug] attempting install without wsh\n")
				shellProc, err = shellexec.StartWslShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, wslConn)
				if err != nil {
					return nil, err
				}
			}
		}
	} else if connUnion.ConnType == ConnType_Ssh {
		conn := connUnion.SshConn
		if !connUnion.WshEnabled {
			shellProc, err = shellexec.StartRemoteShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, conn)
			if err != nil {
				return nil, err
			}
		} else {
			sockName := conn.GetDomainSocketName()
			rpcContext := wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId, Conn: conn.Opts.String()}
			jwtStr, err := wshutil.MakeClientJWTToken(rpcContext, sockName)
			if err != nil {
				return nil, fmt.Errorf("error making jwt token: %w", err)
			}
			swapToken.SockName = sockName
			swapToken.RpcContext = &rpcContext
			swapToken.Env[wshutil.WaveJwtTokenVarName] = jwtStr
			shellProc, err = shellexec.StartRemoteShellProc(ctx, logCtx, rc.TermSize, cmdStr, cmdOpts, conn)
			if err != nil {
				conn.SetWshError(err)
				conn.WshEnabled.Store(false)
				blocklogger.Infof(logCtx, "[conndebug] error starting remote shell proc with wsh: %v\n", err)
				blocklogger.Infof(logCtx, "[conndebug] attempting install without wsh\n")
				shellProc, err = shellexec.StartRemoteShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, conn)
				if err != nil {
					return nil, err
				}
			}
		}
	} else if connUnion.ConnType == ConnType_Local {
		if connUnion.WshEnabled {
			sockName := wavebase.GetDomainSocketName()
			rpcContext := wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId}
			jwtStr, err := wshutil.MakeClientJWTToken(rpcContext, sockName)
			if err != nil {
				return nil, fmt.Errorf("error making jwt token: %w", err)
			}
			swapToken.SockName = sockName
			swapToken.RpcContext = &rpcContext
			swapToken.Env[wshutil.WaveJwtTokenVarName] = jwtStr
		}
		cmdOpts.ShellPath = connUnion.ShellPath
		cmdOpts.ShellOpts = getLocalShellOpts(blockMeta)
		shellProc, err = shellexec.StartLocalShellProc(logCtx, rc.TermSize, cmdStr, cmdOpts)
		if err != nil {
			return nil, err
		}
	} else {
		return nil, fmt.Errorf("unknown connection type for conn %q: %s", remoteName, connUnion.ConnType)
	}
	bc.UpdateControllerAndSendUpdate(func() bool {
		bc.ShellProc = shellProc
		bc.ShellProcStatus = Status_Running
		return true
	})
	return shellProc, nil
}

func (bc *BlockController) getBlockData_noErr() *waveobj.Block {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	blockData, err := wstore.DBGet[*waveobj.Block](ctx, bc.BlockId)
	if err != nil {
		log.Printf("error getting block data (getBlockData_noErr): %v\n", err)
		return nil
	}
	return blockData
}

func (bc *BlockController) manageRunningShellProcess(shellProc *shellexec.ShellProc, rc *RunShellOpts, blockMeta waveobj.MetaMapType) error {
	shellInputCh := make(chan *BlockInputUnion, 32)
	bc.ShellInputCh = shellInputCh

	// make esc sequence wshclient wshProxy
	// we don't need to authenticate this wshProxy since it is coming direct
	wshProxy := wshutil.MakeRpcProxy()
	wshProxy.SetRpcContext(&wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId})
	wshutil.DefaultRouter.RegisterRoute(wshutil.MakeControllerRouteId(bc.BlockId), wshProxy, true)
	ptyBuffer := wshutil.MakePtyBuffer(wshutil.WaveOSCPrefix, shellProc.Cmd, wshProxy.FromRemoteCh)
	go func() {
		// handles regular output from the pty (goes to the blockfile and xterm)
		defer func() {
			panichandler.PanicHandler("blockcontroller:shellproc-pty-read-loop", recover())
		}()
		defer func() {
			log.Printf("[shellproc] pty-read loop done\n")
			shellProc.Close()
			bc.WithLock(func() {
				// so no other events are sent
				bc.ShellInputCh = nil
			})
			shellProc.Cmd.Wait()
			exitCode := shellProc.Cmd.ExitCode()
			blockData := bc.getBlockData_noErr()
			if blockData != nil && blockData.Meta.GetString(waveobj.MetaKey_Controller, "") == BlockController_Cmd {
				termMsg := fmt.Sprintf("\r\nprocess finished with exit code = %d\r\n\r\n", exitCode)
				HandleAppendBlockFile(bc.BlockId, wavebase.BlockFile_Term, []byte(termMsg))
			}
			// to stop the inputCh loop
			time.Sleep(100 * time.Millisecond)
			close(shellInputCh) // don't use bc.ShellInputCh (it's nil)
		}()
		buf := make([]byte, 4096)
		for {
			nr, err := ptyBuffer.Read(buf)
			if nr > 0 {
				err := HandleAppendBlockFile(bc.BlockId, wavebase.BlockFile_Term, buf[:nr])
				if err != nil {
					log.Printf("error appending to blockfile: %v\n", err)
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("error reading from shell: %v\n", err)
				break
			}
		}
	}()
	go func() {
		// handles input from the shellInputCh, sent to pty
		// use shellInputCh instead of bc.ShellInputCh (because we want to be attached to *this* ch.  bc.ShellInputCh can be updated)
		defer func() {
			panichandler.PanicHandler("blockcontroller:shellproc-input-loop", recover())
		}()
		for ic := range shellInputCh {
			if len(ic.InputData) > 0 {
				shellProc.Cmd.Write(ic.InputData)
			}
			if ic.TermSize != nil {
				updateTermSize(shellProc, bc.BlockId, *ic.TermSize)
			}
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("blockcontroller:shellproc-output-loop", recover())
		}()
		// handles outputCh -> shellInputCh
		for msg := range wshProxy.ToRemoteCh {
			encodedMsg, err := wshutil.EncodeWaveOSCBytes(wshutil.WaveServerOSC, msg)
			if err != nil {
				log.Printf("error encoding OSC message: %v\n", err)
			}
			shellInputCh <- &BlockInputUnion{InputData: encodedMsg}
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("blockcontroller:shellproc-wait-loop", recover())
		}()
		// wait for the shell to finish
		var exitCode int
		defer func() {
			wshutil.DefaultRouter.UnregisterRoute(wshutil.MakeControllerRouteId(bc.BlockId))
			bc.UpdateControllerAndSendUpdate(func() bool {
				if bc.ShellProcStatus == Status_Running {
					bc.ShellProcStatus = Status_Done
				}
				bc.ShellProcExitCode = exitCode
				return true
			})
			log.Printf("[shellproc] shell process wait loop done\n")
		}()
		waitErr := shellProc.Cmd.Wait()
		exitCode = shellProc.Cmd.ExitCode()
		shellProc.SetWaitErrorAndSignalDone(waitErr)
		go checkCloseOnExit(bc.BlockId, exitCode)
	}()
	return nil
}

func updateTermSize(shellProc *shellexec.ShellProc, blockId string, termSize waveobj.TermSize) {
	err := setTermSizeInDB(blockId, termSize)
	if err != nil {
		log.Printf("error setting pty size: %v\n", err)
	}
	err = shellProc.Cmd.SetSize(termSize.Rows, termSize.Cols)
	if err != nil {
		log.Printf("error setting pty size: %v\n", err)
	}
}

func checkCloseOnExit(blockId string, exitCode int) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		log.Printf("error getting block data: %v\n", err)
		return
	}
	closeOnExit := blockData.Meta.GetBool(waveobj.MetaKey_CmdCloseOnExit, false)
	closeOnExitForce := blockData.Meta.GetBool(waveobj.MetaKey_CmdCloseOnExitForce, false)
	if !closeOnExitForce && !(closeOnExit && exitCode == 0) {
		return
	}
	delayMs := blockData.Meta.GetFloat(waveobj.MetaKey_CmdCloseOnExitDelay, 2000)
	if delayMs < 0 {
		delayMs = 0
	}
	time.Sleep(time.Duration(delayMs) * time.Millisecond)
	rpcClient := wshclient.GetBareRpcClient()
	err = wshclient.DeleteBlockCommand(rpcClient, wshrpc.CommandDeleteBlockData{BlockId: blockId}, nil)
	if err != nil {
		log.Printf("error deleting block data (close on exit): %v\n", err)
	}
}

func getBoolFromMeta(meta map[string]any, key string, def bool) bool {
	ival, found := meta[key]
	if !found || ival == nil {
		return def
	}
	if val, ok := ival.(bool); ok {
		return val
	}
	return def
}

func getTermSize(bdata *waveobj.Block) waveobj.TermSize {
	if bdata.RuntimeOpts != nil {
		return bdata.RuntimeOpts.TermSize
	} else {
		return waveobj.TermSize{
			Rows: 25,
			Cols: 80,
		}
	}
}

func setTermSizeInDB(blockId string, termSize waveobj.TermSize) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	bdata, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block data: %v", err)
	}
	if bdata.RuntimeOpts == nil {
		bdata.RuntimeOpts = &waveobj.RuntimeOpts{}
	}
	bdata.RuntimeOpts.TermSize = termSize
	err = wstore.DBUpdate(ctx, bdata)
	if err != nil {
		return fmt.Errorf("error updating block data: %v", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	wps.Broker.SendUpdateEvents(updates)
	return nil
}

func (bc *BlockController) LockRunLock() bool {
	rtn := bc.RunLock.CompareAndSwap(false, true)
	if rtn {
		log.Printf("block %q run() lock\n", bc.BlockId)
	}
	return rtn
}

func (bc *BlockController) UnlockRunLock() {
	bc.RunLock.Store(false)
	log.Printf("block %q run() unlock\n", bc.BlockId)
}

func (bc *BlockController) run(logCtx context.Context, bdata *waveobj.Block, blockMeta map[string]any, rtOpts *waveobj.RuntimeOpts, force bool) {
	blocklogger.Debugf(logCtx, "[conndebug] BlockController.run() %q\n", bc.BlockId)
	runningShellCommand := false
	ok := bc.LockRunLock()
	if !ok {
		log.Printf("block %q is already executing run()\n", bc.BlockId)
		return
	}
	defer func() {
		if !runningShellCommand {
			bc.UnlockRunLock()
		}
	}()
	curStatus := bc.GetRuntimeStatus()
	controllerName := bdata.Meta.GetString(waveobj.MetaKey_Controller, "")
	if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
		log.Printf("unknown controller %q\n", controllerName)
		return
	}
	runOnce := getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdRunOnce, false)
	runOnStart := getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdRunOnStart, true)
	if ((runOnStart || runOnce) && curStatus.ShellProcStatus == Status_Init) || force {
		if getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdClearOnStart, false) {
			err := HandleTruncateBlockFile(bc.BlockId)
			if err != nil {
				log.Printf("error truncating term blockfile: %v\n", err)
			}
		}
		if runOnce {
			ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancelFn()
			metaUpdate := map[string]any{
				waveobj.MetaKey_CmdRunOnce:    false,
				waveobj.MetaKey_CmdRunOnStart: false,
			}
			err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, bc.BlockId), metaUpdate, false)
			if err != nil {
				log.Printf("error updating block meta (in blockcontroller.run): %v\n", err)
				return
			}
		}
		runningShellCommand = true
		go func() {
			defer func() {
				panichandler.PanicHandler("blockcontroller:run-shell-command", recover())
			}()
			defer bc.UnlockRunLock()
			var termSize waveobj.TermSize
			if rtOpts != nil {
				termSize = rtOpts.TermSize
			} else {
				termSize = getTermSize(bdata)
			}
			err := bc.DoRunShellCommand(logCtx, &RunShellOpts{TermSize: termSize}, bdata.Meta)
			if err != nil {
				debugLog(logCtx, "error running shell: %v\n", err)
			}
		}()
	}
}

func (bc *BlockController) SendInput(inputUnion *BlockInputUnion) error {
	var shellInputCh chan *BlockInputUnion
	bc.WithLock(func() {
		shellInputCh = bc.ShellInputCh
	})
	if shellInputCh == nil {
		return fmt.Errorf("no shell input chan")
	}
	shellInputCh <- inputUnion
	return nil
}

func CheckConnStatus(blockId string) error {
	bdata, err := wstore.DBMustGet[*waveobj.Block](context.Background(), blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	connName := bdata.Meta.GetString(waveobj.MetaKey_Connection, "")
	if connName == "" {
		return nil
	}
	if strings.HasPrefix(connName, "wsl://") {
		distroName := strings.TrimPrefix(connName, "wsl://")
		conn := wslconn.GetWslConn(distroName)
		connStatus := conn.DeriveConnStatus()
		if connStatus.Status != conncontroller.Status_Connected {
			return fmt.Errorf("not connected: %s", connStatus.Status)
		}
		return nil
	}
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.GetConn(opts)
	connStatus := conn.DeriveConnStatus()
	if connStatus.Status != conncontroller.Status_Connected {
		return fmt.Errorf("not connected: %s", connStatus.Status)
	}
	return nil
}

func (bc *BlockController) StopShellProc(shouldWait bool) {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	if bc.ShellProc == nil || bc.ShellProcStatus == Status_Done || bc.ShellProcStatus == Status_Init {
		return
	}
	bc.ShellProc.Close()
	if shouldWait {
		doneCh := bc.ShellProc.DoneCh
		<-doneCh
	}
}

func getOrCreateBlockController(tabId string, blockId string, controllerName string) *BlockController {
	var createdController bool
	var bc *BlockController
	defer func() {
		if !createdController || bc == nil {
			return
		}
		bc.UpdateControllerAndSendUpdate(func() bool {
			return true
		})
	}()
	globalLock.Lock()
	defer globalLock.Unlock()
	bc = blockControllerMap[blockId]
	if bc == nil {
		bc = &BlockController{
			Lock:            &sync.Mutex{},
			ControllerType:  controllerName,
			TabId:           tabId,
			BlockId:         blockId,
			ShellProcStatus: Status_Init,
			RunLock:         &atomic.Bool{},
		}
		blockControllerMap[blockId] = bc
		createdController = true
	}
	return bc
}

func formatConnNameForLog(connName string) string {
	if connName == "" {
		return "local"
	}
	return connName
}

func ResyncController(ctx context.Context, tabId string, blockId string, rtOpts *waveobj.RuntimeOpts, force bool) error {
	if tabId == "" || blockId == "" {
		return fmt.Errorf("invalid tabId or blockId passed to ResyncController")
	}
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	if force {
		StopBlockController(blockId)
		time.Sleep(100 * time.Millisecond) // TODO see if we can remove this (the "process finished with exit code" message comes out after we start reconnecting otherwise)
	}
	connName := blockData.Meta.GetString(waveobj.MetaKey_Connection, "")
	controllerName := blockData.Meta.GetString(waveobj.MetaKey_Controller, "")
	curBc := GetBlockController(blockId)
	if controllerName == "" {
		if curBc != nil {
			StopBlockController(blockId)
		}
		return nil
	}
	log.Printf("resync controller %s %q (%q) (force %v)\n", blockId, controllerName, connName, force)
	// check if conn is different, if so, stop the current controller, and set status back to init
	if curBc != nil {
		bcStatus := curBc.GetRuntimeStatus()
		if bcStatus.ShellProcStatus == Status_Running && bcStatus.ShellProcConnName != connName {
			blocklogger.Infof(ctx, "\n[conndebug] stopping blockcontroller due to conn change %q => %q\n", formatConnNameForLog(bcStatus.ShellProcConnName), formatConnNameForLog(connName))
			log.Printf("stopping blockcontroller %s due to conn change\n", blockId)
			StopBlockControllerAndSetStatus(blockId, Status_Init)
			time.Sleep(100 * time.Millisecond) // TODO see if we can remove this (the "process finished with exit code" message comes out after we start reconnecting otherwise)
		}
	}
	// now if there is a conn, ensure it is connected
	if connName != "" {
		err = CheckConnStatus(blockId)
		if err != nil {
			return fmt.Errorf("cannot start shellproc: %w", err)
		}
	}
	if curBc == nil {
		return startBlockController(ctx, tabId, blockId, rtOpts, force)
	}
	bcStatus := curBc.GetRuntimeStatus()
	if bcStatus.ShellProcStatus == Status_Init || bcStatus.ShellProcStatus == Status_Done {
		return startBlockController(ctx, tabId, blockId, rtOpts, force)
	}
	return nil
}

func debugLog(ctx context.Context, fmtStr string, args ...interface{}) {
	blocklogger.Infof(ctx, "[conndebug] "+fmtStr, args...)
	log.Printf(fmtStr, args...)
}

func startBlockController(ctx context.Context, tabId string, blockId string, rtOpts *waveobj.RuntimeOpts, force bool) error {
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	controllerName := blockData.Meta.GetString(waveobj.MetaKey_Controller, "")
	if controllerName == "" {
		// nothing to start
		return nil
	}
	if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
		return fmt.Errorf("unknown controller %q", controllerName)
	}
	connName := blockData.Meta.GetString(waveobj.MetaKey_Connection, "")
	err = CheckConnStatus(blockId)
	if err != nil {
		return fmt.Errorf("cannot start shellproc: %w", err)
	}
	bc := getOrCreateBlockController(tabId, blockId, controllerName)
	bcStatus := bc.GetRuntimeStatus()
	debugLog(ctx, "start blockcontroller %s %q (%q) (curstatus %s) (force %v)\n", blockId, controllerName, connName, bcStatus.ShellProcStatus, force)
	if bcStatus.ShellProcStatus == Status_Init || bcStatus.ShellProcStatus == Status_Done {
		go bc.run(ctx, blockData, blockData.Meta, rtOpts, force)
	}
	return nil
}

func StopBlockControllerAndSetStatus(blockId string, newStatus string) {
	bc := GetBlockController(blockId)
	if bc == nil {
		return
	}
	if bc.getShellProc() != nil {
		bc.ShellProc.Close()
		<-bc.ShellProc.DoneCh
		bc.UpdateControllerAndSendUpdate(func() bool {
			bc.ShellProcStatus = newStatus
			return true
		})
	}

}

func StopBlockController(blockId string) {
	StopBlockControllerAndSetStatus(blockId, Status_Done)
}

func getControllerList() []*BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	var rtn []*BlockController
	for _, bc := range blockControllerMap {
		rtn = append(rtn, bc)
	}
	return rtn
}

func StopAllBlockControllers() {
	clist := getControllerList()
	for _, bc := range clist {
		if bc.ShellProcStatus == Status_Running {
			go StopBlockController(bc.BlockId)
		}
	}
}

func GetBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockControllerMap[blockId]
}
