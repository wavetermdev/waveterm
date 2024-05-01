// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alessio/shellescape"
	"github.com/armon/circbuf"
	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/server"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellapi"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellenv"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shexec"
	"github.com/wavetermdev/waveterm/waveshell/pkg/statediff"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/ephemeral"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/telemetry"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/userinput"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/waveenc"

	"golang.org/x/crypto/ssh"
	"golang.org/x/mod/semver"
)

const RemoteTypeWaveshell = "mshell"
const DefaultTerm = "xterm-256color"
const DefaultMaxPtySize = 1024 * 1024
const CircBufSize = 64 * 1024
const RemoteTermRows = 8
const RemoteTermCols = 80
const PtyReadBufSize = 100
const RemoteConnectTimeout = 15 * time.Second
const RpcIterChannelSize = 100
const MaxInputDataSize = 1000
const SudoTimeoutTime = 5 * time.Minute

var envVarsToStrip map[string]bool = map[string]bool{
	"PROMPT":               true,
	"PROMPT_VERSION":       true,
	"MSHELL":               true,
	"MSHELL_VERSION":       true,
	"WAVETERM":             true,
	"WAVETERM_VERSION":     true,
	"TERM_PROGRAM":         true,
	"TERM_PROGRAM_VERSION": true,
	"TERM_SESSION_ID":      true,
}

// we add this ping packet to the WaveshellServer Commands in order to deal with spurious SSH output
// basically we guarantee the parser will see a valid packet (either an init error or a ping)
// so we can pass ignoreUntilValid to PacketParser
const PrintPingPacket = `printf "\n##N{\"type\": \"ping\"}\n"`

const WaveshellServerCommandFmt = `
PATH=$PATH:~/.mshell;
which mshell-[%VERSION%] > /dev/null;
if [[ "$?" -ne 0 ]]
then
  printf "\n##N{\"type\": \"init\", \"notfound\": true, \"uname\": \"%s | %s\"}\n" "$(uname -s)" "$(uname -m)"
else
  [%PINGPACKET%]
  mshell-[%VERSION%] --server
fi
`

func MakeLocalWaveshellCommandStr(isSudo bool) (string, error) {
	waveshellPath, err := scbase.LocalWaveshellBinaryPath()
	if err != nil {
		return "", err
	}
	if isSudo {
		return fmt.Sprintf(`%s; sudo %s --server`, PrintPingPacket, shellescape.Quote(waveshellPath)), nil
	} else {
		return fmt.Sprintf(`%s; %s --server`, PrintPingPacket, shellescape.Quote(waveshellPath)), nil
	}
}

func MakeServerCommandStr() string {
	rtn := strings.ReplaceAll(WaveshellServerCommandFmt, "[%VERSION%]", semver.MajorMinor(scbase.WaveshellVersion))
	rtn = strings.ReplaceAll(rtn, "[%PINGPACKET%]", PrintPingPacket)
	return rtn
}

const (
	StatusConnected    = sstore.RemoteStatus_Connected
	StatusConnecting   = sstore.RemoteStatus_Connecting
	StatusDisconnected = sstore.RemoteStatus_Disconnected
	StatusError        = sstore.RemoteStatus_Error
)

func init() {
	if scbase.WaveshellVersion != base.WaveshellVersion {
		panic(fmt.Sprintf("prompt-server apishell version must match '%s' vs '%s'", scbase.WaveshellVersion, base.WaveshellVersion))
	}
}

var GlobalStore *Store

type Store struct {
	Lock       *sync.Mutex
	Map        map[string]*WaveshellProc // key=remoteid
	CmdWaitMap map[base.CommandKey][]func()
}

type pendingStateKey struct {
	ScreenId  string
	RemotePtr sstore.RemotePtrType
}

// provides state, acccess, and control for a waveshell server process
type WaveshellProc struct {
	Lock   *sync.Mutex
	Remote *sstore.RemoteType

	// runtime
	RemoteId           string // can be read without a lock
	Status             string
	ServerProc         *shexec.ClientProc // the server process
	UName              string
	Err                error
	ErrNoInitPk        bool
	ControllingPty     *os.File
	PtyBuffer          *circbuf.Buffer
	MakeClientCancelFn context.CancelFunc
	MakeClientDeadline *time.Time
	StateMap           *server.ShellStateMap
	NumTryConnect      int
	InitPkShellType    string
	DataPosMap         *utilfn.SyncMap[base.CommandKey, int64]

	// install
	InstallStatus         string
	NeedsWaveshellUpgrade bool
	InstallCancelFn       context.CancelFunc
	InstallErr            error

	// for synthetic commands (not run through RunCommand), this provides a way for them
	// to register to receive input events from the frontend (e.g. ReInit)
	CommandInputMap map[base.CommandKey]CommandInputSink

	RunningCmds      map[base.CommandKey]*RunCmdType
	PendingStateCmds map[pendingStateKey]base.CommandKey // key=[remoteinstance name] (in progress commands that might update the state)

	Client            *ssh.Client
	sudoPw            []byte
	sudoClearDeadline int64
}

type CommandInputSink interface {
	HandleInput(feInput *scpacket.FeInputPacketType) error
}

type RunCmdType struct {
	CK            base.CommandKey
	SessionId     string
	ScreenId      string
	RemotePtr     sstore.RemotePtrType
	RunPacket     *packet.RunPacketType
	EphemeralOpts *ephemeral.EphemeralRunOpts
}

type ReinitCommandSink struct {
	Remote *WaveshellProc
	ReqId  string
}

func (rcs *ReinitCommandSink) HandleInput(feInput *scpacket.FeInputPacketType) error {
	realData, err := base64.StdEncoding.DecodeString(feInput.InputData64)
	if err != nil {
		return fmt.Errorf("error decoding input data: %v", err)
	}
	inputPk := packet.MakeRpcInputPacket(rcs.ReqId)
	inputPk.Data = realData
	rcs.Remote.ServerProc.Input.SendPacket(inputPk)
	return nil
}

type RemoteRuntimeState = sstore.RemoteRuntimeState

func CanComplete(remoteType string) bool {
	switch remoteType {
	case sstore.RemoteTypeSsh:
		return true
	default:
		return false
	}
}

func (wsh *WaveshellProc) GetStatus() string {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.Status
}

func (wsh *WaveshellProc) GetRemoteId() string {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.Remote.RemoteId
}

func (wsh *WaveshellProc) GetInstallStatus() string {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.InstallStatus
}

func LoadRemotes(ctx context.Context) error {
	GlobalStore = &Store{
		Lock:       &sync.Mutex{},
		Map:        make(map[string]*WaveshellProc),
		CmdWaitMap: make(map[base.CommandKey][]func()),
	}
	allRemotes, err := sstore.GetAllRemotes(ctx)
	if err != nil {
		return err
	}
	var numLocal int
	var numSudoLocal int
	for _, remote := range allRemotes {
		wsh := MakeWaveshell(remote)
		GlobalStore.Map[remote.RemoteId] = wsh
		if remote.ConnectMode == sstore.ConnectModeStartup {
			go wsh.Launch(false)
		}
		if remote.Local {
			if remote.IsSudo() {
				numSudoLocal++
			} else {
				numLocal++
			}
		}
	}
	if numLocal == 0 {
		return fmt.Errorf("no local remote found")
	}
	if numLocal > 1 {
		return fmt.Errorf("multiple local remotes found")
	}
	if numSudoLocal > 1 {
		return fmt.Errorf("multiple local sudo remotes found")
	}
	return nil
}

func LoadRemoteById(ctx context.Context, remoteId string) error {
	r, err := sstore.GetRemoteById(ctx, remoteId)
	if err != nil {
		return err
	}
	if r == nil {
		return fmt.Errorf("remote %s not found", remoteId)
	}
	wsh := MakeWaveshell(r)
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	existingRemote := GlobalStore.Map[remoteId]
	if existingRemote != nil {
		return fmt.Errorf("cannot add remote %s, already in global map", remoteId)
	}
	GlobalStore.Map[r.RemoteId] = wsh
	if r.ConnectMode == sstore.ConnectModeStartup {
		go wsh.Launch(false)
	}
	return nil
}

func ReadRemotePty(ctx context.Context, remoteId string) (int64, []byte, error) {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	wsh := GlobalStore.Map[remoteId]
	if wsh == nil {
		return 0, nil, nil
	}
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	barr := wsh.PtyBuffer.Bytes()
	offset := wsh.PtyBuffer.TotalWritten() - int64(len(barr))
	return offset, barr, nil
}

func AddRemote(ctx context.Context, r *sstore.RemoteType, shouldStart bool) error {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	existingRemote := getRemoteByCanonicalName_nolock(r.RemoteCanonicalName)
	if existingRemote != nil {
		erCopy := existingRemote.GetRemoteCopy()
		if !erCopy.Archived {
			return fmt.Errorf("duplicate canonical name %q: cannot create new remote", r.RemoteCanonicalName)
		}
		r.RemoteId = erCopy.RemoteId
	}
	if r.Local {
		return fmt.Errorf("cannot create another local remote (there can be only one)")
	}

	err := sstore.UpsertRemote(ctx, r)
	if err != nil {
		return fmt.Errorf("cannot create remote %q: %v", r.RemoteCanonicalName, err)
	}
	newWsh := MakeWaveshell(r)
	GlobalStore.Map[r.RemoteId] = newWsh
	go newWsh.NotifyRemoteUpdate()
	if shouldStart {
		go newWsh.Launch(true)
	}
	return nil
}

func ArchiveRemote(ctx context.Context, remoteId string) error {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	wsh := GlobalStore.Map[remoteId]
	if wsh == nil {
		return fmt.Errorf("remote not found, cannot archive")
	}
	if wsh.Status == StatusConnected {
		return fmt.Errorf("cannot archive connected remote")
	}
	if wsh.Remote.Local {
		return fmt.Errorf("cannot archive local remote")
	}
	rcopy := wsh.GetRemoteCopy()
	archivedRemote := &sstore.RemoteType{
		RemoteId:            rcopy.RemoteId,
		RemoteType:          rcopy.RemoteType,
		RemoteCanonicalName: rcopy.RemoteCanonicalName,
		ConnectMode:         sstore.ConnectModeManual,
		Archived:            true,
		SSHConfigSrc:        rcopy.SSHConfigSrc,
	}
	err := sstore.UpsertRemote(ctx, archivedRemote)
	if err != nil {
		return err
	}
	newWsh := MakeWaveshell(archivedRemote)
	GlobalStore.Map[remoteId] = newWsh
	go newWsh.NotifyRemoteUpdate()
	return nil
}

var partialUUIDRe = regexp.MustCompile("^[0-9a-f]{8}$")

func isPartialUUID(s string) bool {
	return partialUUIDRe.MatchString(s)
}

func NumRemotes() int {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	return len(GlobalStore.Map)
}

func GetRemoteByArg(arg string) *WaveshellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	isPuid := isPartialUUID(arg)
	for _, wsh := range GlobalStore.Map {
		rcopy := wsh.GetRemoteCopy()
		if rcopy.RemoteAlias == arg || rcopy.RemoteCanonicalName == arg || rcopy.RemoteId == arg {
			return wsh
		}
		if isPuid && strings.HasPrefix(rcopy.RemoteId, arg) {
			return wsh
		}
	}
	return nil
}

func getRemoteByCanonicalName_nolock(name string) *WaveshellProc {
	for _, wsh := range GlobalStore.Map {
		rcopy := wsh.GetRemoteCopy()
		if rcopy.RemoteCanonicalName == name {
			return wsh
		}
	}
	return nil
}

func GetRemoteById(remoteId string) *WaveshellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	return GlobalStore.Map[remoteId]
}

func GetRemoteCopyById(remoteId string) *sstore.RemoteType {
	wsh := GetRemoteById(remoteId)
	if wsh == nil {
		return nil
	}
	rcopy := wsh.GetRemoteCopy()
	return &rcopy
}

func GetRemoteMap() map[string]*WaveshellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	rtn := make(map[string]*WaveshellProc)
	for remoteId, wsh := range GlobalStore.Map {
		rtn[remoteId] = wsh
	}
	return rtn
}

func GetLocalRemote() *WaveshellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	for _, wsh := range GlobalStore.Map {
		if wsh.IsLocal() && !wsh.IsSudo() {
			return wsh
		}
	}
	return nil
}

func ResolveRemoteRef(remoteRef string) *RemoteRuntimeState {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	_, err := uuid.Parse(remoteRef)
	if err == nil {
		wsh := GlobalStore.Map[remoteRef]
		if wsh != nil {
			state := wsh.GetRemoteRuntimeState()
			return &state
		}
		return nil
	}
	for _, wsh := range GlobalStore.Map {
		if wsh.Remote.RemoteAlias == remoteRef || wsh.Remote.RemoteCanonicalName == remoteRef {
			state := wsh.GetRemoteRuntimeState()
			return &state
		}
	}
	return nil
}

func SendSignalToCmd(ctx context.Context, cmd *sstore.CmdType, sig string) error {
	wsh := GetRemoteById(cmd.Remote.RemoteId)
	if wsh == nil {
		return fmt.Errorf("no connection found")
	}
	if !wsh.IsConnected() {
		return fmt.Errorf("not connected")
	}
	cmdCk := base.MakeCommandKey(cmd.ScreenId, cmd.LineId)
	if !wsh.IsCmdRunning(cmdCk) {
		// this could also return nil (depends on use case)
		// settled on coded error so we can check for this error
		return base.CodedErrorf(packet.EC_CmdNotRunning, "cmd not running")
	}
	sigPk := packet.MakeSpecialInputPacket()
	sigPk.CK = cmdCk
	sigPk.SigName = sig
	return wsh.ServerProc.Input.SendPacket(sigPk)
}

func unquoteDQBashString(str string) (string, bool) {
	if len(str) < 2 {
		return str, false
	}
	if str[0] != '"' || str[len(str)-1] != '"' {
		return str, false
	}
	rtn := make([]byte, 0, len(str)-2)
	for idx := 1; idx < len(str)-1; idx++ {
		ch := str[idx]
		if ch == '"' {
			return str, false
		}
		if ch == '\\' {
			if idx == len(str)-2 {
				return str, false
			}
			nextCh := str[idx+1]
			if nextCh == '\n' {
				idx++
				continue
			}
			if nextCh == '$' || nextCh == '"' || nextCh == '\\' || nextCh == '`' {
				idx++
				rtn = append(rtn, nextCh)
				continue
			}
			rtn = append(rtn, '\\')
			continue
		} else {
			rtn = append(rtn, ch)
		}
	}
	return string(rtn), true
}

func makeShortHost(host string) string {
	dotIdx := strings.Index(host, ".")
	if dotIdx == -1 {
		return host
	}
	return host[0:dotIdx]
}

func (wsh *WaveshellProc) IsLocal() bool {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.Remote.Local
}

func (wsh *WaveshellProc) IsSudo() bool {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.Remote.IsSudo()
}

func (wsh *WaveshellProc) tryAutoInstall() {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	if !wsh.Remote.AutoInstall || !wsh.NeedsWaveshellUpgrade || wsh.InstallErr != nil {
		return
	}
	wsh.writeToPtyBuffer_nolock("trying auto-install\n")
	go wsh.RunInstall(true)
}

// if wsh.IsConnected() then GetShellPref() should return a valid shell
// if wsh is not connected, then InitPkShellType might be empty
func (wsh *WaveshellProc) GetShellPref() string {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	if wsh.Remote.ShellPref == sstore.ShellTypePref_Detect {
		return wsh.InitPkShellType
	}
	if wsh.Remote.ShellPref == "" {
		return packet.ShellType_bash
	}
	return wsh.Remote.ShellPref
}

func (wsh *WaveshellProc) GetRemoteRuntimeState() RemoteRuntimeState {
	shellPref := wsh.GetShellPref()
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	state := RemoteRuntimeState{
		RemoteType:          wsh.Remote.RemoteType,
		RemoteId:            wsh.Remote.RemoteId,
		RemoteAlias:         wsh.Remote.RemoteAlias,
		RemoteCanonicalName: wsh.Remote.RemoteCanonicalName,
		Status:              wsh.Status,
		ConnectMode:         wsh.Remote.ConnectMode,
		AutoInstall:         wsh.Remote.AutoInstall,
		Archived:            wsh.Remote.Archived,
		RemoteIdx:           wsh.Remote.RemoteIdx,
		SSHConfigSrc:        wsh.Remote.SSHConfigSrc,
		UName:               wsh.UName,
		InstallStatus:       wsh.InstallStatus,
		NeedsMShellUpgrade:  wsh.NeedsWaveshellUpgrade,
		Local:               wsh.Remote.Local,
		IsSudo:              wsh.Remote.IsSudo(),
		NoInitPk:            wsh.ErrNoInitPk,
		AuthType:            sstore.RemoteAuthTypeNone,
		ShellPref:           wsh.Remote.ShellPref,
		DefaultShellType:    shellPref,
	}
	if wsh.Remote.SSHOpts != nil {
		state.AuthType = wsh.Remote.SSHOpts.GetAuthType()
	}
	if wsh.Remote.RemoteOpts != nil {
		optsCopy := *wsh.Remote.RemoteOpts
		state.RemoteOpts = &optsCopy
	}
	if wsh.Err != nil {
		state.ErrorStr = wsh.Err.Error()
	}
	if wsh.InstallErr != nil {
		state.InstallErrorStr = wsh.InstallErr.Error()
	}
	if wsh.Status == StatusConnecting {
		state.WaitingForPassword = wsh.isWaitingForPassword_nolock()
		if wsh.MakeClientDeadline != nil {
			state.ConnectTimeout = int(time.Until(*wsh.MakeClientDeadline) / time.Second)
			if state.ConnectTimeout < 0 {
				state.ConnectTimeout = 0
			}
			state.CountdownActive = true
		} else {
			state.CountdownActive = false
		}
	}
	vars := wsh.Remote.StateVars
	if vars == nil {
		vars = make(map[string]string)
	}
	vars["user"] = wsh.Remote.RemoteUser
	vars["bestuser"] = vars["user"]
	vars["host"] = wsh.Remote.RemoteHost
	vars["shorthost"] = makeShortHost(wsh.Remote.RemoteHost)
	vars["alias"] = wsh.Remote.RemoteAlias
	vars["cname"] = wsh.Remote.RemoteCanonicalName
	vars["remoteid"] = wsh.Remote.RemoteId
	vars["status"] = wsh.Status
	vars["type"] = wsh.Remote.RemoteType
	if wsh.Remote.IsSudo() {
		vars["sudo"] = "1"
	}
	if wsh.Remote.Local {
		vars["local"] = "1"
	}
	vars["port"] = "22"
	if wsh.Remote.SSHOpts != nil {
		if wsh.Remote.SSHOpts.SSHPort != 0 {
			vars["port"] = strconv.Itoa(wsh.Remote.SSHOpts.SSHPort)
		}
	}
	if wsh.Remote.RemoteOpts != nil && wsh.Remote.RemoteOpts.Color != "" {
		vars["color"] = wsh.Remote.RemoteOpts.Color
	}
	if wsh.ServerProc != nil && wsh.ServerProc.InitPk != nil {
		initPk := wsh.ServerProc.InitPk
		if initPk.BuildTime == "" || initPk.BuildTime == "0" {
			state.MShellVersion = initPk.Version
		} else {
			state.MShellVersion = fmt.Sprintf("%s+%s", initPk.Version, initPk.BuildTime)
		}
		vars["home"] = initPk.HomeDir
		vars["remoteuser"] = initPk.User
		vars["bestuser"] = vars["remoteuser"]
		vars["remotehost"] = initPk.HostName
		vars["remoteshorthost"] = makeShortHost(initPk.HostName)
		vars["besthost"] = vars["remotehost"]
		vars["bestshorthost"] = vars["remoteshorthost"]
	}
	if wsh.Remote.Local && wsh.Remote.IsSudo() {
		vars["bestuser"] = "sudo"
	} else if wsh.Remote.IsSudo() {
		vars["bestuser"] = "sudo@" + vars["bestuser"]
	}
	if wsh.Remote.Local {
		vars["bestname"] = vars["bestuser"] + "@local"
		vars["bestshortname"] = vars["bestuser"] + "@local"
	} else {
		vars["bestname"] = vars["bestuser"] + "@" + vars["besthost"]
		vars["bestshortname"] = vars["bestuser"] + "@" + vars["bestshorthost"]
	}
	if vars["remoteuser"] == "root" || vars["sudo"] == "1" {
		vars["isroot"] = "1"
	}
	varsCopy := make(map[string]string)
	// deep copy so that concurrent calls don't collide on this data
	for key, value := range vars {
		varsCopy[key] = value
	}
	state.RemoteVars = varsCopy
	return state
}

func (wsh *WaveshellProc) NotifyRemoteUpdate() {
	rstate := wsh.GetRemoteRuntimeState()
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(rstate)
	scbus.MainUpdateBus.DoUpdate(update)
}

func GetAllRemoteRuntimeState() []*RemoteRuntimeState {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	var rtn []*RemoteRuntimeState
	for _, proc := range GlobalStore.Map {
		state := proc.GetRemoteRuntimeState()
		rtn = append(rtn, &state)
	}
	return rtn
}

func MakeWaveshell(r *sstore.RemoteType) *WaveshellProc {
	buf, err := circbuf.NewBuffer(CircBufSize)
	if err != nil {
		panic(err) // this should never happen (NewBuffer only returns an error if CirBufSize <= 0)
	}
	rtn := &WaveshellProc{
		Lock:             &sync.Mutex{},
		Remote:           r,
		RemoteId:         r.RemoteId,
		Status:           StatusDisconnected,
		PtyBuffer:        buf,
		InstallStatus:    StatusDisconnected,
		CommandInputMap:  make(map[base.CommandKey]CommandInputSink),
		RunningCmds:      make(map[base.CommandKey]*RunCmdType),
		PendingStateCmds: make(map[pendingStateKey]base.CommandKey),
		StateMap:         server.MakeShellStateMap(),
		DataPosMap:       utilfn.MakeSyncMap[base.CommandKey, int64](),
	}

	rtn.WriteToPtyBuffer("console for connection [%s]\n", r.GetName())
	return rtn
}

func SendRemoteInput(pk *scpacket.RemoteInputPacketType) error {
	data, err := base64.StdEncoding.DecodeString(pk.InputData64)
	if err != nil {
		return fmt.Errorf("cannot decode base64: %v", err)
	}
	wsh := GetRemoteById(pk.RemoteId)
	if wsh == nil {
		return fmt.Errorf("remote not found")
	}
	var cmdPty *os.File
	wsh.WithLock(func() {
		cmdPty = wsh.ControllingPty
	})
	if cmdPty == nil {
		return fmt.Errorf("remote has no attached pty")
	}
	_, err = cmdPty.Write(data)
	if err != nil {
		return fmt.Errorf("writing to pty: %v", err)
	}
	wsh.resetClientDeadline()
	return nil
}

func (wsh *WaveshellProc) getClientDeadline() *time.Time {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.MakeClientDeadline
}

func (wsh *WaveshellProc) resetClientDeadline() {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	if wsh.Status != StatusConnecting {
		return
	}
	deadline := wsh.MakeClientDeadline
	if deadline == nil {
		return
	}
	newDeadline := time.Now().Add(RemoteConnectTimeout)
	wsh.MakeClientDeadline = &newDeadline
}

func (wsh *WaveshellProc) watchClientDeadlineTime() {
	for {
		time.Sleep(1 * time.Second)
		status := wsh.GetStatus()
		if status != StatusConnecting {
			break
		}
		deadline := wsh.getClientDeadline()
		if deadline == nil {
			break
		}
		if time.Now().After(*deadline) {
			wsh.Disconnect(false)
			break
		}
		go wsh.NotifyRemoteUpdate()
	}
}

func convertSSHOpts(opts *sstore.SSHOpts) shexec.SSHOpts {
	if opts == nil || opts.Local {
		opts = &sstore.SSHOpts{}
	}
	return shexec.SSHOpts{
		SSHHost:     opts.SSHHost,
		SSHOptsStr:  opts.SSHOptsStr,
		SSHIdentity: opts.SSHIdentity,
		SSHUser:     opts.SSHUser,
		SSHPort:     opts.SSHPort,
	}
}

func (wsh *WaveshellProc) addControllingTty(ecmd *exec.Cmd) (*os.File, error) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()

	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, err
	}
	pty.Setsize(cmdPty, &pty.Winsize{Rows: RemoteTermRows, Cols: RemoteTermCols})
	wsh.ControllingPty = cmdPty
	ecmd.ExtraFiles = append(ecmd.ExtraFiles, cmdTty)
	if ecmd.SysProcAttr == nil {
		ecmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	ecmd.SysProcAttr.Setsid = true
	ecmd.SysProcAttr.Setctty = true
	ecmd.SysProcAttr.Ctty = len(ecmd.ExtraFiles) + 3 - 1
	return cmdPty, nil
}

func (wsh *WaveshellProc) setErrorStatus(err error) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	wsh.Status = StatusError
	wsh.Err = err
	go wsh.NotifyRemoteUpdate()
}

func (wsh *WaveshellProc) setInstallErrorStatus(err error) {
	wsh.WriteToPtyBuffer("*error, %s\n", err.Error())
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	wsh.InstallStatus = StatusError
	wsh.InstallErr = err
	go wsh.NotifyRemoteUpdate()
}

func (wsh *WaveshellProc) GetRemoteCopy() sstore.RemoteType {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return *wsh.Remote
}

func (wsh *WaveshellProc) GetUName() string {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.UName
}

func (wsh *WaveshellProc) GetNumRunningCommands() int {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return len(wsh.RunningCmds)
}

func (wsh *WaveshellProc) UpdateRemote(ctx context.Context, editMap map[string]interface{}) error {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	updatedRemote, err := sstore.UpdateRemote(ctx, wsh.Remote.RemoteId, editMap)
	if err != nil {
		return err
	}
	if updatedRemote == nil {
		return fmt.Errorf("no remote returned from UpdateRemote")
	}
	wsh.Remote = updatedRemote
	go wsh.NotifyRemoteUpdate()
	return nil
}

func (wsh *WaveshellProc) Disconnect(force bool) {
	status := wsh.GetStatus()
	if status != StatusConnected && status != StatusConnecting {
		wsh.WriteToPtyBuffer("remote already disconnected (no action taken)\n")
		return
	}
	numCommands := wsh.GetNumRunningCommands()
	if numCommands > 0 && !force {
		wsh.WriteToPtyBuffer("remote not disconnected, has %d running commands.  use force=1 to force disconnection\n", numCommands)
		return
	}
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	if wsh.ServerProc != nil {
		wsh.ServerProc.Close()
		wsh.Client = nil
	}
	if wsh.MakeClientCancelFn != nil {
		wsh.MakeClientCancelFn()
		wsh.MakeClientCancelFn = nil
	}
}

func (wsh *WaveshellProc) CancelInstall() {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	if wsh.InstallCancelFn != nil {
		wsh.InstallCancelFn()
		wsh.InstallCancelFn = nil
	}
}

func (wsh *WaveshellProc) GetRemoteName() string {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.Remote.GetName()
}

func (wsh *WaveshellProc) WriteToPtyBuffer(strFmt string, args ...interface{}) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	wsh.writeToPtyBuffer_nolock(strFmt, args...)
}

func (wsh *WaveshellProc) writeToPtyBuffer_nolock(strFmt string, args ...interface{}) {
	// inefficient string manipulation here and read of PtyBuffer, but these messages are rare, nbd
	realStr := fmt.Sprintf(strFmt, args...)
	if !strings.HasPrefix(realStr, "~") {
		realStr = strings.ReplaceAll(realStr, "\n", "\r\n")
		if !strings.HasSuffix(realStr, "\r\n") {
			realStr = realStr + "\r\n"
		}
		if strings.HasPrefix(realStr, "*") {
			realStr = "\033[0m\033[31mwave>\033[0m " + realStr[1:]
		} else {
			realStr = "\033[0m\033[32mwave>\033[0m " + realStr
		}
		barr := wsh.PtyBuffer.Bytes()
		if len(barr) > 0 && barr[len(barr)-1] != '\n' {
			realStr = "\r\n" + realStr
		}
	} else {
		realStr = realStr[1:]
	}
	curOffset := wsh.PtyBuffer.TotalWritten()
	data := []byte(realStr)
	wsh.PtyBuffer.Write(data)
	sendRemotePtyUpdate(wsh.Remote.RemoteId, curOffset, data)
}

func sendRemotePtyUpdate(remoteId string, dataOffset int64, data []byte) {
	data64 := base64.StdEncoding.EncodeToString(data)
	update := scbus.MakePtyDataUpdate(&scbus.PtyDataUpdate{
		RemoteId:   remoteId,
		PtyPos:     dataOffset,
		PtyData64:  data64,
		PtyDataLen: int64(len(data)),
	})
	scbus.MainUpdateBus.DoUpdate(update)
}

func (wsh *WaveshellProc) isWaitingForPassword_nolock() bool {
	barr := wsh.PtyBuffer.Bytes()
	if len(barr) == 0 {
		return false
	}
	nlIdx := bytes.LastIndex(barr, []byte{'\n'})
	var lastLine string
	if nlIdx == -1 {
		lastLine = string(barr)
	} else {
		lastLine = string(barr[nlIdx+1:])
	}
	pwIdx := strings.Index(lastLine, "assword")
	return pwIdx != -1
}

func (wsh *WaveshellProc) isWaitingForPassphrase_nolock() bool {
	barr := wsh.PtyBuffer.Bytes()
	if len(barr) == 0 {
		return false
	}
	nlIdx := bytes.LastIndex(barr, []byte{'\n'})
	var lastLine string
	if nlIdx == -1 {
		lastLine = string(barr)
	} else {
		lastLine = string(barr[nlIdx+1:])
	}
	pwIdx := strings.Index(lastLine, "Enter passphrase for key")
	return pwIdx != -1
}

func (wsh *WaveshellProc) RunPasswordReadLoop(cmdPty *os.File) {
	buf := make([]byte, PtyReadBufSize)
	for {
		_, readErr := cmdPty.Read(buf)
		if readErr == io.EOF {
			return
		}
		if readErr != nil {
			wsh.WriteToPtyBuffer("*error reading from controlling-pty: %v\n", readErr)
			return
		}
		var newIsWaiting bool
		wsh.WithLock(func() {
			newIsWaiting = wsh.isWaitingForPassword_nolock()
		})
		if newIsWaiting {
			break
		}
	}
	request := &userinput.UserInputRequestType{
		QueryText:    "Please enter your password",
		ResponseType: "text",
		Title:        "Sudo Password",
		Markdown:     false,
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancelFn()
	response, err := userinput.GetUserInput(ctx, scbus.MainRpcBus, request)
	if err != nil {
		wsh.WriteToPtyBuffer("*error timed out waiting for password: %v\n", err)
		return
	}
	wsh.WithLock(func() {
		curOffset := wsh.PtyBuffer.TotalWritten()
		wsh.PtyBuffer.Write([]byte(response.Text))
		sendRemotePtyUpdate(wsh.Remote.RemoteId, curOffset, []byte(response.Text))
	})
}

func (wsh *WaveshellProc) RunPtyReadLoop(cmdPty *os.File) {
	buf := make([]byte, PtyReadBufSize)
	var isWaiting bool
	for {
		n, readErr := cmdPty.Read(buf)
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			wsh.WriteToPtyBuffer("*error reading from controlling-pty: %v\n", readErr)
			break
		}
		var newIsWaiting bool
		wsh.WithLock(func() {
			curOffset := wsh.PtyBuffer.TotalWritten()
			wsh.PtyBuffer.Write(buf[0:n])
			sendRemotePtyUpdate(wsh.Remote.RemoteId, curOffset, buf[0:n])
			newIsWaiting = wsh.isWaitingForPassword_nolock()
		})
		if newIsWaiting != isWaiting {
			isWaiting = newIsWaiting
			go wsh.NotifyRemoteUpdate()
		}
	}
}

func (wsh *WaveshellProc) CheckPasswordRequested(ctx context.Context, requiresPassword chan bool) {
	for {
		wsh.WithLock(func() {
			if wsh.isWaitingForPassword_nolock() {
				select {
				case requiresPassword <- true:
				default:
				}
				return
			}
			if wsh.Status != StatusConnecting {
				select {
				case requiresPassword <- false:
				default:
				}
				return
			}
		})
		select {
		case <-ctx.Done():
			return
		default:
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (wsh *WaveshellProc) SendPassword(pw string) {
	wsh.WithLock(func() {
		if wsh.ControllingPty == nil {
			return
		}
		pwBytes := []byte(pw + "\r")
		wsh.writeToPtyBuffer_nolock("~[sent password]\r\n")
		_, err := wsh.ControllingPty.Write(pwBytes)
		if err != nil {
			wsh.writeToPtyBuffer_nolock("*cannot write password to controlling pty: %v\n", err)
		}
	})
}

func (wsh *WaveshellProc) WaitAndSendPasswordNew(pw string) {
	requiresPassword := make(chan bool, 1)
	ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancelFn()
	go wsh.CheckPasswordRequested(ctx, requiresPassword)
	select {
	case <-ctx.Done():
		err := ctx.Err()
		var errMsg error
		if err == context.Canceled {
			errMsg = fmt.Errorf("canceled by the user")
		} else {
			errMsg = fmt.Errorf("timed out waiting for password prompt")
		}
		wsh.WriteToPtyBuffer("*error, %s\n", errMsg.Error())
		wsh.setErrorStatus(errMsg)
		return
	case required := <-requiresPassword:
		if !required {
			// we don't need user input in this case, so we exit early
			return
		}
	}

	request := &userinput.UserInputRequestType{
		QueryText:    "Please enter your password",
		ResponseType: "text",
		Title:        "Sudo Password",
		Markdown:     false,
	}
	response, err := userinput.GetUserInput(ctx, scbus.MainRpcBus, request)
	if err != nil {
		var errMsg error
		if err == context.Canceled {
			errMsg = fmt.Errorf("canceled by the user")
		} else {
			errMsg = fmt.Errorf("timed out waiting for user input")
		}
		wsh.WriteToPtyBuffer("*error, %s\n", errMsg.Error())
		wsh.setErrorStatus(errMsg)
		return
	}
	wsh.SendPassword(response.Text)

	//error out if requested again
	go wsh.CheckPasswordRequested(ctx, requiresPassword)
	select {
	case <-ctx.Done():
		err := ctx.Err()
		var errMsg error
		if err == context.Canceled {
			errMsg = fmt.Errorf("canceled by the user")
		} else {
			errMsg = fmt.Errorf("timed out waiting for password prompt")
		}
		wsh.WriteToPtyBuffer("*error, %s\n", errMsg.Error())
		wsh.setErrorStatus(errMsg)
		return
	case required := <-requiresPassword:
		if !required {
			// we don't need user input in this case, so we exit early
			return
		}
	}
	errMsg := fmt.Errorf("*error, incorrect password")
	wsh.WriteToPtyBuffer("*error, %s\n", errMsg.Error())
	wsh.setErrorStatus(errMsg)
}

func (wsh *WaveshellProc) WaitAndSendPassword(pw string) {
	var numWaits int
	for {
		var isWaiting bool
		var isConnecting bool
		wsh.WithLock(func() {
			if wsh.Remote.SSHOpts.GetAuthType() == sstore.RemoteAuthTypeKeyPassword {
				isWaiting = wsh.isWaitingForPassphrase_nolock()
			} else {
				isWaiting = wsh.isWaitingForPassword_nolock()
			}
			isConnecting = wsh.Status == StatusConnecting
		})
		if !isConnecting {
			break
		}
		if !isWaiting {
			numWaits = 0
			time.Sleep(100 * time.Millisecond)
			continue
		}
		numWaits++
		if numWaits < 10 {
			time.Sleep(100 * time.Millisecond)
		} else {
			// send password
			wsh.WithLock(func() {
				if wsh.ControllingPty == nil {
					return
				}
				pwBytes := []byte(pw + "\r")
				wsh.writeToPtyBuffer_nolock("~[sent password]\r\n")
				_, err := wsh.ControllingPty.Write(pwBytes)
				if err != nil {
					wsh.writeToPtyBuffer_nolock("*cannot write password to controlling pty: %v\n", err)
				}
			})
			break
		}
	}
}

func (wsh *WaveshellProc) RunInstall(autoInstall bool) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Errorf("this should not happen. if it does, please reach out to us in our discord or open an issue on our github\n\n"+
				"error:\n%v\n\nstack trace:\n%s", r, string(debug.Stack()))
			log.Printf("fatal error, %s\n", errMsg)
			wsh.WriteToPtyBuffer("*fatal error, %s\n", errMsg)
			wsh.setErrorStatus(errMsg)
		}
	}()
	remoteCopy := wsh.GetRemoteCopy()
	if remoteCopy.Archived {
		wsh.WriteToPtyBuffer("*error: cannot install on archived remote\n")
		return
	}

	var makeClientCtx context.Context
	var makeClientCancelFn context.CancelFunc
	wsh.WithLock(func() {
		makeClientCtx, makeClientCancelFn = context.WithCancel(context.Background())
		wsh.MakeClientCancelFn = makeClientCancelFn
		wsh.MakeClientDeadline = nil
		go wsh.NotifyRemoteUpdate()
	})
	defer makeClientCancelFn()
	clientData, err := sstore.EnsureClientData(makeClientCtx)
	if err != nil {
		wsh.WriteToPtyBuffer("*error: cannot obtain client data: %v", err)
		return
	}
	hideShellPrompt := clientData.ClientOpts.ConfirmFlags["hideshellprompt"]
	baseStatus := wsh.GetStatus()

	if baseStatus == StatusConnected {
		ctx, cancelFn := context.WithTimeout(makeClientCtx, 60*time.Second)
		defer cancelFn()
		request := &userinput.UserInputRequestType{
			ResponseType: "confirm",
			QueryText:    "Waveshell is running on your connection and must be restarted to re-install. Would you like to continue?",
			Title:        "Restart Waveshell",
		}
		response, err := userinput.GetUserInput(ctx, scbus.MainRpcBus, request)
		if err != nil {
			if err == context.Canceled {
				wsh.WriteToPtyBuffer("installation canceled by user\n")
			} else {
				wsh.WriteToPtyBuffer("timed out waiting for user input\n")
			}
			return
		}
		if !response.Confirm {
			wsh.WriteToPtyBuffer("installation canceled by user\n")
			return
		}
	} else if !hideShellPrompt {
		ctx, cancelFn := context.WithTimeout(makeClientCtx, 60*time.Second)
		defer cancelFn()
		request := &userinput.UserInputRequestType{
			ResponseType: "confirm",
			QueryText:    "Waveshell must be reinstalled on the connection to continue. Would you like to install it?",
			Title:        "Install Waveshell",
			CheckBoxMsg:  "Don't show me this again",
		}
		response, err := userinput.GetUserInput(ctx, scbus.MainRpcBus, request)
		if err != nil {
			var errMsg error
			if err == context.Canceled {
				errMsg = fmt.Errorf("installation canceled by user")
			} else {
				errMsg = fmt.Errorf("timed out waiting for user input")
			}
			wsh.WithLock(func() {
				wsh.Client = nil
			})
			wsh.WriteToPtyBuffer("*error, %s\n", errMsg)
			wsh.setErrorStatus(errMsg)
			return
		}
		if !response.Confirm {
			errMsg := fmt.Errorf("installation canceled by user")
			wsh.WriteToPtyBuffer("*error, %s\n", errMsg.Error())
			wsh.setErrorStatus(err)
			wsh.WithLock(func() {
				wsh.Client = nil
			})
			return
		}
		if response.CheckboxStat {
			clientData.ClientOpts.ConfirmFlags["hideshellprompt"] = true
			err = sstore.SetClientOpts(makeClientCtx, clientData.ClientOpts)
			if err != nil {
				wsh.WriteToPtyBuffer("*error, %s\n", err)
				wsh.setErrorStatus(err)
				return
			}

			//reload updated clientdata before sending
			clientData, err = sstore.EnsureClientData(makeClientCtx)
			if err != nil {
				wsh.WriteToPtyBuffer("*error, %s\n", err)
				wsh.setErrorStatus(err)
				return
			}
			update := scbus.MakeUpdatePacket()
			update.AddUpdate(*clientData)
		}
	}
	curStatus := wsh.GetInstallStatus()
	if curStatus == StatusConnecting {
		wsh.WriteToPtyBuffer("*error: cannot install on remote that is already trying to install, cancel current install to try again\n")
		return
	}
	if remoteCopy.Local {
		wsh.WriteToPtyBuffer("*error: cannot install on a local remote\n")
		return
	}
	_, err = shellapi.MakeShellApi(packet.ShellType_bash)
	if err != nil {
		wsh.WriteToPtyBuffer("*error: %v\n", err)
		return
	}
	if wsh.Client == nil {
		remoteDisplayName := fmt.Sprintf("%s [%s]", remoteCopy.RemoteAlias, remoteCopy.RemoteCanonicalName)
		client, err := ConnectToClient(makeClientCtx, remoteCopy.SSHOpts, remoteDisplayName)
		if err != nil {
			statusErr := fmt.Errorf("ssh cannot connect to client: %w", err)
			wsh.setInstallErrorStatus(statusErr)
			return
		}
		wsh.WithLock(func() {
			wsh.Client = client
		})
	}
	session, err := wsh.Client.NewSession()
	if err != nil {
		statusErr := fmt.Errorf("ssh cannot connect to client: %w", err)
		wsh.setInstallErrorStatus(statusErr)
		return
	}
	installSession := shexec.SessionWrap{Session: session, StartCmd: shexec.MakeInstallCommandStr()}
	wsh.WriteToPtyBuffer("installing waveshell %s to %s...\n", scbase.WaveshellVersion, remoteCopy.RemoteCanonicalName)
	clientCtx, clientCancelFn := context.WithCancel(context.Background())
	defer clientCancelFn()
	wsh.WithLock(func() {
		wsh.InstallErr = nil
		wsh.InstallStatus = StatusConnecting
		wsh.InstallCancelFn = clientCancelFn
		go wsh.NotifyRemoteUpdate()
	})
	msgFn := func(msg string) {
		wsh.WriteToPtyBuffer("%s", msg)
	}
	err = shexec.RunInstallFromCmd(clientCtx, installSession, true, nil, scbase.WaveshellBinaryReader, msgFn)
	if err == context.Canceled {
		wsh.WriteToPtyBuffer("*install canceled\n")
		wsh.WithLock(func() {
			wsh.InstallStatus = StatusDisconnected
			go wsh.NotifyRemoteUpdate()
		})
		return
	}
	if err != nil {
		statusErr := fmt.Errorf("install failed: %w", err)
		wsh.setInstallErrorStatus(statusErr)
		return
	}
	var connectMode string
	wsh.WithLock(func() {
		wsh.InstallStatus = StatusDisconnected
		wsh.InstallCancelFn = nil
		wsh.NeedsWaveshellUpgrade = false
		wsh.Status = StatusDisconnected
		wsh.Err = nil
		connectMode = wsh.Remote.ConnectMode
	})
	wsh.WriteToPtyBuffer("successfully installed waveshell %s to ~/.mshell\n", scbase.WaveshellVersion)
	go wsh.NotifyRemoteUpdate()
	if connectMode == sstore.ConnectModeStartup || connectMode == sstore.ConnectModeAuto || autoInstall {
		// the install was successful, and we didn't click the install button with manual connect mode, try to connect
		go wsh.Launch(true)
	}
}

func (wsh *WaveshellProc) updateRemoteStateVars(ctx context.Context, remoteId string, initPk *packet.InitPacketType) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	stateVars := getStateVarsFromInitPk(initPk)
	if stateVars == nil {
		return
	}
	wsh.Remote.StateVars = stateVars
	err := sstore.UpdateRemoteStateVars(ctx, remoteId, stateVars)
	if err != nil {
		// ignore error, nothing to do
		log.Printf("error updating remote statevars: %v\n", err)
	}
}

func getStateVarsFromInitPk(initPk *packet.InitPacketType) map[string]string {
	if initPk == nil || initPk.NotFound {
		return nil
	}
	rtn := make(map[string]string)
	rtn["home"] = initPk.HomeDir
	rtn["remoteuser"] = initPk.User
	rtn["remotehost"] = initPk.HostName
	rtn["remoteuname"] = initPk.UName
	rtn["shelltype"] = initPk.Shell
	return rtn
}

func makeReinitErrorUpdate(shellType string) telemetry.ActivityUpdate {
	rtn := telemetry.ActivityUpdate{}
	if shellType == packet.ShellType_bash {
		rtn.ReinitBashErrors = 1
	} else if shellType == packet.ShellType_zsh {
		rtn.ReinitZshErrors = 1
	}
	return rtn
}

func (wsh *WaveshellProc) ReInit(ctx context.Context, ck base.CommandKey, shellType string, dataFn func([]byte), verbose bool) (rtnPk *packet.ShellStatePacketType, rtnErr error) {
	if !wsh.IsConnected() {
		return nil, fmt.Errorf("cannot reinit, remote is not connected")
	}
	if shellType != packet.ShellType_bash && shellType != packet.ShellType_zsh {
		return nil, fmt.Errorf("invalid shell type %q", shellType)
	}
	if dataFn == nil {
		dataFn = func([]byte) {}
	}
	defer func() {
		if rtnErr != nil {
			telemetry.GoUpdateActivityWrap(makeReinitErrorUpdate(shellType), "reiniterror")
		}
	}()
	startTs := time.Now()
	reinitPk := packet.MakeReInitPacket()
	reinitPk.ReqId = uuid.New().String()
	reinitPk.ShellType = shellType
	rpcIter, err := wsh.PacketRpcIter(ctx, reinitPk)
	if err != nil {
		return nil, err
	}
	defer rpcIter.Close()
	if ck != "" {
		reinitSink := &ReinitCommandSink{
			Remote: wsh,
			ReqId:  reinitPk.ReqId,
		}
		wsh.registerInputSink(ck, reinitSink)
		defer wsh.unregisterInputSink(ck)
	}
	var ssPk *packet.ShellStatePacketType
	for {
		resp, err := rpcIter.Next(ctx)
		if err != nil {
			return nil, err
		}
		if resp == nil {
			return nil, fmt.Errorf("channel closed with no response")
		}
		var ok bool
		ssPk, ok = resp.(*packet.ShellStatePacketType)
		if ok {
			break
		}
		respPk, ok := resp.(*packet.ResponsePacketType)
		if ok {
			if respPk.Error != "" {
				return nil, fmt.Errorf("error reinitializing remote: %s", respPk.Error)
			}
			return nil, fmt.Errorf("invalid response from waveshell")
		}
		dataPk, ok := resp.(*packet.FileDataPacketType)
		if ok {
			dataFn(dataPk.Data)
			continue
		}
		invalidPkStr := fmt.Sprintf("\r\ninvalid packettype from waveshell: %s\r\n", resp.GetType())
		dataFn([]byte(invalidPkStr))
	}
	if ssPk == nil || ssPk.State == nil {
		return nil, fmt.Errorf("invalid reinit response shellstate packet does not contain remote state")
	}
	// TODO: maybe we don't need to save statebase here.  should be possible to save it on demand
	//    when it is actually used.  complication from other functions that try to get the statebase
	//    from the DB.  probably need to route those through WaveshellProc.
	err = sstore.StoreStateBase(ctx, ssPk.State)
	if err != nil {
		return nil, fmt.Errorf("error storing remote state: %w", err)
	}
	wsh.StateMap.SetCurrentState(ssPk.State.GetShellType(), ssPk.State)
	timeDur := time.Since(startTs)
	dataFn([]byte(makeShellInitOutputMsg(verbose, ssPk.State, ssPk.Stats, timeDur, false)))
	wsh.WriteToPtyBuffer("%s", makeShellInitOutputMsg(false, ssPk.State, ssPk.Stats, timeDur, true))
	return ssPk, nil
}

func makeShellInitOutputMsg(verbose bool, state *packet.ShellState, stats *packet.ShellStateStats, dur time.Duration, ptyMsg bool) string {
	waveStr := fmt.Sprintf("%swave>%s", utilfn.AnsiGreenColor(), utilfn.AnsiResetColor())
	if !verbose || ptyMsg {
		if ptyMsg {
			return fmt.Sprintf("initialized state shell:%s statehash:%s %dms\n", state.GetShellType(), state.GetHashVal(false), dur.Milliseconds())
		} else {
			return fmt.Sprintf("%s initialized connection state (shell:%s)\r\n", waveStr, state.GetShellType())
		}
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("%s initialized connection shell:%s statehash:%s %dms\r\n", waveStr, state.GetShellType(), state.GetHashVal(false), dur.Milliseconds()))
	if stats != nil {
		buf.WriteString(fmt.Sprintf("%s   outsize:%s size:%s env:%d, vars:%d, aliases:%d, funcs:%d\r\n", waveStr, scbase.NumFormatDec(stats.OutputSize), scbase.NumFormatDec(stats.StateSize), stats.EnvCount, stats.VarCount, stats.AliasCount, stats.FuncCount))
	}
	return buf.String()
}

func (wsh *WaveshellProc) WriteFile(ctx context.Context, writePk *packet.WriteFilePacketType) (*packet.RpcResponseIter, error) {
	return wsh.PacketRpcIter(ctx, writePk)
}

func (wsh *WaveshellProc) StreamFile(ctx context.Context, streamPk *packet.StreamFilePacketType) (*packet.RpcResponseIter, error) {
	return wsh.PacketRpcIter(ctx, streamPk)
}

func addScVarsToState(state *packet.ShellState) *packet.ShellState {
	if state == nil {
		return nil
	}
	rtn := *state
	envMap := shellenv.DeclMapFromState(&rtn)
	envMap["WAVETERM"] = &shellenv.DeclareDeclType{Name: "WAVETERM", Value: "1", Args: "x"}
	envMap["WAVETERM_VERSION"] = &shellenv.DeclareDeclType{Name: "WAVETERM_VERSION", Value: scbase.WaveVersion, Args: "x"}
	envMap["TERM_PROGRAM"] = &shellenv.DeclareDeclType{Name: "TERM_PROGRAM", Value: "waveterm", Args: "x"}
	envMap["TERM_PROGRAM_VERSION"] = &shellenv.DeclareDeclType{Name: "TERM_PROGRAM_VERSION", Value: scbase.WaveVersion, Args: "x"}
	if scbase.IsDevMode() {
		envMap["WAVETERM_DEV"] = &shellenv.DeclareDeclType{Name: "WAVETERM_DEV", Value: "1", Args: "x"}
	}
	if _, exists := envMap["LANG"]; !exists {
		envMap["LANG"] = &shellenv.DeclareDeclType{Name: "LANG", Value: scbase.DetermineLang(), Args: "x"}
	}
	rtn.ShellVars = shellenv.SerializeDeclMap(envMap)
	return &rtn
}

func stripScVarsFromState(state *packet.ShellState) *packet.ShellState {
	if state == nil {
		return nil
	}
	rtn := *state
	rtn.HashVal = ""
	envMap := shellenv.DeclMapFromState(&rtn)
	for key := range envVarsToStrip {
		delete(envMap, key)
	}
	rtn.ShellVars = shellenv.SerializeDeclMap(envMap)
	return &rtn
}

func stripScVarsFromStateDiff(stateDiff *packet.ShellStateDiff) *packet.ShellStateDiff {
	if stateDiff == nil || len(stateDiff.VarsDiff) == 0 {
		return stateDiff
	}
	rtn := *stateDiff
	rtn.HashVal = ""
	var mapDiff statediff.MapDiffType
	err := mapDiff.Decode(stateDiff.VarsDiff)
	if err != nil {
		log.Printf("error decoding statediff in stripScVarsFromStateDiff: %v\n", err)
		return stateDiff
	}
	for key := range envVarsToStrip {
		delete(mapDiff.ToAdd, key)
	}
	rtn.VarsDiff = mapDiff.Encode()
	return &rtn
}

func (wsh *WaveshellProc) getActiveShellTypes(ctx context.Context) ([]string, error) {
	shellPref := wsh.GetShellPref()
	rtn := []string{shellPref}
	activeShells, err := sstore.GetRemoteActiveShells(ctx, wsh.RemoteId)
	if err != nil {
		return nil, err
	}
	return utilfn.CombineStrArrays(rtn, activeShells), nil
}

func (wsh *WaveshellProc) createWaveshellSession(clientCtx context.Context, remoteCopy sstore.RemoteType) (shexec.ConnInterface, error) {
	wsh.WithLock(func() {
		wsh.Err = nil
		wsh.ErrNoInitPk = false
		wsh.Status = StatusConnecting
		wsh.MakeClientDeadline = nil
		go wsh.NotifyRemoteUpdate()
	})
	sapi, err := shellapi.MakeShellApi(wsh.GetShellType())
	if err != nil {
		return nil, err
	}
	var wsSession shexec.ConnInterface
	if remoteCopy.SSHOpts.SSHHost == "" && remoteCopy.Local {
		cmdStr, err := MakeLocalWaveshellCommandStr(remoteCopy.IsSudo())
		if err != nil {
			return nil, fmt.Errorf("cannot find local waveshell binary: %v", err)
		}
		ecmd := shexec.MakeLocalExecCmd(cmdStr, sapi)
		var cmdPty *os.File
		cmdPty, err = wsh.addControllingTty(ecmd)
		if err != nil {
			return nil, fmt.Errorf("cannot attach controlling tty to waveshell command: %v", err)
		}
		go wsh.RunPtyReadLoop(cmdPty)
		go wsh.WaitAndSendPasswordNew(remoteCopy.SSHOpts.SSHPassword)
		wsSession = shexec.CmdWrap{Cmd: ecmd}
	} else if wsh.Client == nil {
		remoteDisplayName := fmt.Sprintf("%s [%s]", remoteCopy.RemoteAlias, remoteCopy.RemoteCanonicalName)
		client, err := ConnectToClient(clientCtx, remoteCopy.SSHOpts, remoteDisplayName)
		if err != nil {
			return nil, fmt.Errorf("ssh cannot connect to client: %w", err)
		}
		wsh.WithLock(func() {
			wsh.Client = client
		})
		session, err := client.NewSession()
		if err != nil {
			return nil, fmt.Errorf("ssh cannot create session: %w", err)
		}
		cmd := fmt.Sprintf("%s -c %s", sapi.GetLocalShellPath(), shellescape.Quote(MakeServerCommandStr()))
		wsSession = shexec.SessionWrap{Session: session, StartCmd: cmd}
	} else {
		session, err := wsh.Client.NewSession()
		if err != nil {
			return nil, fmt.Errorf("ssh cannot create session: %w", err)
		}
		cmd := fmt.Sprintf(`%s -c %s`, sapi.GetLocalShellPath(), shellescape.Quote(MakeServerCommandStr()))
		wsSession = shexec.SessionWrap{Session: session, StartCmd: cmd}
	}
	return wsSession, nil
}

func (wsh *WaveshellProc) Launch(interactive bool) {
	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Errorf("this should not happen. if it does, please reach out to us in our discord or open an issue on our github\n\n"+
				"error:\n%v\n\nstack trace:\n%s", r, string(debug.Stack()))
			log.Printf("fatal error, %s\n", errMsg)
			wsh.WriteToPtyBuffer("*fatal error, %s\n", errMsg)
			wsh.setErrorStatus(errMsg)
		}
	}()
	remoteCopy := wsh.GetRemoteCopy()
	if remoteCopy.Archived {
		wsh.WriteToPtyBuffer("cannot launch archived remote\n")
		return
	}
	curStatus := wsh.GetStatus()
	if curStatus == StatusConnected {
		wsh.WriteToPtyBuffer("remote is already connected (no action taken)\n")
		return
	}
	if curStatus == StatusConnecting {
		wsh.WriteToPtyBuffer("remote is already connecting, disconnect before trying to connect again\n")
		return
	}
	istatus := wsh.GetInstallStatus()
	if istatus == StatusConnecting {
		wsh.WriteToPtyBuffer("remote is trying to install, cancel install before trying to connect again\n")
		return
	}
	var makeClientCtx context.Context
	var makeClientCancelFn context.CancelFunc
	wsh.WithLock(func() {
		makeClientCtx, makeClientCancelFn = context.WithCancel(context.Background())
		wsh.MakeClientCancelFn = makeClientCancelFn
		wsh.MakeClientDeadline = nil
		go wsh.NotifyRemoteUpdate()
	})
	defer makeClientCancelFn()
	wsh.WriteToPtyBuffer("connecting to %s...\n", remoteCopy.RemoteCanonicalName)
	wsSession, err := wsh.createWaveshellSession(makeClientCtx, remoteCopy)
	if err != nil {
		wsh.WriteToPtyBuffer("*error, %s\n", err.Error())
		wsh.setErrorStatus(err)
		wsh.WithLock(func() {
			wsh.Client = nil
		})
		return
	}
	cproc, err := shexec.MakeClientProc(makeClientCtx, wsSession)
	wsh.WithLock(func() {
		wsh.MakeClientCancelFn = nil
		wsh.MakeClientDeadline = nil
	})
	if err == context.DeadlineExceeded {
		wsh.WriteToPtyBuffer("*connect timeout\n")
		wsh.setErrorStatus(errors.New("connect timeout"))
		wsh.WithLock(func() {
			wsh.Client = nil
		})
		return
	} else if err == context.Canceled {
		wsh.WriteToPtyBuffer("*forced disconnection\n")
		wsh.WithLock(func() {
			wsh.Status = StatusDisconnected
			go wsh.NotifyRemoteUpdate()
		})
		wsh.WithLock(func() {
			wsh.Client = nil
		})
		return
	} else if serr, ok := err.(shexec.WaveshellLaunchError); ok {
		wsh.WithLock(func() {
			wsh.UName = serr.InitPk.UName
			wsh.NeedsWaveshellUpgrade = true
			wsh.InitPkShellType = serr.InitPk.Shell
		})
		wsh.StateMap.Clear()
		wsh.WriteToPtyBuffer("*error, %s\n", serr.Error())
		wsh.setErrorStatus(serr)
		go wsh.tryAutoInstall()
		return
	} else if err != nil {
		wsh.WriteToPtyBuffer("*error, %s\n", err.Error())
		wsh.setErrorStatus(err)
		wsh.WithLock(func() {
			wsh.Client = nil
		})
		return
	}
	wsh.WithLock(func() {
		wsh.UName = cproc.InitPk.UName
		wsh.InitPkShellType = cproc.InitPk.Shell
		wsh.StateMap.Clear()
		// no notify here, because we'll call notify in either case below
	})

	wsh.updateRemoteStateVars(context.Background(), wsh.RemoteId, cproc.InitPk)
	wsh.WithLock(func() {
		wsh.ServerProc = cproc
		wsh.Status = StatusConnected
	})
	wsh.WriteToPtyBuffer("connected to %s\n", remoteCopy.RemoteCanonicalName)
	go func() {
		exitErr := cproc.Cmd.Wait()
		exitCode := utilfn.GetExitCode(exitErr)
		wsh.WithLock(func() {
			if wsh.Status == StatusConnected || wsh.Status == StatusConnecting {
				wsh.Status = StatusDisconnected
				go wsh.NotifyRemoteUpdate()
			}
		})
		wsh.WriteToPtyBuffer("*disconnected exitcode=%d\n", exitCode)
	}()
	go wsh.ProcessPackets()
	// wsh.initActiveShells()
	go wsh.NotifyRemoteUpdate()
}

func (wsh *WaveshellProc) initActiveShells() {
	gasCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	activeShells, err := wsh.getActiveShellTypes(gasCtx)
	if err != nil {
		// we're not going to fail the connect for this error (it will be unusable, but technically connected)
		wsh.WriteToPtyBuffer("*error getting active shells: %v\n", err)
		return
	}
	var wg sync.WaitGroup
	for _, shellTypeForVar := range activeShells {
		wg.Add(1)
		go func(shellType string) {
			defer wg.Done()
			reinitCtx, cancelFn := context.WithTimeout(context.Background(), 12*time.Second)
			defer cancelFn()
			_, err = wsh.ReInit(reinitCtx, base.CommandKey(""), shellType, nil, false)
			if err != nil {
				wsh.WriteToPtyBuffer("*error reiniting shell %q: %v\n", shellType, err)
			}
		}(shellTypeForVar)
	}
	wg.Wait()
}

func (wsh *WaveshellProc) IsConnected() bool {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.Status == StatusConnected
}

func (wsh *WaveshellProc) GetShellType() string {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	return wsh.InitPkShellType
}

func replaceHomePath(pathStr string, homeDir string) string {
	if homeDir == "" {
		return pathStr
	}
	if pathStr == homeDir {
		return "~"
	}
	if strings.HasPrefix(pathStr, homeDir+"/") {
		return "~" + pathStr[len(homeDir):]
	}
	return pathStr
}

func (wsh *WaveshellProc) IsCmdRunning(ck base.CommandKey) bool {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	_, ok := wsh.RunningCmds[ck]
	return ok
}

func (wsh *WaveshellProc) KillRunningCommandAndWait(ctx context.Context, ck base.CommandKey) error {
	if !wsh.IsCmdRunning(ck) {
		return nil
	}
	feiPk := scpacket.MakeFeInputPacket()
	feiPk.CK = ck
	feiPk.SigName = "SIGTERM"
	err := wsh.HandleFeInput(feiPk)
	if err != nil {
		return fmt.Errorf("error trying to kill running cmd: %w", err)
	}
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !wsh.IsCmdRunning(ck) {
			return nil
		}
		// TODO fix busy wait (sync with wsh.RunningCmds)
		// not a huge deal though since this is not processor intensive and not widely used
		time.Sleep(100 * time.Millisecond)
	}
}

func (wsh *WaveshellProc) SendFileData(dataPk *packet.FileDataPacketType) error {
	if !wsh.IsConnected() {
		return fmt.Errorf("remote is not connected, cannot send input")
	}
	return wsh.ServerProc.Input.SendPacket(dataPk)
}

func makeTermOpts(runPk *packet.RunPacketType) sstore.TermOpts {
	return sstore.TermOpts{Rows: int64(runPk.TermOpts.Rows), Cols: int64(runPk.TermOpts.Cols), FlexRows: runPk.TermOpts.FlexRows, MaxPtySize: DefaultMaxPtySize}
}

// returns (ok, rct)
// if ok is true, rct will be nil
// if ok is false, rct will be the existing pending state command (not nil)
func (wsh *WaveshellProc) testAndSetPendingStateCmd(screenId string, rptr sstore.RemotePtrType, newCK *base.CommandKey) (bool, *RunCmdType) {
	key := pendingStateKey{ScreenId: screenId, RemotePtr: rptr}
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	ck, found := wsh.PendingStateCmds[key]
	if found {
		// we don't call GetRunningCmd here because we already hold wsh.Lock
		rct := wsh.RunningCmds[ck]
		if rct != nil {
			return false, rct
		}
		// ok, so rct is nil (that's strange).  allow command to proceed, but log
		log.Printf("[warning] found pending state cmd with no running cmd: %s\n", ck)
	}
	if newCK != nil {
		wsh.PendingStateCmds[key] = *newCK
	}
	return true, nil
}

func (wsh *WaveshellProc) removePendingStateCmd(screenId string, rptr sstore.RemotePtrType, ck base.CommandKey) {
	key := pendingStateKey{ScreenId: screenId, RemotePtr: rptr}
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	existingCK, found := wsh.PendingStateCmds[key]
	if !found {
		return
	}
	if existingCK == ck {
		delete(wsh.PendingStateCmds, key)
	}
}

type RunCommandOpts struct {
	SessionId string
	ScreenId  string
	RemotePtr sstore.RemotePtrType

	// optional, if not provided shellstate will look up state from remote instance
	// ReturnState cannot be used with StatePtr
	// this will also cause this command to bypass the pending state cmd logic
	StatePtr *packet.ShellStatePtr

	// set to true to skip creating the pty file (for restarted commands)
	NoCreateCmdPtyFile bool

	// this command will not go into the DB, and will not have a ptyout file created
	// forces special packet handling (sets RunCommandType.EphemeralOpts)
	EphemeralOpts *ephemeral.EphemeralRunOpts
}

// returns (CmdType, allow-updates-callback, err)
// we must persist the CmdType to the DB before calling the callback to allow updates
// otherwise an early CmdDone packet might not get processed (since cmd will not exist in DB)
func RunCommand(ctx context.Context, rcOpts RunCommandOpts, runPacket *packet.RunPacketType) (rtnCmd *sstore.CmdType, rtnCallback func(), rtnErr error) {
	sessionId, screenId, remotePtr := rcOpts.SessionId, rcOpts.ScreenId, rcOpts.RemotePtr
	if remotePtr.OwnerId != "" {
		return nil, nil, fmt.Errorf("cannot run command against another user's remote '%s'", remotePtr.MakeFullRemoteRef())
	}
	if screenId != runPacket.CK.GetGroupId() {
		return nil, nil, fmt.Errorf("run commands screenids do not match")
	}
	wsh := GetRemoteById(remotePtr.RemoteId)
	if wsh == nil {
		return nil, nil, fmt.Errorf("no remote id=%s found", remotePtr.RemoteId)
	}
	if !wsh.IsConnected() {
		return nil, nil, fmt.Errorf("remote '%s' is not connected", remotePtr.RemoteId)
	}
	if runPacket.State != nil {
		return nil, nil, fmt.Errorf("runPacket.State should not be set, it is set in RunCommand")
	}
	if rcOpts.StatePtr != nil && runPacket.ReturnState {
		return nil, nil, fmt.Errorf("RunCommand: cannot use ReturnState with StatePtr")
	}
	if runPacket.StatePtr != nil {
		return nil, nil, fmt.Errorf("runPacket.StatePtr should not be set, it is set in RunCommand")
	}

	if rcOpts.EphemeralOpts != nil {
		log.Printf("[info] running ephemeral command ck: %s\n", runPacket.CK)
	}

	// pending state command logic
	// if we are currently running a command that can change the state, we need to wait for it to finish
	if rcOpts.StatePtr == nil {
		var newPSC *base.CommandKey
		if runPacket.ReturnState {
			newPSC = &runPacket.CK
		}
		ok, existingRct := wsh.testAndSetPendingStateCmd(screenId, remotePtr, newPSC)
		if !ok {
			if rcOpts.EphemeralOpts != nil {
				// if the existing command is ephemeral, we cancel it and continue
				log.Printf("[warning] canceling existing ephemeral state cmd: %s\n", existingRct.CK)
				rcOpts.EphemeralOpts.Canceled.Store(true)
			} else {
				line, _, err := sstore.GetLineCmdByLineId(ctx, screenId, existingRct.CK.GetCmdId())
				return nil, nil, makePSCLineError(existingRct.CK, line, err)
			}
		}
		if newPSC != nil {
			defer func() {
				// if we get an error, remove the pending state cmd
				// if no error, PSC will get removed when we see a CmdDone or CmdFinal packet
				if rtnErr != nil {
					wsh.removePendingStateCmd(screenId, remotePtr, *newPSC)
				}
			}()
		}
	}

	// get current remote-instance state
	var statePtr *packet.ShellStatePtr
	if rcOpts.StatePtr != nil {
		statePtr = rcOpts.StatePtr
	} else {
		var err error
		statePtr, err = sstore.GetRemoteStatePtr(ctx, sessionId, screenId, remotePtr)
		if err != nil {
			log.Printf("[error] RunCommand: cannot get remote state: %v\n", err)
			return nil, nil, fmt.Errorf("cannot run command: %w", err)
		}
		if statePtr == nil {
			log.Printf("[error] RunCommand: no valid shell state found\n")
			return nil, nil, fmt.Errorf("cannot run command: no valid shell state found")
		}
	}
	// statePtr will not be nil
	runPacket.StatePtr = statePtr
	currentState, err := sstore.GetFullState(ctx, *statePtr)

	if rcOpts.EphemeralOpts != nil {
		// Setting UsePty to false will ensure that the outputs get written to the correct file descriptors to extract stdout and stderr
		runPacket.UsePty = rcOpts.EphemeralOpts.UsePty

		// Ephemeral commands can override the current working directory. We need to expand the home dir if it's relative.
		if rcOpts.EphemeralOpts.OverrideCwd != "" {
			overrideCwd := rcOpts.EphemeralOpts.OverrideCwd
			if !strings.HasPrefix(overrideCwd, "/") {
				expandedCwd, err := wsh.GetRemoteRuntimeState().ExpandHomeDir(overrideCwd)
				if err != nil {
					return nil, nil, fmt.Errorf("cannot expand home dir for cwd: %w", err)
				}
				overrideCwd = expandedCwd
			}
			currentState.Cwd = overrideCwd
		}

		// Ephemeral commands can override the timeout
		if rcOpts.EphemeralOpts.TimeoutMs > 0 {
			runPacket.Timeout = time.Duration(rcOpts.EphemeralOpts.TimeoutMs) * time.Millisecond
		}

		// Ephemeral commands can override the env without persisting it to the DB
		if len(rcOpts.EphemeralOpts.Env) > 0 {
			curEnvs := shellenv.DeclMapFromState(currentState)
			for key, val := range rcOpts.EphemeralOpts.Env {
				curEnvs[key] = &shellenv.DeclareDeclType{Name: key, Value: val, Args: "x"}
			}
			currentState.ShellVars = shellenv.SerializeDeclMap(curEnvs)
		}
	}

	if err != nil || currentState == nil {
		return nil, nil, fmt.Errorf("cannot load current remote state: %w", err)
	}
	runPacket.State = addScVarsToState(currentState)
	runPacket.StateComplete = true
	runPacket.ShellType = currentState.GetShellType()

	// start cmdwait.  must be started before sending the run packet
	// this ensures that we don't process output, or cmddone packets until we set up the line, cmd, and ptyout file
	startCmdWait(runPacket.CK)
	defer func() {
		// if we get an error, remove the cmdwait
		// if no error, cmdwait will get removed by the caller w/ the callback fn that's returned on success
		if rtnErr != nil {
			removeCmdWait(runPacket.CK)
		}
	}()
	runningCmdType := &RunCmdType{
		CK:            runPacket.CK,
		SessionId:     sessionId,
		ScreenId:      screenId,
		RemotePtr:     remotePtr,
		RunPacket:     runPacket,
		EphemeralOpts: rcOpts.EphemeralOpts,
	}
	// RegisterRpc + WaitForResponse is used to get any waveshell side errors
	// waveshell will either return an error (in a ResponsePacketType) or a CmdStartPacketType
	wsh.ServerProc.Output.RegisterRpc(runPacket.ReqId)
	go func() {
		startPk, err := wsh.sendRunPacketAndReturnResponse(runPacket)
		runCmdUpdateFn(runPacket.CK, func() {
			if err != nil {
				// the cmd failed (never started)
				wsh.handleCmdStartError(runningCmdType, err)
				return
			}
			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()
			err = sstore.UpdateCmdStartInfo(ctx, runPacket.CK, startPk.Pid, startPk.WaveshellPid)
			if err != nil {
				log.Printf("error updating cmd start info (in remote.RunCommand): %v\n", err)
			}
		})
	}()
	// command is now successfully runnning
	status := sstore.CmdStatusRunning
	if runPacket.Detached {
		status = sstore.CmdStatusDetached
	}
	cmd := &sstore.CmdType{
		ScreenId:   runPacket.CK.GetGroupId(),
		LineId:     runPacket.CK.GetCmdId(),
		CmdStr:     runPacket.Command,
		RawCmdStr:  runPacket.Command,
		Remote:     remotePtr,
		FeState:    sstore.FeStateFromShellState(currentState),
		StatePtr:   *statePtr,
		TermOpts:   makeTermOpts(runPacket),
		Status:     status,
		ExitCode:   0,
		DurationMs: 0,
		RunOut:     nil,
		RtnState:   runPacket.ReturnState,
	}
	if !rcOpts.NoCreateCmdPtyFile && rcOpts.EphemeralOpts == nil {
		err = sstore.CreateCmdPtyFile(ctx, cmd.ScreenId, cmd.LineId, cmd.TermOpts.MaxPtySize)
		if err != nil {
			// TODO the cmd is running, so this is a tricky error to handle
			return nil, nil, fmt.Errorf("cannot create local ptyout file for running command: %v", err)
		}
	}
	wsh.AddRunningCmd(runningCmdType)
	return cmd, func() { removeCmdWait(runPacket.CK) }, nil
}

// no context because it is called as a goroutine
func (wsh *WaveshellProc) sendRunPacketAndReturnResponse(runPacket *packet.RunPacketType) (*packet.CmdStartPacketType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	err := shexec.SendRunPacketAndRunData(ctx, wsh.ServerProc.Input, runPacket)
	if err != nil {
		return nil, fmt.Errorf("sending run packet to remote: %w", err)
	}
	rtnPk := wsh.ServerProc.Output.WaitForResponse(ctx, runPacket.ReqId)
	if rtnPk == nil {
		return nil, ctx.Err()
	}
	startPk, ok := rtnPk.(*packet.CmdStartPacketType)
	if !ok {
		respPk, ok := rtnPk.(*packet.ResponsePacketType)
		if !ok {
			return nil, fmt.Errorf("invalid response received from server for run packet: %s", packet.AsString(rtnPk))
		}
		if respPk.Error != "" {
			return nil, respPk.Err()
		}
		return nil, fmt.Errorf("invalid response received from server for run packet: %s", packet.AsString(rtnPk))
	}
	return startPk, nil
}

// helper func to construct the proper error given what information we have
func makePSCLineError(existingPSC base.CommandKey, line *sstore.LineType, lineErr error) error {
	if lineErr != nil {
		return fmt.Errorf("cannot run command while a stateful command is still running: %v", lineErr)
	}
	if line == nil {
		return fmt.Errorf("cannot run command while a stateful command is still running %s", existingPSC)
	}
	return fmt.Errorf("cannot run command while a stateful command (linenum=%d) is still running", line.LineNum)
}

func (wsh *WaveshellProc) registerInputSink(ck base.CommandKey, sink CommandInputSink) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	wsh.CommandInputMap[ck] = sink
}

func (wsh *WaveshellProc) unregisterInputSink(ck base.CommandKey) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	delete(wsh.CommandInputMap, ck)
}

func (wsh *WaveshellProc) HandleFeInput(inputPk *scpacket.FeInputPacketType) error {
	if inputPk == nil {
		return nil
	}
	if !wsh.IsConnected() {
		return fmt.Errorf("connection is not connected, cannot send input")
	}
	if wsh.IsCmdRunning(inputPk.CK) {
		if len(inputPk.InputData64) > 0 {
			inputLen := packet.B64DecodedLen(inputPk.InputData64)
			if inputLen > MaxInputDataSize {
				return fmt.Errorf("input data size too large, len=%d (max=%d)", inputLen, MaxInputDataSize)
			}
			dataPk := packet.MakeDataPacket()
			dataPk.CK = inputPk.CK
			dataPk.FdNum = 0 // stdin
			dataPk.Data64 = inputPk.InputData64
			err := wsh.ServerProc.Input.SendPacket(dataPk)
			if err != nil {
				return err
			}
		}
		if inputPk.SigName != "" || inputPk.WinSize != nil {
			siPk := packet.MakeSpecialInputPacket()
			siPk.CK = inputPk.CK
			siPk.SigName = inputPk.SigName
			siPk.WinSize = inputPk.WinSize
			err := wsh.ServerProc.Input.SendPacket(siPk)
			if err != nil {
				return err
			}
		}
		return nil
	}
	wsh.Lock.Lock()
	sink := wsh.CommandInputMap[inputPk.CK]
	wsh.Lock.Unlock()
	if sink == nil {
		// no sink and no running command
		return fmt.Errorf("cannot send input, cmd is not running (%s)", inputPk.CK)
	}
	return sink.HandleInput(inputPk)
}

func (wsh *WaveshellProc) AddRunningCmd(rct *RunCmdType) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	if rct.EphemeralOpts != nil {
		log.Printf("[info] adding ephemeral running command: %s\n", rct.CK)
	}
	wsh.RunningCmds[rct.RunPacket.CK] = rct
}

func (wsh *WaveshellProc) GetRunningCmd(ck base.CommandKey) *RunCmdType {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	rtn := wsh.RunningCmds[ck]
	return rtn
}

func (wsh *WaveshellProc) RemoveRunningCmd(ck base.CommandKey) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	delete(wsh.RunningCmds, ck)
	for key, pendingCk := range wsh.PendingStateCmds {
		if pendingCk == ck {
			delete(wsh.PendingStateCmds, key)
		}
	}
}

func (wsh *WaveshellProc) PacketRpcIter(ctx context.Context, pk packet.RpcPacketType) (*packet.RpcResponseIter, error) {
	if !wsh.IsConnected() {
		return nil, fmt.Errorf("remote is not connected")
	}
	if pk == nil {
		return nil, fmt.Errorf("PacketRpc passed nil packet")
	}
	reqId := pk.GetReqId()
	wsh.ServerProc.Output.RegisterRpcSz(reqId, RpcIterChannelSize)
	err := wsh.ServerProc.Input.SendPacketCtx(ctx, pk)
	if err != nil {
		return nil, err
	}
	return wsh.ServerProc.Output.GetResponseIter(reqId), nil
}

func (wsh *WaveshellProc) PacketRpcRaw(ctx context.Context, pk packet.RpcPacketType) (packet.RpcResponsePacketType, error) {
	if !wsh.IsConnected() {
		return nil, fmt.Errorf("remote is not connected")
	}
	if pk == nil {
		return nil, fmt.Errorf("PacketRpc passed nil packet")
	}
	reqId := pk.GetReqId()
	wsh.ServerProc.Output.RegisterRpc(reqId)
	defer wsh.ServerProc.Output.UnRegisterRpc(reqId)
	err := wsh.ServerProc.Input.SendPacketCtx(ctx, pk)
	if err != nil {
		return nil, err
	}
	rtnPk := wsh.ServerProc.Output.WaitForResponse(ctx, reqId)
	if rtnPk == nil {
		return nil, ctx.Err()
	}
	return rtnPk, nil
}

func (wsh *WaveshellProc) PacketRpc(ctx context.Context, pk packet.RpcPacketType) (*packet.ResponsePacketType, error) {
	rtnPk, err := wsh.PacketRpcRaw(ctx, pk)
	if err != nil {
		return nil, err
	}
	if respPk, ok := rtnPk.(*packet.ResponsePacketType); ok {
		return respPk, nil
	}
	return nil, fmt.Errorf("invalid response packet received: %s", packet.AsString(rtnPk))
}

func (wsh *WaveshellProc) WithLock(fn func()) {
	wsh.Lock.Lock()
	defer wsh.Lock.Unlock()
	fn()
}

func makeDataAckPacket(ck base.CommandKey, fdNum int, ackLen int, err error) *packet.DataAckPacketType {
	ack := packet.MakeDataAckPacket()
	ack.CK = ck
	ack.FdNum = fdNum
	ack.AckLen = ackLen
	if err != nil {
		ack.Error = err.Error()
	}
	return ack
}

func (wsh *WaveshellProc) notifyHangups_nolock() {
	for ck := range wsh.RunningCmds {
		cmd, err := sstore.GetCmdByScreenId(context.Background(), ck.GetGroupId(), ck.GetCmdId())
		if err != nil {
			continue
		}
		update := scbus.MakeUpdatePacket()
		update.AddUpdate(*cmd)
		scbus.MainUpdateBus.DoScreenUpdate(ck.GetGroupId(), update)
		go pushNumRunningCmdsUpdate(&ck, -1)
	}
	wsh.RunningCmds = make(map[base.CommandKey]*RunCmdType)
	wsh.PendingStateCmds = make(map[pendingStateKey]base.CommandKey)
}

func (wsh *WaveshellProc) resolveFinalState(ctx context.Context, origState *packet.ShellState, origStatePtr *packet.ShellStatePtr, donePk *packet.CmdDonePacketType) (*packet.ShellState, error) {
	if donePk.FinalState != nil {
		if origStatePtr == nil {
			return nil, fmt.Errorf("command must have a stateptr to resolve final state")
		}
		finalState := stripScVarsFromState(donePk.FinalState)
		return finalState, nil
	}
	if donePk.FinalStateDiff != nil {
		if donePk.FinalStateBasePtr == nil {
			return nil, fmt.Errorf("invalid rtnstate, has diff but no baseptr")
		}
		stateDiff := stripScVarsFromStateDiff(donePk.FinalStateDiff)
		if origStatePtr == donePk.FinalStateBasePtr {
			// this is the normal case.  the stateptr from the run-packet should match the baseptr from the done-packet
			// this is also the most efficient, because we don't need to fetch the original state
			sapi, err := shellapi.MakeShellApi(origState.GetShellType())
			if err != nil {
				return nil, fmt.Errorf("cannot make shellapi from initial state: %w", err)
			}
			fullState, err := sapi.ApplyShellStateDiff(origState, stateDiff)
			if err != nil {
				return nil, fmt.Errorf("cannot apply shell state diff: %w", err)
			}
			return fullState, nil
		}
		// this is strange (why is backend returning non-original stateptr?)
		// but here, we fetch the stateptr, and then apply the diff against that
		realOrigState, err := sstore.GetFullState(ctx, *donePk.FinalStateBasePtr)
		if err != nil {
			return nil, fmt.Errorf("cannot get original state for diff: %w", err)
		}
		if realOrigState == nil {
			return nil, fmt.Errorf("cannot get original state for diff: not found")
		}
		sapi, err := shellapi.MakeShellApi(realOrigState.GetShellType())
		if err != nil {
			return nil, fmt.Errorf("cannot make shellapi from original state: %w", err)
		}
		fullState, err := sapi.ApplyShellStateDiff(realOrigState, stateDiff)
		if err != nil {
			return nil, fmt.Errorf("cannot apply shell state diff: %w", err)
		}
		return fullState, nil
	}
	return nil, nil
}

// after this limit we'll switch to persisting the full state
const NewStateDiffSizeThreshold = 30 * 1024

// will update the remote instance with the final state
// this is complicated because we want to be as efficient as possible.
// so we pull the current remote-instance state (just the baseptr).  then we compute the diff.
// then we check the size of the diff, and only persist the diff it is under some size threshold
// also we check to see if the diff succeeds (it can fail if the shell or version changed).
// in those cases we also update the RI with the full state
func (wsh *WaveshellProc) updateRIWithFinalState(ctx context.Context, rct *RunCmdType, newState *packet.ShellState) (*sstore.RemoteInstance, error) {
	curRIState, err := sstore.GetRemoteStatePtr(ctx, rct.SessionId, rct.ScreenId, rct.RemotePtr)
	if err != nil {
		return nil, fmt.Errorf("error trying to get current screen stateptr: %w", err)
	}
	feState := sstore.FeStateFromShellState(newState)
	if curRIState == nil {
		// no current state, so just persist the full state
		return sstore.UpdateRemoteState(ctx, rct.SessionId, rct.ScreenId, rct.RemotePtr, feState, newState, nil)
	}
	// pull the base (not the diff) state from the RI (right now we don't want to make multi-level diffs)
	riBaseState, err := sstore.GetStateBase(ctx, curRIState.BaseHash)
	if err != nil {
		return nil, fmt.Errorf("error trying to get statebase: %w", err)
	}
	sapi, err := shellapi.MakeShellApi(riBaseState.GetShellType())
	if err != nil {
		return nil, fmt.Errorf("error trying to make shellapi: %w", err)
	}
	newStateDiff, err := sapi.MakeShellStateDiff(riBaseState, curRIState.BaseHash, newState)
	if err != nil {
		// if we can't make a diff, just persist the full state (this could happen if the shell type changes)
		return sstore.UpdateRemoteState(ctx, rct.SessionId, rct.ScreenId, rct.RemotePtr, feState, newState, nil)
	}
	// we have a diff, let's check the diff size first
	_, encodedDiff := newStateDiff.EncodeAndHash()
	if len(encodedDiff) > NewStateDiffSizeThreshold {
		// diff is too large, persist the full state
		return sstore.UpdateRemoteState(ctx, rct.SessionId, rct.ScreenId, rct.RemotePtr, feState, newState, nil)
	}
	// diff is small enough, persist the diff
	return sstore.UpdateRemoteState(ctx, rct.SessionId, rct.ScreenId, rct.RemotePtr, feState, nil, newStateDiff)
}

func (wsh *WaveshellProc) handleSudoError(ck base.CommandKey, sudoErr error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	screenId, lineId := ck.Split()

	update := scbus.MakeUpdatePacket()
	errOutputStr := fmt.Sprintf("%serror: %v%s\n", utilfn.AnsiRedColor(), sudoErr, utilfn.AnsiResetColor())
	wsh.writeToCmdPtyOut(ctx, screenId, lineId, []byte(errOutputStr))
	doneInfo := sstore.CmdDoneDataValues{
		Ts:         time.Now().UnixMilli(),
		ExitCode:   1,
		DurationMs: 0,
	}
	err := sstore.UpdateCmdDoneInfo(ctx, update, ck, doneInfo, sstore.CmdStatusError)
	if err != nil {
		log.Printf("error updating cmddone info (in handleSudoError): %v\n", err)
		return
	}
	screen, err := sstore.UpdateScreenFocusForDoneCmd(ctx, screenId, lineId)
	if err != nil {
		log.Printf("error trying to update screen focus type (in handleSudoError): %v\n", err)
		// fall-through (nothing to do)
	}
	if screen != nil {
		update.AddUpdate(*screen)
	}
	scbus.MainUpdateBus.DoUpdate(update)
}

func (wsh *WaveshellProc) handleCmdStartError(rct *RunCmdType, startErr error) {
	if rct == nil {
		log.Printf("handleCmdStartError, no rct\n")
		return
	}
	defer wsh.RemoveRunningCmd(rct.CK)
	if rct.EphemeralOpts != nil {
		// nothing to do for ephemeral commands besides remove the running command
		log.Printf("ephemeral command start error: %v\n", startErr)
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	update := scbus.MakeUpdatePacket()
	errOutputStr := fmt.Sprintf("%serror: %v%s\n", utilfn.AnsiRedColor(), startErr, utilfn.AnsiResetColor())
	wsh.writeToCmdPtyOut(ctx, rct.ScreenId, rct.CK.GetCmdId(), []byte(errOutputStr))
	doneInfo := sstore.CmdDoneDataValues{
		Ts:         time.Now().UnixMilli(),
		ExitCode:   1,
		DurationMs: 0,
	}
	err := sstore.UpdateCmdDoneInfo(ctx, update, rct.CK, doneInfo, sstore.CmdStatusError)
	if err != nil {
		log.Printf("error updating cmddone info (in handleCmdStartError): %v\n", err)
		return
	}
	screen, err := sstore.UpdateScreenFocusForDoneCmd(ctx, rct.CK.GetGroupId(), rct.CK.GetCmdId())
	if err != nil {
		log.Printf("error trying to update screen focus type (in handleCmdDonePacket): %v\n", err)
		// fall-through (nothing to do)
	}
	if screen != nil {
		update.AddUpdate(*screen)
	}
	scbus.MainUpdateBus.DoUpdate(update)
}

func (wsh *WaveshellProc) handleCmdDonePacket(rct *RunCmdType, donePk *packet.CmdDonePacketType) {
	if rct == nil {
		log.Printf("cmddone packet received, but no running command found for it %q\n", donePk.CK)
		return
	}
	// this will remove from RunningCmds and from PendingStateCmds
	defer wsh.RemoveRunningCmd(donePk.CK)
	if rct.EphemeralOpts != nil && rct.EphemeralOpts.Canceled.Load() {
		log.Printf("cmddone %s (ephemeral canceled)\n", donePk.CK)
		// do nothing when an ephemeral command is canceled
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	update := scbus.MakeUpdatePacket()
	if rct.EphemeralOpts == nil {
		// only update DB for non-ephemeral commands
		cmdDoneInfo := sstore.CmdDoneDataValues{
			Ts:         donePk.Ts,
			ExitCode:   donePk.ExitCode,
			DurationMs: donePk.DurationMs,
		}
		err := sstore.UpdateCmdDoneInfo(ctx, update, donePk.CK, cmdDoneInfo, sstore.CmdStatusDone)
		if err != nil {
			log.Printf("error updating cmddone info (in handleCmdDonePacket): %v\n", err)
			return
		}
		screen, err := sstore.UpdateScreenFocusForDoneCmd(ctx, donePk.CK.GetGroupId(), donePk.CK.GetCmdId())
		if err != nil {
			log.Printf("error trying to update screen focus type (in handleCmdDonePacket): %v\n", err)
			// fall-through (nothing to do)
		}
		if screen != nil {
			update.AddUpdate(*screen)
		}
	}

	// Close the ephemeral response writer if it exists
	if rct.EphemeralOpts != nil && rct.EphemeralOpts.ExpectsResponse {
		if donePk.ExitCode != 0 {
			// if the command failed, we need to write the error to the response writer
			log.Printf("writing error to ephemeral response writer\n")
			rct.EphemeralOpts.StderrWriter.Write([]byte(fmt.Sprintf("error: %d\n", donePk.ExitCode)))
		}
		log.Printf("closing ephemeral response writers\n")
		defer rct.EphemeralOpts.StdoutWriter.Close()
		defer rct.EphemeralOpts.StderrWriter.Close()
	}

	// ephemeral commands *do* update the remote state
	// not all commands get a final state (only RtnState commands have this returned)
	// so in those cases finalState will be nil
	finalState, err := wsh.resolveFinalState(ctx, rct.RunPacket.State, rct.RunPacket.StatePtr, donePk)
	if err != nil {
		log.Printf("error resolving final state for cmd: %v\n", err)
		// fallthrough
	}
	if finalState != nil {
		newRI, err := wsh.updateRIWithFinalState(ctx, rct, finalState)
		if err != nil {
			log.Printf("error updating RI with final state (in handleCmdDonePacket): %v\n", err)
			// fallthrough
		}
		if newRI != nil {
			update.AddUpdate(sstore.MakeSessionUpdateForRemote(rct.SessionId, newRI))
		}
		// ephemeral commands *do not* update cmd state (there is no command)
		if newRI != nil && rct.EphemeralOpts == nil {
			newRIStatePtr := packet.ShellStatePtr{BaseHash: newRI.StateBaseHash, DiffHashArr: newRI.StateDiffHashArr}
			err = sstore.UpdateCmdRtnState(ctx, donePk.CK, newRIStatePtr)
			if err != nil {
				log.Printf("error trying to update cmd rtnstate: %v\n", err)
				// fall-through (nothing to do)
			}
		}
	}
	scbus.MainUpdateBus.DoUpdate(update)
}

func (wsh *WaveshellProc) handleCmdFinalPacket(rct *RunCmdType, finalPk *packet.CmdFinalPacketType) {
	if rct == nil {
		// this is somewhat expected, since cmddone should have removed the running command
		return
	}
	defer wsh.RemoveRunningCmd(finalPk.CK)
	rtnCmd, err := sstore.GetCmdByScreenId(context.Background(), finalPk.CK.GetGroupId(), finalPk.CK.GetCmdId())
	if err != nil {
		log.Printf("error calling GetCmdById in handleCmdFinalPacket: %v\n", err)
		return
	}
	if rtnCmd == nil || rtnCmd.DoneTs > 0 {
		return
	}
	log.Printf("finalpk %s (hangup): %s\n", finalPk.CK, finalPk.Error)
	screen, err := sstore.HangupCmd(context.Background(), finalPk.CK)
	if err != nil {
		log.Printf("error in hangup-cmd in handleCmdFinalPacket: %v\n", err)
		return
	}
	rtnCmd, err = sstore.GetCmdByScreenId(context.Background(), finalPk.CK.GetGroupId(), finalPk.CK.GetCmdId())
	if err != nil {
		log.Printf("error getting cmd(2) in handleCmdFinalPacket: %v\n", err)
		return
	}
	if rtnCmd == nil {
		log.Printf("error getting cmd(2) in handleCmdFinalPacket (not found)\n")
		return
	}
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(*rtnCmd)
	if screen != nil {
		update.AddUpdate(*screen)
	}
	go pushNumRunningCmdsUpdate(&finalPk.CK, -1)
	scbus.MainUpdateBus.DoUpdate(update)
}

func (wsh *WaveshellProc) ResetDataPos(ck base.CommandKey) {
	wsh.DataPosMap.Delete(ck)
}

func (wsh *WaveshellProc) writeToCmdPtyOut(ctx context.Context, screenId string, lineId string, data []byte) error {
	dataPos := wsh.DataPosMap.Get(base.MakeCommandKey(screenId, lineId))
	update, err := sstore.AppendToCmdPtyBlob(ctx, screenId, lineId, data, dataPos)
	if err != nil {
		return err
	}
	utilfn.IncSyncMap(wsh.DataPosMap, base.MakeCommandKey(screenId, lineId), int64(len(data)))
	if update != nil {
		scbus.MainUpdateBus.DoScreenUpdate(screenId, update)
	}
	return nil
}

func (wsh *WaveshellProc) handleDataPacket(rct *RunCmdType, dataPk *packet.DataPacketType, dataPosMap *utilfn.SyncMap[base.CommandKey, int64]) {
	if rct == nil {
		log.Printf("error handling data packet: no running cmd found %s\n", dataPk.CK)
		ack := makeDataAckPacket(dataPk.CK, dataPk.FdNum, 0, fmt.Errorf("no running cmd found"))
		wsh.ServerProc.Input.SendPacket(ack)
		return
	}
	realData, err := base64.StdEncoding.DecodeString(dataPk.Data64)
	if err != nil {
		log.Printf("error decoding data packet: %v\n", err)
		ack := makeDataAckPacket(dataPk.CK, dataPk.FdNum, 0, err)
		wsh.ServerProc.Input.SendPacket(ack)
		return
	}
	if rct.EphemeralOpts != nil {
		log.Printf("ephemeral data packet: %s\n", dataPk.CK)
		// Write to the response writer if it's set
		if len(realData) > 0 && rct.EphemeralOpts.ExpectsResponse {
			switch dataPk.FdNum {
			case 1:
				_, err := rct.EphemeralOpts.StdoutWriter.Write(realData)
				if err != nil {
					log.Printf("*error writing to ephemeral stdout writer: %v\n", err)
				}
			case 2:
				_, err := rct.EphemeralOpts.StderrWriter.Write(realData)
				if err != nil {
					log.Printf("*error writing to ephemeral stderr writer: %v\n", err)
				}
			default:
				log.Printf("error handling data packet: invalid fdnum %d\n", dataPk.FdNum)
			}
		}
		if dataPk.Error != "" {
			log.Printf("ephemeral data packet error: %s\n", dataPk.Error)
		}
		ack := makeDataAckPacket(dataPk.CK, dataPk.FdNum, len(realData), nil)
		wsh.ServerProc.Input.SendPacket(ack)
		return
	}

	var ack *packet.DataAckPacketType
	if len(realData) > 0 {
		dataPos := dataPosMap.Get(dataPk.CK)
		update, err := sstore.AppendToCmdPtyBlob(context.Background(), rct.ScreenId, dataPk.CK.GetCmdId(), realData, dataPos)
		if err != nil {
			ack = makeDataAckPacket(dataPk.CK, dataPk.FdNum, 0, err)
		} else {
			ack = makeDataAckPacket(dataPk.CK, dataPk.FdNum, len(realData), nil)
		}
		utilfn.IncSyncMap(dataPosMap, dataPk.CK, int64(len(realData)))
		if update != nil {
			scbus.MainUpdateBus.DoScreenUpdate(dataPk.CK.GetGroupId(), update)
		}
	}
	if ack != nil {
		wsh.ServerProc.Input.SendPacket(ack)
	}
}

func sendScreenUpdates(screens []*sstore.ScreenType) {
	for _, screen := range screens {
		update := scbus.MakeUpdatePacket()
		update.AddUpdate(*screen)
		scbus.MainUpdateBus.DoUpdate(update)
	}
}

func (wsh *WaveshellProc) startSudoPwClearChecker(clientData *sstore.ClientData) {
	ctx, cancelFn := context.WithCancel(context.Background())
	defer cancelFn()
	sudoPwStore := clientData.FeOpts.SudoPwStore
	for {
		clientData, err := sstore.EnsureClientData(ctx)
		if err != nil {
			log.Printf("*error: cannot obtain client data in sudo pw loop. using fallback: %v", err)
		} else {
			sudoPwStore = clientData.FeOpts.SudoPwStore
		}

		shouldExit := false
		wsh.WithLock(func() {
			if wsh.sudoClearDeadline > 0 && time.Now().Unix() > wsh.sudoClearDeadline && sudoPwStore != "notimeout" {
				wsh.sudoPw = nil
				wsh.sudoClearDeadline = 0
			}
			if wsh.sudoClearDeadline == 0 {
				shouldExit = true
			}
		})
		if shouldExit {
			return
		}
		time.Sleep(time.Second * 2)
	}
}

func (wsh *WaveshellProc) sendSudoPassword(sudoPk *packet.SudoRequestPacketType) error {
	var storedPw []byte
	var rawSecret []byte
	wsh.WithLock(func() {
		storedPw = wsh.sudoPw
	})
	if storedPw != nil && sudoPk.SudoStatus == "first-attempt" {
		rawSecret = storedPw
	} else {
		request := &userinput.UserInputRequestType{
			QueryText:    "Please enter your password",
			ResponseType: "text",
			Title:        "Sudo Password",
			Markdown:     false,
		}
		ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFn()
		guiResponse, err := userinput.GetUserInput(ctx, scbus.MainRpcBus, request)
		if err != nil {
			return err
		}
		rawSecret = []byte(guiResponse.Text)
	}

	ctx, cancelFn := context.WithCancel(context.Background())
	defer cancelFn()
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return fmt.Errorf("*error: cannot obtain client data: %v", err)
	}
	sudoPwTimeout := clientData.FeOpts.SudoPwTimeoutMs / 1000 / 60
	if sudoPwTimeout == 0 {
		// 0 maps to default
		sudoPwTimeout = sstore.DefaultSudoTimeout
	}
	pwTimeoutDur := time.Duration(sudoPwTimeout) * time.Minute
	wsh.WithLock(func() {
		wsh.sudoPw = rawSecret
		if wsh.sudoClearDeadline == 0 {
			go wsh.startSudoPwClearChecker(clientData)
		}
		wsh.sudoClearDeadline = time.Now().Add(pwTimeoutDur).Unix()
	})

	srvPrivKey, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("generate ecdh: %e", err)
	}
	encryptor, err := waveenc.MakeEncryptorEcdh(srvPrivKey, sudoPk.ShellPubKey)
	if err != nil {
		return err
	}
	encryptedSecret, err := encryptor.EncryptData(rawSecret, "sudopw")
	if err != nil {
		return fmt.Errorf("encrypt secret: %e", err)
	}
	srvPubKey, err := x509.MarshalPKIXPublicKey(srvPrivKey.PublicKey())
	if err != nil {
		return fmt.Errorf("marshal pub key: %e", err)
	}
	sudoResponse := packet.MakeSudoResponsePacket(sudoPk.CK, encryptedSecret, srvPubKey)
	select {
	case wsh.ServerProc.Input.SendCh <- sudoResponse:
	default:
	}
	return nil

}

func (wsh *WaveshellProc) processSinglePacket(pk packet.PacketType) {
	if _, ok := pk.(*packet.DataAckPacketType); ok {
		// TODO process ack (need to keep track of buffer size for sending)
		// this is low priority though since most input is coming from keyboard and won't overflow this buffer
		return
	}
	if dataPk, ok := pk.(*packet.DataPacketType); ok {
		runCmdUpdateFn(dataPk.CK, func() {
			rct := wsh.GetRunningCmd(dataPk.CK)
			wsh.handleDataPacket(rct, dataPk, wsh.DataPosMap)
		})
		go pushStatusIndicatorUpdate(&dataPk.CK, sstore.StatusIndicatorLevel_Output)
		return
	}
	if donePk, ok := pk.(*packet.CmdDonePacketType); ok {
		runCmdUpdateFn(donePk.CK, func() {
			rct := wsh.GetRunningCmd(donePk.CK)
			wsh.handleCmdDonePacket(rct, donePk)
		})
		return
	}
	if finalPk, ok := pk.(*packet.CmdFinalPacketType); ok {
		runCmdUpdateFn(finalPk.CK, func() {
			rct := wsh.GetRunningCmd(finalPk.CK)
			wsh.handleCmdFinalPacket(rct, finalPk)
		})
		return
	}
	if sudoPk, ok := pk.(*packet.SudoRequestPacketType); ok {
		// final failure case -- clear cache
		if sudoPk.SudoStatus == "failure" {
			wsh.sudoPw = nil
			wsh.handleSudoError(sudoPk.CK, fmt.Errorf("sudo: incorrect password entered"))
			return
		}

		// handle waveshell errors here
		if sudoPk.SudoStatus == "error" {
			wsh.handleSudoError(sudoPk.CK, fmt.Errorf("sudo: shell: %s", sudoPk.ErrStr))
			return
		}

		err := wsh.sendSudoPassword(sudoPk)
		if err != nil {
			wsh.handleSudoError(sudoPk.CK, fmt.Errorf("sudo: srv: %s", err))
		}
	}
	if msgPk, ok := pk.(*packet.MessagePacketType); ok {
		wsh.WriteToPtyBuffer("msg> [remote %s] [%s] %s\n", wsh.GetRemoteName(), msgPk.CK, msgPk.Message)
		return
	}
	if rawPk, ok := pk.(*packet.RawPacketType); ok {
		wsh.WriteToPtyBuffer("stderr> [remote %s] %s\n", wsh.GetRemoteName(), rawPk.Data)
		return
	}
	wsh.WriteToPtyBuffer("*[remote %s] unhandled packet %s\n", wsh.GetRemoteName(), packet.AsString(pk))
}

func (wsh *WaveshellProc) ClearCachedSudoPw() {
	wsh.WithLock(func() {
		wsh.sudoPw = nil
		wsh.sudoClearDeadline = 0
	})
}

func (wsh *WaveshellProc) ChangeSudoTimeout(deltaTime int64) {
	wsh.WithLock(func() {
		if wsh.sudoClearDeadline != 0 {
			updated := wsh.sudoClearDeadline + deltaTime*60
			wsh.sudoClearDeadline = max(0, updated)
		}
	})
}

func (wsh *WaveshellProc) ProcessPackets() {
	defer wsh.WithLock(func() {
		if wsh.Status == StatusConnected {
			wsh.Status = StatusDisconnected
		}
		screens, err := sstore.HangupRunningCmdsByRemoteId(context.Background(), wsh.Remote.RemoteId)
		if err != nil {
			wsh.writeToPtyBuffer_nolock("error calling HUP on cmds %v\n", err)
		}
		wsh.notifyHangups_nolock()
		go wsh.NotifyRemoteUpdate()
		if len(screens) > 0 {
			go sendScreenUpdates(screens)
		}
	})
	for pk := range wsh.ServerProc.Output.MainCh {
		wsh.processSinglePacket(pk)
	}
}

// returns number of chars (including braces) for brace-expr
func getBracedStr(runeStr []rune) int {
	if len(runeStr) < 3 {
		return 0
	}
	if runeStr[0] != '{' {
		return 0
	}
	for i := 1; i < len(runeStr); i++ {
		if runeStr[i] == '}' {
			if i == 1 { // cannot have {}
				return 0
			}
			return i + 1
		}
	}
	return 0
}

func isDigit(r rune) bool {
	return r >= '0' && r <= '9' // just check ascii digits (not unicode)
}

func EvalPrompt(promptFmt string, vars map[string]string, state *packet.ShellState) string {
	var buf bytes.Buffer
	promptRunes := []rune(promptFmt)
	for i := 0; i < len(promptRunes); i++ {
		ch := promptRunes[i]
		if ch == '\\' && i != len(promptRunes)-1 {
			nextCh := promptRunes[i+1]
			if nextCh == 'x' || nextCh == 'y' {
				nr := getBracedStr(promptRunes[i+2:])
				if nr > 0 {
					escCode := string(promptRunes[i+1 : i+1+nr+1]) // start at "x" or "y", extend nr+1 runes
					escStr := evalPromptEsc(escCode, vars, state)
					buf.WriteString(escStr)
					i += nr + 1
					continue
				} else {
					buf.WriteRune(ch) // invalid escape, so just write ch and move on
					continue
				}
			} else if isDigit(nextCh) {
				if len(promptRunes) >= i+4 && isDigit(promptRunes[i+2]) && isDigit(promptRunes[i+3]) {
					i += 3
					escStr := evalPromptEsc(string(promptRunes[i+1:i+4]), vars, state)
					buf.WriteString(escStr)
					continue
				} else {
					buf.WriteRune(ch) // invalid escape, so just write ch and move on
					continue
				}
			} else {
				i += 1
				escStr := evalPromptEsc(string(nextCh), vars, state)
				buf.WriteString(escStr)
				continue
			}
		}
		buf.WriteRune(ch)
	}
	return buf.String()
}

func evalPromptEsc(escCode string, vars map[string]string, state *packet.ShellState) string {
	if strings.HasPrefix(escCode, "x{") && strings.HasSuffix(escCode, "}") {
		varName := escCode[2 : len(escCode)-1]
		return vars[varName]
	}
	if strings.HasPrefix(escCode, "y{") && strings.HasSuffix(escCode, "}") {
		if state == nil {
			return ""
		}
		varName := escCode[2 : len(escCode)-1]
		varMap := shellenv.ShellVarMapFromState(state)
		return varMap[varName]
	}
	if escCode == "h" {
		return vars["remoteshorthost"]
	}
	if escCode == "H" {
		return vars["remotehost"]
	}
	if escCode == "s" {
		return "mshell"
	}
	if escCode == "u" {
		return vars["remoteuser"]
	}
	if escCode == "w" {
		if state == nil {
			return "?"
		}
		return replaceHomePath(state.Cwd, vars["home"])
	}
	if escCode == "W" {
		if state == nil {
			return "?"
		}
		return path.Base(replaceHomePath(state.Cwd, vars["home"]))
	}
	if escCode == "$" {
		if vars["remoteuser"] == "root" || vars["sudo"] == "1" {
			return "#"
		} else {
			return "$"
		}
	}
	if len(escCode) == 3 {
		// \nnn escape
		ival, err := strconv.ParseInt(escCode, 8, 32)
		if err != nil {
			return escCode
		}
		if ival >= 0 && ival <= 255 {
			return string([]byte{byte(ival)})
		} else {
			// if it was out of range just return the string (invalid escape)
			return escCode
		}
	}
	if escCode == "e" {
		return "\033"
	}
	if escCode == "n" {
		return "\n"
	}
	if escCode == "r" {
		return "\r"
	}
	if escCode == "a" {
		return "\007"
	}
	if escCode == "\\" {
		return "\\"
	}
	if escCode == "[" {
		return ""
	}
	if escCode == "]" {
		return ""
	}

	// we don't support date/time escapes (d, t, T, @), version escapes (v, V), cmd number (#, !), terminal device (l), jobs (j)
	return "(" + escCode + ")"
}

func (wsh *WaveshellProc) getFullState(shellType string, stateDiff *packet.ShellStateDiff) (*packet.ShellState, error) {
	baseState := wsh.StateMap.GetStateByHash(shellType, stateDiff.BaseHash)
	if baseState != nil && len(stateDiff.DiffHashArr) == 0 {
		sapi, err := shellapi.MakeShellApi(baseState.GetShellType())
		newState, err := sapi.ApplyShellStateDiff(baseState, stateDiff)
		if err != nil {
			return nil, err
		}
		return newState, nil
	} else {
		fullState, err := sstore.GetFullState(context.Background(), packet.ShellStatePtr{BaseHash: stateDiff.BaseHash, DiffHashArr: stateDiff.DiffHashArr})
		if err != nil {
			return nil, err
		}
		sapi, err := shellapi.MakeShellApi(fullState.GetShellType())
		if err != nil {
			return nil, err
		}
		newState, err := sapi.ApplyShellStateDiff(fullState, stateDiff)
		return newState, nil
	}
}

// internal func, first tries the StateMap, otherwise will fallback on sstore.GetFullState
func (wsh *WaveshellProc) getFeStateFromDiff(stateDiff *packet.ShellStateDiff) (map[string]string, error) {
	baseState := wsh.StateMap.GetStateByHash(stateDiff.GetShellType(), stateDiff.BaseHash)
	if baseState != nil && len(stateDiff.DiffHashArr) == 0 {
		sapi, err := shellapi.MakeShellApi(baseState.GetShellType())
		if err != nil {
			return nil, err
		}
		newState, err := sapi.ApplyShellStateDiff(baseState, stateDiff)
		if err != nil {
			return nil, err
		}
		return sstore.FeStateFromShellState(newState), nil
	} else {
		fullState, err := sstore.GetFullState(context.Background(), packet.ShellStatePtr{BaseHash: stateDiff.BaseHash, DiffHashArr: stateDiff.DiffHashArr})
		if err != nil {
			return nil, err
		}
		sapi, err := shellapi.MakeShellApi(fullState.GetShellType())
		if err != nil {
			return nil, err
		}
		newState, err := sapi.ApplyShellStateDiff(fullState, stateDiff)
		if err != nil {
			return nil, err
		}
		return sstore.FeStateFromShellState(newState), nil
	}
}

func (wsh *WaveshellProc) TryAutoConnect() error {
	if wsh.IsConnected() {
		return nil
	}
	rcopy := wsh.GetRemoteCopy()
	if rcopy.ConnectMode == sstore.ConnectModeManual {
		return nil
	}
	var err error
	wsh.WithLock(func() {
		if wsh.NumTryConnect > 5 {
			err = fmt.Errorf("too many unsuccessful tries")
			return
		}
		wsh.NumTryConnect++
	})
	if err != nil {
		return err
	}
	wsh.Launch(false)
	if !wsh.IsConnected() {
		return fmt.Errorf("error connecting")
	}
	return nil
}

func (wsh *WaveshellProc) GetDisplayName() string {
	rcopy := wsh.GetRemoteCopy()
	return rcopy.GetName()
}

// Identify the screen for a given CommandKey and push the given status indicator update for that screen
func pushStatusIndicatorUpdate(ck *base.CommandKey, level sstore.StatusIndicatorLevel) {
	screenId := ck.GetGroupId()
	err := sstore.SetStatusIndicatorLevel(context.Background(), screenId, level, false)
	if err != nil {
		log.Printf("error setting status indicator level: %v\n", err)
	}
}

func pushNumRunningCmdsUpdate(ck *base.CommandKey, delta int) {
	screenId := ck.GetGroupId()
	sstore.IncrementNumRunningCmds(screenId, delta)
}
