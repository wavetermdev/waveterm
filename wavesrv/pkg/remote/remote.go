// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path"
	"regexp"
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
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"golang.org/x/crypto/ssh"
	"golang.org/x/mod/semver"
)

const UseSshLibrary = false

const RemoteTypeMShell = "mshell"
const DefaultTerm = "xterm-256color"
const DefaultMaxPtySize = 1024 * 1024
const CircBufSize = 64 * 1024
const RemoteTermRows = 8
const RemoteTermCols = 80
const PtyReadBufSize = 100
const RemoteConnectTimeout = 15 * time.Second

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

// we add this ping packet to the MShellServer Commands in order to deal with spurious SSH output
// basically we guarantee the parser will see a valid packet (either an init error or a ping)
// so we can pass ignoreUntilValid to PacketParser
const PrintPingPacket = `printf "\n##N{\"type\": \"ping\"}\n"`

const MShellServerCommandFmt = `
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

const WaveshellServerRunOnlyFmt = `
  PATH=$PATH:~/.mshell;
  [%PINGPACKET%]
  mshell-[%VERSION%] --server
`

func MakeLocalMShellCommandStr(isSudo bool) (string, error) {
	mshellPath, err := scbase.LocalMShellBinaryPath()
	if err != nil {
		return "", err
	}
	if isSudo {
		return fmt.Sprintf(`%s; sudo %s --server`, PrintPingPacket, shellescape.Quote(mshellPath)), nil
	} else {
		return fmt.Sprintf(`%s; %s --server`, PrintPingPacket, shellescape.Quote(mshellPath)), nil
	}
}

func MakeServerCommandStr() string {
	rtn := strings.ReplaceAll(MShellServerCommandFmt, "[%VERSION%]", semver.MajorMinor(scbase.MShellVersion))
	rtn = strings.ReplaceAll(rtn, "[%PINGPACKET%]", PrintPingPacket)
	return rtn
}

func MakeServerRunOnlyCommandStr() string {
	rtn := strings.ReplaceAll(WaveshellServerRunOnlyFmt, "[%VERSION%]", semver.MajorMinor(scbase.MShellVersion))
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
	if scbase.MShellVersion != base.MShellVersion {
		panic(fmt.Sprintf("prompt-server apishell version must match '%s' vs '%s'", scbase.MShellVersion, base.MShellVersion))
	}
}

var GlobalStore *Store

type Store struct {
	Lock       *sync.Mutex
	Map        map[string]*MShellProc // key=remoteid
	CmdWaitMap map[base.CommandKey][]func()
}

type pendingStateKey struct {
	ScreenId  string
	RemotePtr sstore.RemotePtrType
}

// for conditional launch method based on ssh library in use
// remove once ssh library is stabilized
type Launcher interface {
	Launch(*MShellProc, bool)
}

type MShellProc struct {
	Lock   *sync.Mutex
	Remote *sstore.RemoteType

	// runtime
	RemoteId           string // can be read without a lock
	Status             string
	ServerProc         *shexec.ClientProc
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
	InstallStatus      string
	NeedsMShellUpgrade bool
	InstallCancelFn    context.CancelFunc
	InstallErr         error

	RunningCmds      map[base.CommandKey]RunCmdType
	PendingStateCmds map[pendingStateKey]base.CommandKey // key=[remoteinstance name]
	launcher         Launcher                            // for conditional launch method based on ssh library in use. remove once ssh library is stabilized
}

type RunCmdType struct {
	SessionId string
	ScreenId  string
	RemotePtr sstore.RemotePtrType
	RunPacket *packet.RunPacketType
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

// for conditional launch method based on ssh library in use
// remove once ssh library is stabilized
func (msh *MShellProc) Launch(interactive bool) {
	msh.launcher.Launch(msh, interactive)
}

func (msh *MShellProc) GetStatus() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Status
}

func (msh *MShellProc) GetDefaultState(shellType string) *packet.ShellState {
	_, state := msh.StateMap.GetCurrentState(shellType)
	return state
}

func (msh *MShellProc) EnsureShellType(ctx context.Context, shellType string) error {
	if msh.StateMap.HasShell(shellType) {
		return nil
	}
	// try to reinit the shell
	_, err := msh.ReInit(ctx, shellType)
	if err != nil {
		return fmt.Errorf("error trying to initialize shell %q: %v", shellType, err)
	}
	return nil
}

func (msh *MShellProc) GetDefaultStatePtr(shellType string) *sstore.ShellStatePtr {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	hash, _ := msh.StateMap.GetCurrentState(shellType)
	if hash == "" {
		return nil
	}
	return &sstore.ShellStatePtr{BaseHash: hash}
}

func (msh *MShellProc) GetDefaultFeState(shellType string) map[string]string {
	state := msh.GetDefaultState(shellType)
	return sstore.FeStateFromShellState(state)
}

func (msh *MShellProc) GetRemoteId() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Remote.RemoteId
}

func (msh *MShellProc) GetInstallStatus() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.InstallStatus
}

func LoadRemotes(ctx context.Context) error {
	GlobalStore = &Store{
		Lock:       &sync.Mutex{},
		Map:        make(map[string]*MShellProc),
		CmdWaitMap: make(map[base.CommandKey][]func()),
	}
	allRemotes, err := sstore.GetAllRemotes(ctx)
	if err != nil {
		return err
	}
	var numLocal int
	var numSudoLocal int
	for _, remote := range allRemotes {
		msh := MakeMShell(remote)
		GlobalStore.Map[remote.RemoteId] = msh
		if remote.ConnectMode == sstore.ConnectModeStartup {
			go msh.Launch(false)
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
	msh := MakeMShell(r)
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	existingRemote := GlobalStore.Map[remoteId]
	if existingRemote != nil {
		return fmt.Errorf("cannot add remote %s, already in global map", remoteId)
	}
	GlobalStore.Map[r.RemoteId] = msh
	if r.ConnectMode == sstore.ConnectModeStartup {
		go msh.Launch(false)
	}
	return nil
}

func ReadRemotePty(ctx context.Context, remoteId string) (int64, []byte, error) {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	msh := GlobalStore.Map[remoteId]
	if msh == nil {
		return 0, nil, nil
	}
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	barr := msh.PtyBuffer.Bytes()
	offset := msh.PtyBuffer.TotalWritten() - int64(len(barr))
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
	newMsh := MakeMShell(r)
	GlobalStore.Map[r.RemoteId] = newMsh
	go newMsh.NotifyRemoteUpdate()
	if shouldStart {
		go newMsh.Launch(true)
	}
	return nil
}

func ArchiveRemote(ctx context.Context, remoteId string) error {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	msh := GlobalStore.Map[remoteId]
	if msh == nil {
		return fmt.Errorf("remote not found, cannot archive")
	}
	if msh.Status == StatusConnected {
		return fmt.Errorf("cannot archive connected remote")
	}
	if msh.Remote.Local {
		return fmt.Errorf("cannot archive local remote")
	}
	rcopy := msh.GetRemoteCopy()
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
	newMsh := MakeMShell(archivedRemote)
	GlobalStore.Map[remoteId] = newMsh
	go newMsh.NotifyRemoteUpdate()
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

func GetRemoteByArg(arg string) *MShellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	isPuid := isPartialUUID(arg)
	for _, msh := range GlobalStore.Map {
		rcopy := msh.GetRemoteCopy()
		if rcopy.RemoteAlias == arg || rcopy.RemoteCanonicalName == arg || rcopy.RemoteId == arg {
			return msh
		}
		if isPuid && strings.HasPrefix(rcopy.RemoteId, arg) {
			return msh
		}
	}
	return nil
}

func getRemoteByCanonicalName_nolock(name string) *MShellProc {
	for _, msh := range GlobalStore.Map {
		rcopy := msh.GetRemoteCopy()
		if rcopy.RemoteCanonicalName == name {
			return msh
		}
	}
	return nil
}

func GetRemoteById(remoteId string) *MShellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	return GlobalStore.Map[remoteId]
}

func GetRemoteCopyById(remoteId string) *sstore.RemoteType {
	msh := GetRemoteById(remoteId)
	if msh == nil {
		return nil
	}
	rcopy := msh.GetRemoteCopy()
	return &rcopy
}

func GetRemoteMap() map[string]*MShellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	rtn := make(map[string]*MShellProc)
	for remoteId, msh := range GlobalStore.Map {
		rtn[remoteId] = msh
	}
	return rtn
}

func GetLocalRemote() *MShellProc {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	for _, msh := range GlobalStore.Map {
		if msh.IsLocal() && !msh.IsSudo() {
			return msh
		}
	}
	return nil
}

func ResolveRemoteRef(remoteRef string) *RemoteRuntimeState {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	_, err := uuid.Parse(remoteRef)
	if err == nil {
		msh := GlobalStore.Map[remoteRef]
		if msh != nil {
			state := msh.GetRemoteRuntimeState()
			return &state
		}
		return nil
	}
	for _, msh := range GlobalStore.Map {
		if msh.Remote.RemoteAlias == remoteRef || msh.Remote.RemoteCanonicalName == remoteRef {
			state := msh.GetRemoteRuntimeState()
			return &state
		}
	}
	return nil
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

func (msh *MShellProc) IsLocal() bool {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Remote.Local
}

func (msh *MShellProc) IsSudo() bool {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Remote.IsSudo()
}

func (msh *MShellProc) tryAutoInstall() {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	if !msh.Remote.AutoInstall || !msh.NeedsMShellUpgrade || msh.InstallErr != nil {
		return
	}
	msh.writeToPtyBuffer_nolock("trying auto-install\n")
	go msh.RunInstall()
}

// if msh.IsConnected() then GetShellPref() should return a valid shell
// if msh is not connected, then InitPkShellType might be empty
func (msh *MShellProc) GetShellPref() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	if msh.Remote.ShellPref == sstore.ShellTypePref_Detect {
		return msh.InitPkShellType
	}
	return msh.Remote.ShellPref
}

func (msh *MShellProc) GetRemoteRuntimeState() RemoteRuntimeState {
	shellPref := msh.GetShellPref()
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	state := RemoteRuntimeState{
		RemoteType:          msh.Remote.RemoteType,
		RemoteId:            msh.Remote.RemoteId,
		RemoteAlias:         msh.Remote.RemoteAlias,
		RemoteCanonicalName: msh.Remote.RemoteCanonicalName,
		Status:              msh.Status,
		ConnectMode:         msh.Remote.ConnectMode,
		AutoInstall:         msh.Remote.AutoInstall,
		Archived:            msh.Remote.Archived,
		RemoteIdx:           msh.Remote.RemoteIdx,
		SSHConfigSrc:        msh.Remote.SSHConfigSrc,
		UName:               msh.UName,
		InstallStatus:       msh.InstallStatus,
		NeedsMShellUpgrade:  msh.NeedsMShellUpgrade,
		Local:               msh.Remote.Local,
		NoInitPk:            msh.ErrNoInitPk,
		AuthType:            sstore.RemoteAuthTypeNone,
		ShellPref:           msh.Remote.ShellPref,
		DefaultShellType:    shellPref,
	}
	if msh.Remote.SSHOpts != nil {
		state.AuthType = msh.Remote.SSHOpts.GetAuthType()
	}
	if msh.Remote.RemoteOpts != nil {
		optsCopy := *msh.Remote.RemoteOpts
		state.RemoteOpts = &optsCopy
	}
	if msh.Err != nil {
		state.ErrorStr = msh.Err.Error()
	}
	if msh.InstallErr != nil {
		state.InstallErrorStr = msh.InstallErr.Error()
	}
	if msh.Status == StatusConnecting {
		state.WaitingForPassword = msh.isWaitingForPassword_nolock()
		if msh.MakeClientDeadline != nil {
			state.ConnectTimeout = int((*msh.MakeClientDeadline).Sub(time.Now()) / time.Second)
			if state.ConnectTimeout < 0 {
				state.ConnectTimeout = 0
			}
		}
	}
	vars := msh.Remote.StateVars
	if vars == nil {
		vars = make(map[string]string)
	}
	vars["user"] = msh.Remote.RemoteUser
	vars["bestuser"] = vars["user"]
	vars["host"] = msh.Remote.RemoteHost
	vars["shorthost"] = makeShortHost(msh.Remote.RemoteHost)
	vars["alias"] = msh.Remote.RemoteAlias
	vars["cname"] = msh.Remote.RemoteCanonicalName
	vars["remoteid"] = msh.Remote.RemoteId
	vars["status"] = msh.Status
	vars["type"] = msh.Remote.RemoteType
	if msh.Remote.IsSudo() {
		vars["sudo"] = "1"
	}
	if msh.Remote.Local {
		vars["local"] = "1"
	}
	vars["port"] = "22"
	if msh.Remote.SSHOpts != nil {
		if msh.Remote.SSHOpts.SSHPort != 0 {
			vars["port"] = strconv.Itoa(msh.Remote.SSHOpts.SSHPort)
		}
	}
	if msh.Remote.RemoteOpts != nil && msh.Remote.RemoteOpts.Color != "" {
		vars["color"] = msh.Remote.RemoteOpts.Color
	}
	if msh.ServerProc != nil && msh.ServerProc.InitPk != nil {
		initPk := msh.ServerProc.InitPk
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
	_, curState := msh.StateMap.GetCurrentState(shellPref)
	if curState != nil {
		state.DefaultFeState = sstore.FeStateFromShellState(curState)
		vars["cwd"] = curState.Cwd
	}
	if msh.Remote.Local && msh.Remote.IsSudo() {
		vars["bestuser"] = "sudo"
	} else if msh.Remote.IsSudo() {
		vars["bestuser"] = "sudo@" + vars["bestuser"]
	}
	if msh.Remote.Local {
		vars["bestname"] = vars["bestuser"] + "@local"
		vars["bestshortname"] = vars["bestuser"] + "@local"
	} else {
		vars["bestname"] = vars["bestuser"] + "@" + vars["besthost"]
		vars["bestshortname"] = vars["bestuser"] + "@" + vars["bestshorthost"]
	}
	if vars["remoteuser"] == "root" || vars["sudo"] == "1" {
		vars["isroot"] = "1"
	}
	state.RemoteVars = vars
	state.ActiveShells = msh.StateMap.GetShells()
	return state
}

func (msh *MShellProc) NotifyRemoteUpdate() {
	rstate := msh.GetRemoteRuntimeState()
	update := &sstore.ModelUpdate{Remotes: []RemoteRuntimeState{rstate}}
	sstore.MainBus.SendUpdate(update)
}

func GetAllRemoteRuntimeState() []RemoteRuntimeState {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	var rtn []RemoteRuntimeState
	for _, proc := range GlobalStore.Map {
		state := proc.GetRemoteRuntimeState()
		rtn = append(rtn, state)
	}
	return rtn
}

func MakeMShell(r *sstore.RemoteType) *MShellProc {
	buf, err := circbuf.NewBuffer(CircBufSize)
	if err != nil {
		panic(err) // this should never happen (NewBuffer only returns an error if CirBufSize <= 0)
	}
	rtn := &MShellProc{
		Lock:             &sync.Mutex{},
		Remote:           r,
		RemoteId:         r.RemoteId,
		Status:           StatusDisconnected,
		PtyBuffer:        buf,
		InstallStatus:    StatusDisconnected,
		RunningCmds:      make(map[base.CommandKey]RunCmdType),
		PendingStateCmds: make(map[pendingStateKey]base.CommandKey),
		StateMap:         server.MakeShellStateMap(),
		launcher:         LegacyLauncher{}, // for conditional launch method based on ssh library in use. remove once ssh library is stabilized
		DataPosMap:       utilfn.MakeSyncMap[base.CommandKey, int64](),
	}
	// for conditional launch method based on ssh library in use
	// remove once ssh library is stabilized
	if UseSshLibrary {
		rtn.launcher = NewLauncher{}
	}

	rtn.WriteToPtyBuffer("console for connection [%s]\n", r.GetName())
	return rtn
}

func SendRemoteInput(pk *scpacket.RemoteInputPacketType) error {
	data, err := base64.StdEncoding.DecodeString(pk.InputData64)
	if err != nil {
		return fmt.Errorf("cannot decode base64: %v\n", err)
	}
	msh := GetRemoteById(pk.RemoteId)
	if msh == nil {
		return fmt.Errorf("remote not found")
	}
	var cmdPty *os.File
	msh.WithLock(func() {
		cmdPty = msh.ControllingPty
	})
	if cmdPty == nil {
		return fmt.Errorf("remote has no attached pty")
	}
	_, err = cmdPty.Write(data)
	if err != nil {
		return fmt.Errorf("writing to pty: %v", err)
	}
	msh.resetClientDeadline()
	return nil
}

func (msh *MShellProc) getClientDeadline() *time.Time {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.MakeClientDeadline
}

func (msh *MShellProc) resetClientDeadline() {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	if msh.Status != StatusConnecting {
		return
	}
	deadline := msh.MakeClientDeadline
	if deadline == nil {
		return
	}
	newDeadline := time.Now().Add(RemoteConnectTimeout)
	msh.MakeClientDeadline = &newDeadline
}

func (msh *MShellProc) watchClientDeadlineTime() {
	for {
		time.Sleep(1 * time.Second)
		status := msh.GetStatus()
		if status != StatusConnecting {
			break
		}
		deadline := msh.getClientDeadline()
		if deadline == nil {
			break
		}
		if time.Now().After(*deadline) {
			msh.Disconnect(false)
			break
		}
		go msh.NotifyRemoteUpdate()
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

func (msh *MShellProc) addControllingTty(ecmd *exec.Cmd) (*os.File, error) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()

	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, err
	}
	pty.Setsize(cmdPty, &pty.Winsize{Rows: RemoteTermRows, Cols: RemoteTermCols})
	msh.ControllingPty = cmdPty
	ecmd.ExtraFiles = append(ecmd.ExtraFiles, cmdTty)
	if ecmd.SysProcAttr == nil {
		ecmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	ecmd.SysProcAttr.Setsid = true
	ecmd.SysProcAttr.Setctty = true
	ecmd.SysProcAttr.Ctty = len(ecmd.ExtraFiles) + 3 - 1
	return cmdPty, nil
}

func (msh *MShellProc) setErrorStatus(err error) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	msh.Status = StatusError
	msh.Err = err
	go msh.NotifyRemoteUpdate()
}

func (msh *MShellProc) setInstallErrorStatus(err error) {
	msh.WriteToPtyBuffer("*error, %s\n", err.Error())
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	msh.InstallStatus = StatusError
	msh.InstallErr = err
	go msh.NotifyRemoteUpdate()
}

func (msh *MShellProc) GetRemoteCopy() sstore.RemoteType {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return *msh.Remote
}

func (msh *MShellProc) GetUName() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.UName
}

func (msh *MShellProc) GetNumRunningCommands() int {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return len(msh.RunningCmds)
}

func (msh *MShellProc) UpdateRemote(ctx context.Context, editMap map[string]interface{}) error {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	updatedRemote, err := sstore.UpdateRemote(ctx, msh.Remote.RemoteId, editMap)
	if err != nil {
		return err
	}
	if updatedRemote == nil {
		return fmt.Errorf("no remote returned from UpdateRemote")
	}
	msh.Remote = updatedRemote
	go msh.NotifyRemoteUpdate()
	return nil
}

func (msh *MShellProc) Disconnect(force bool) {
	status := msh.GetStatus()
	if status != StatusConnected && status != StatusConnecting {
		msh.WriteToPtyBuffer("remote already disconnected (no action taken)\n")
		return
	}
	numCommands := msh.GetNumRunningCommands()
	if numCommands > 0 && !force {
		msh.WriteToPtyBuffer("remote not disconnected, has %d running commands.  use force=1 to force disconnection\n", numCommands)
		return
	}
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	if msh.ServerProc != nil {
		msh.ServerProc.Close()
	}
	if msh.MakeClientCancelFn != nil {
		msh.MakeClientCancelFn()
		msh.MakeClientCancelFn = nil
	}
}

func (msh *MShellProc) CancelInstall() {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	if msh.InstallCancelFn != nil {
		msh.InstallCancelFn()
		msh.InstallCancelFn = nil
	}
}

func (msh *MShellProc) GetRemoteName() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Remote.GetName()
}

func (msh *MShellProc) WriteToPtyBuffer(strFmt string, args ...interface{}) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	msh.writeToPtyBuffer_nolock(strFmt, args...)
}

func (msh *MShellProc) writeToPtyBuffer_nolock(strFmt string, args ...interface{}) {
	// inefficient string manipulation here and read of PtyBuffer, but these messages are rare, nbd
	realStr := fmt.Sprintf(strFmt, args...)
	if !strings.HasPrefix(realStr, "~") {
		realStr = strings.ReplaceAll(realStr, "\n", "\r\n")
		if !strings.HasSuffix(realStr, "\r\n") {
			realStr = realStr + "\r\n"
		}
		if strings.HasPrefix(realStr, "*") {
			realStr = "\033[0m\033[31mprompt>\033[0m " + realStr[1:]
		} else {
			realStr = "\033[0m\033[32mprompt>\033[0m " + realStr
		}
		barr := msh.PtyBuffer.Bytes()
		if len(barr) > 0 && barr[len(barr)-1] != '\n' {
			realStr = "\r\n" + realStr
		}
	} else {
		realStr = realStr[1:]
	}
	curOffset := msh.PtyBuffer.TotalWritten()
	data := []byte(realStr)
	msh.PtyBuffer.Write(data)
	sendRemotePtyUpdate(msh.Remote.RemoteId, curOffset, data)
}

func sendRemotePtyUpdate(remoteId string, dataOffset int64, data []byte) {
	data64 := base64.StdEncoding.EncodeToString(data)
	update := &sstore.PtyDataUpdate{
		RemoteId:   remoteId,
		PtyPos:     dataOffset,
		PtyData64:  data64,
		PtyDataLen: int64(len(data)),
	}
	sstore.MainBus.SendUpdate(update)
}

func (msh *MShellProc) isWaitingForPassword_nolock() bool {
	barr := msh.PtyBuffer.Bytes()
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

func (msh *MShellProc) isWaitingForPassphrase_nolock() bool {
	barr := msh.PtyBuffer.Bytes()
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

func (msh *MShellProc) RunPtyReadLoop(cmdPty *os.File) {
	buf := make([]byte, PtyReadBufSize)
	var isWaiting bool
	for {
		n, readErr := cmdPty.Read(buf)
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			msh.WriteToPtyBuffer("*error reading from controlling-pty: %v\n", readErr)
			break
		}
		var newIsWaiting bool
		msh.WithLock(func() {
			curOffset := msh.PtyBuffer.TotalWritten()
			msh.PtyBuffer.Write(buf[0:n])
			sendRemotePtyUpdate(msh.Remote.RemoteId, curOffset, buf[0:n])
			newIsWaiting = msh.isWaitingForPassword_nolock()
		})
		if newIsWaiting != isWaiting {
			isWaiting = newIsWaiting
			go msh.NotifyRemoteUpdate()
		}
	}
}

func (msh *MShellProc) WaitAndSendPassword(pw string) {
	var numWaits int
	for {
		var isWaiting bool
		var isConnecting bool
		msh.WithLock(func() {
			if msh.Remote.SSHOpts.GetAuthType() == sstore.RemoteAuthTypeKeyPassword {
				isWaiting = msh.isWaitingForPassphrase_nolock()
			} else {
				isWaiting = msh.isWaitingForPassword_nolock()
			}
			isConnecting = msh.Status == StatusConnecting
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
			msh.WithLock(func() {
				if msh.ControllingPty == nil {
					return
				}
				pwBytes := []byte(pw + "\r")
				msh.writeToPtyBuffer_nolock("~[sent password]\r\n")
				_, err := msh.ControllingPty.Write(pwBytes)
				if err != nil {
					msh.writeToPtyBuffer_nolock("*cannot write password to controlling pty: %v\n", err)
				}
			})
			break
		}
	}
}

func (msh *MShellProc) RunInstall() {
	remoteCopy := msh.GetRemoteCopy()
	if remoteCopy.Archived {
		msh.WriteToPtyBuffer("*error: cannot install on archived remote\n")
		return
	}
	baseStatus := msh.GetStatus()
	if baseStatus == StatusConnecting || baseStatus == StatusConnected {
		msh.WriteToPtyBuffer("*error: cannot install on remote that is connected/connecting, disconnect to install\n")
		return
	}
	curStatus := msh.GetInstallStatus()
	if curStatus == StatusConnecting {
		msh.WriteToPtyBuffer("*error: cannot install on remote that is already trying to install, cancel current install to try again\n")
		return
	}
	sapi, err := shellapi.MakeShellApi(packet.ShellType_bash)
	if err != nil {
		msh.WriteToPtyBuffer("*error: %v\n", err)
		return
	}
	msh.WriteToPtyBuffer("installing mshell %s to %s...\n", scbase.MShellVersion, remoteCopy.RemoteCanonicalName)
	sshOpts := convertSSHOpts(remoteCopy.SSHOpts)
	sshOpts.SSHErrorsToTty = true
	cmdStr := shexec.MakeInstallCommandStr()
	ecmd := sshOpts.MakeSSHExecCmd(cmdStr, sapi)
	cmdPty, err := msh.addControllingTty(ecmd)
	if err != nil {
		statusErr := fmt.Errorf("cannot attach controlling tty to mshell install command: %w", err)
		msh.setInstallErrorStatus(statusErr)
		return
	}
	defer func() {
		if len(ecmd.ExtraFiles) > 0 {
			ecmd.ExtraFiles[len(ecmd.ExtraFiles)-1].Close()
		}
		cmdPty.Close()
	}()
	go msh.RunPtyReadLoop(cmdPty)
	clientCtx, clientCancelFn := context.WithCancel(context.Background())
	defer clientCancelFn()
	msh.WithLock(func() {
		msh.InstallErr = nil
		msh.InstallStatus = StatusConnecting
		msh.InstallCancelFn = clientCancelFn
		go msh.NotifyRemoteUpdate()
	})
	msgFn := func(msg string) {
		msh.WriteToPtyBuffer("%s", msg)
	}
	err = shexec.RunInstallFromCmd(clientCtx, ecmd, true, nil, scbase.MShellBinaryReader, msgFn)
	if err == context.Canceled {
		msh.WriteToPtyBuffer("*install canceled\n")
		msh.WithLock(func() {
			msh.InstallStatus = StatusDisconnected
			go msh.NotifyRemoteUpdate()
		})
		return
	}
	if err != nil {
		statusErr := fmt.Errorf("install failed: %w", err)
		msh.setInstallErrorStatus(statusErr)
		return
	}
	var connectMode string
	msh.WithLock(func() {
		msh.InstallStatus = StatusDisconnected
		msh.InstallCancelFn = nil
		msh.NeedsMShellUpgrade = false
		msh.Status = StatusDisconnected
		msh.Err = nil
		connectMode = msh.Remote.ConnectMode
	})
	msh.WriteToPtyBuffer("successfully installed mshell %s to ~/.mshell\n", scbase.MShellVersion)
	go msh.NotifyRemoteUpdate()
	if connectMode == sstore.ConnectModeStartup || connectMode == sstore.ConnectModeAuto {
		// the install was successful, and we don't have a manual connect mode, try to connect
		go msh.Launch(true)
	}
	return
}

func (msh *MShellProc) updateRemoteStateVars(ctx context.Context, remoteId string, initPk *packet.InitPacketType) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	stateVars := getStateVarsFromInitPk(initPk)
	if stateVars == nil {
		return
	}
	msh.Remote.StateVars = stateVars
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

func makeReinitErrorUpdate(shellType string) sstore.ActivityUpdate {
	rtn := sstore.ActivityUpdate{}
	if shellType == packet.ShellType_bash {
		rtn.ReinitBashErrors = 1
	} else if shellType == packet.ShellType_zsh {
		rtn.ReinitZshErrors = 1
	}
	return rtn
}

func (msh *MShellProc) ReInit(ctx context.Context, shellType string) (*packet.ShellStatePacketType, error) {
	if !msh.IsConnected() {
		return nil, fmt.Errorf("cannot reinit, remote is not connected")
	}
	if shellType != packet.ShellType_bash && shellType != packet.ShellType_zsh {
		return nil, fmt.Errorf("invalid shell type %q", shellType)
	}
	reinitPk := packet.MakeReInitPacket()
	reinitPk.ReqId = uuid.New().String()
	reinitPk.ShellType = shellType
	resp, err := msh.PacketRpcRaw(ctx, reinitPk)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("no response")
	}
	ssPk, ok := resp.(*packet.ShellStatePacketType)
	if !ok {
		sstore.UpdateActivityWrap(ctx, makeReinitErrorUpdate(shellType), "reiniterror")
		if respPk, ok := resp.(*packet.ResponsePacketType); ok && respPk.Error != "" {
			return nil, fmt.Errorf("error reinitializing remote: %s", respPk.Error)
		}
		return nil, fmt.Errorf("invalid reinit response (not an shellstate packet): %T", resp)
	}
	if ssPk.State == nil {
		sstore.UpdateActivityWrap(ctx, makeReinitErrorUpdate(shellType), "reiniterror")
		return nil, fmt.Errorf("invalid reinit response shellstate packet does not contain remote state")
	}
	// TODO: maybe we don't need to save statebase here.  should be possible to save it on demand
	//    when it is actually used.  complication from other functions that try to get the statebase
	//    from the DB.  probably need to route those through MShellProc.
	err = sstore.StoreStateBase(ctx, ssPk.State)
	if err != nil {
		return nil, fmt.Errorf("error storing remote state: %w", err)
	}
	msh.StateMap.SetCurrentState(ssPk.State.GetShellType(), ssPk.State)
	msh.WriteToPtyBuffer("initialized shell:%s state:%s\n", shellType, ssPk.State.GetHashVal(false))
	return ssPk, nil
}

func (msh *MShellProc) StreamFile(ctx context.Context, streamPk *packet.StreamFilePacketType) (*packet.RpcResponseIter, error) {
	return msh.PacketRpcIter(ctx, streamPk)
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

func (msh *MShellProc) getActiveShellTypes(ctx context.Context) ([]string, error) {
	shellPref := msh.GetShellPref()
	rtn := []string{shellPref}
	activeShells, err := sstore.GetRemoteActiveShells(ctx, msh.RemoteId)
	if err != nil {
		return nil, err
	}
	return utilfn.CombineStrArrays(rtn, activeShells), nil
}

// for conditional launch method based on ssh library in use
// remove once ssh library is stabilized
type NewLauncher struct{}

// func (msh *MShellProc) LaunchNew(interactive bool) {
func (NewLauncher) Launch(msh *MShellProc, interactive bool) {
	remoteCopy := msh.GetRemoteCopy()
	if remoteCopy.Archived {
		msh.WriteToPtyBuffer("cannot launch archived remote\n")
		return
	}
	curStatus := msh.GetStatus()
	if curStatus == StatusConnected {
		msh.WriteToPtyBuffer("remote is already connected (no action taken)\n")
		return
	}
	if curStatus == StatusConnecting {
		msh.WriteToPtyBuffer("remote is already connecting, disconnect before trying to connect again\n")
		return
	}
	sapi, err := shellapi.MakeShellApi(msh.GetShellType())
	if err != nil {
		msh.WriteToPtyBuffer("*error, %v\n", err)
		return
	}
	istatus := msh.GetInstallStatus()
	if istatus == StatusConnecting {
		msh.WriteToPtyBuffer("remote is trying to install, cancel install before trying to connect again\n")
		return
	}
	if remoteCopy.SSHOpts.SSHPort != 0 && remoteCopy.SSHOpts.SSHPort != 22 {
		msh.WriteToPtyBuffer("connecting to %s (port %d)...\n", remoteCopy.RemoteCanonicalName, remoteCopy.SSHOpts.SSHPort)
	} else {
		msh.WriteToPtyBuffer("connecting to %s...\n", remoteCopy.RemoteCanonicalName)
	}
	sshOpts := convertSSHOpts(remoteCopy.SSHOpts)
	sshOpts.SSHErrorsToTty = true
	if remoteCopy.ConnectMode != sstore.ConnectModeManual && remoteCopy.SSHOpts.SSHPassword == "" && !interactive {
		sshOpts.BatchMode = true
	}
	makeClientCtx, makeClientCancelFn := context.WithCancel(context.Background())
	defer makeClientCancelFn()
	msh.WithLock(func() {
		msh.Err = nil
		msh.ErrNoInitPk = false
		msh.Status = StatusConnecting
		msh.MakeClientCancelFn = makeClientCancelFn
		deadlineTime := time.Now().Add(RemoteConnectTimeout)
		msh.MakeClientDeadline = &deadlineTime
		go msh.NotifyRemoteUpdate()
	})
	go msh.watchClientDeadlineTime()
	var cmdStr string
	var cproc *shexec.ClientProc
	var initPk *packet.InitPacketType
	if sshOpts.SSHHost == "" && remoteCopy.Local {
		cmdStr, err = MakeLocalMShellCommandStr(remoteCopy.IsSudo())
		if err != nil {
			msh.WriteToPtyBuffer("*error, cannot find local mshell binary: %v\n", err)
			return
		}
		ecmd := sshOpts.MakeSSHExecCmd(cmdStr, sapi)
		var cmdPty *os.File
		cmdPty, err = msh.addControllingTty(ecmd)
		if err != nil {
			statusErr := fmt.Errorf("cannot attach controlling tty to mshell command: %w", err)
			msh.WriteToPtyBuffer("*error, %s\n", statusErr.Error())
			msh.setErrorStatus(statusErr)
			return
		}
		defer func() {
			if len(ecmd.ExtraFiles) > 0 {
				ecmd.ExtraFiles[len(ecmd.ExtraFiles)-1].Close()
			}
		}()
		go msh.RunPtyReadLoop(cmdPty)
		if remoteCopy.SSHOpts.SSHPassword != "" {
			go msh.WaitAndSendPassword(remoteCopy.SSHOpts.SSHPassword)
		}
		cproc, initPk, err = shexec.MakeClientProc(makeClientCtx, shexec.CmdWrap{Cmd: ecmd})
	} else {
		var client *ssh.Client
		client, err = ConnectToClient(remoteCopy.SSHOpts)
		if err != nil {
			statusErr := fmt.Errorf("ssh cannot connect to client: %w", err)
			msh.WriteToPtyBuffer("*error, %s\n", statusErr.Error())
			msh.setErrorStatus(statusErr)
			return
		}
		var session *ssh.Session
		session, err = client.NewSession()
		if err != nil {
			statusErr := fmt.Errorf("ssh cannot create session: %w", err)
			msh.WriteToPtyBuffer("*error, %s\n", statusErr.Error())
			msh.setErrorStatus(statusErr)
			return
		}
		cproc, initPk, err = shexec.MakeClientProc(makeClientCtx, shexec.SessionWrap{Session: session, StartCmd: MakeServerRunOnlyCommandStr()})
	}
	// TODO check if initPk.State is not nil
	var mshellVersion string
	var hitDeadline bool
	msh.WithLock(func() {
		msh.MakeClientCancelFn = nil
		if time.Now().After(*msh.MakeClientDeadline) {
			hitDeadline = true
		}
		msh.MakeClientDeadline = nil
		if initPk == nil {
			msh.ErrNoInitPk = true
		}
		if initPk != nil {
			msh.UName = initPk.UName
			mshellVersion = initPk.Version
			if semver.Compare(mshellVersion, scbase.MShellVersion) < 0 {
				// only set NeedsMShellUpgrade if we got an InitPk
				msh.NeedsMShellUpgrade = true
			}
			msh.InitPkShellType = initPk.Shell
		}
		msh.StateMap.Clear()
		// no notify here, because we'll call notify in either case below
	})
	if err == context.Canceled {
		if hitDeadline {
			msh.WriteToPtyBuffer("*connect timeout\n")
			msh.setErrorStatus(errors.New("connect timeout"))
		} else {
			msh.WriteToPtyBuffer("*forced disconnection\n")
			msh.WithLock(func() {
				msh.Status = StatusDisconnected
				go msh.NotifyRemoteUpdate()
			})
		}
		return
	}
	if err == nil && semver.MajorMinor(mshellVersion) != semver.MajorMinor(scbase.MShellVersion) {
		err = fmt.Errorf("mshell version is not compatible current=%s remote=%s", scbase.MShellVersion, mshellVersion)
	}
	if err != nil {
		msh.setErrorStatus(err)
		msh.WriteToPtyBuffer("*error connecting to remote: %v\n", err)
		go msh.tryAutoInstall()
		return
	}
	msh.updateRemoteStateVars(context.Background(), msh.RemoteId, initPk)
	msh.WithLock(func() {
		msh.ServerProc = cproc
		msh.Status = StatusConnected
	})
	go func() {
		exitErr := cproc.Cmd.Wait()
		exitCode := shexec.GetExitCode(exitErr)
		msh.WithLock(func() {
			if msh.Status == StatusConnected || msh.Status == StatusConnecting {
				msh.Status = StatusDisconnected
				go msh.NotifyRemoteUpdate()
			}
		})
		msh.WriteToPtyBuffer("*disconnected exitcode=%d\n", exitCode)
	}()
	go msh.ProcessPackets()
	msh.initActiveShells()
	go msh.NotifyRemoteUpdate()
	return
}

// for conditional launch method based on ssh library in use
// remove once ssh library is stabilized
type LegacyLauncher struct{}

// func (msh *MShellProc) LaunchLegacy(interactive bool) {
func (LegacyLauncher) Launch(msh *MShellProc, interactive bool) {
	remoteCopy := msh.GetRemoteCopy()
	if remoteCopy.Archived {
		msh.WriteToPtyBuffer("cannot launch archived remote\n")
		return
	}
	curStatus := msh.GetStatus()
	if curStatus == StatusConnected {
		msh.WriteToPtyBuffer("remote is already connected (no action taken)\n")
		return
	}
	if curStatus == StatusConnecting {
		msh.WriteToPtyBuffer("remote is already connecting, disconnect before trying to connect again\n")
		return
	}
	sapi, err := shellapi.MakeShellApi(msh.GetShellType())
	if err != nil {
		msh.WriteToPtyBuffer("*error, %v\n", err)
		return
	}
	istatus := msh.GetInstallStatus()
	if istatus == StatusConnecting {
		msh.WriteToPtyBuffer("remote is trying to install, cancel install before trying to connect again\n")
		return
	}
	if remoteCopy.SSHOpts.SSHPort != 0 && remoteCopy.SSHOpts.SSHPort != 22 {
		msh.WriteToPtyBuffer("connecting to %s (port %d)...\n", remoteCopy.RemoteCanonicalName, remoteCopy.SSHOpts.SSHPort)
	} else {
		msh.WriteToPtyBuffer("connecting to %s...\n", remoteCopy.RemoteCanonicalName)
	}
	sshOpts := convertSSHOpts(remoteCopy.SSHOpts)
	sshOpts.SSHErrorsToTty = true
	if remoteCopy.ConnectMode != sstore.ConnectModeManual && remoteCopy.SSHOpts.SSHPassword == "" && !interactive {
		sshOpts.BatchMode = true
	}
	var cmdStr string
	if sshOpts.SSHHost == "" && remoteCopy.Local {
		var err error
		cmdStr, err = MakeLocalMShellCommandStr(remoteCopy.IsSudo())
		if err != nil {
			msh.WriteToPtyBuffer("*error, cannot find local mshell binary: %v\n", err)
			return
		}
	} else {
		cmdStr = MakeServerCommandStr()
	}
	ecmd := sshOpts.MakeSSHExecCmd(cmdStr, sapi)
	cmdPty, err := msh.addControllingTty(ecmd)
	if err != nil {
		statusErr := fmt.Errorf("cannot attach controlling tty to mshell command: %w", err)
		msh.WriteToPtyBuffer("*error, %s\n", statusErr.Error())
		msh.setErrorStatus(statusErr)
		return
	}
	defer func() {
		if len(ecmd.ExtraFiles) > 0 {
			ecmd.ExtraFiles[len(ecmd.ExtraFiles)-1].Close()
		}
	}()
	go msh.RunPtyReadLoop(cmdPty)
	if remoteCopy.SSHOpts.SSHPassword != "" {
		go msh.WaitAndSendPassword(remoteCopy.SSHOpts.SSHPassword)
	}
	makeClientCtx, makeClientCancelFn := context.WithCancel(context.Background())
	defer makeClientCancelFn()
	msh.WithLock(func() {
		msh.Err = nil
		msh.ErrNoInitPk = false
		msh.Status = StatusConnecting
		msh.MakeClientCancelFn = makeClientCancelFn
		deadlineTime := time.Now().Add(RemoteConnectTimeout)
		msh.MakeClientDeadline = &deadlineTime
		go msh.NotifyRemoteUpdate()
	})
	go msh.watchClientDeadlineTime()
	cproc, initPk, err := shexec.MakeClientProc(makeClientCtx, shexec.CmdWrap{Cmd: ecmd})
	// TODO check if initPk.State is not nil
	var mshellVersion string
	var hitDeadline bool
	msh.WithLock(func() {
		msh.MakeClientCancelFn = nil
		if time.Now().After(*msh.MakeClientDeadline) {
			hitDeadline = true
		}
		msh.MakeClientDeadline = nil
		if initPk == nil {
			msh.ErrNoInitPk = true
		}
		if initPk != nil {
			msh.UName = initPk.UName
			mshellVersion = initPk.Version
			if semver.Compare(mshellVersion, scbase.MShellVersion) < 0 {
				// only set NeedsMShellUpgrade if we got an InitPk
				msh.NeedsMShellUpgrade = true
			}
			msh.InitPkShellType = initPk.Shell
		}
		msh.StateMap.Clear()
		// no notify here, because we'll call notify in either case below
	})
	if err == context.Canceled {
		if hitDeadline {
			msh.WriteToPtyBuffer("*connect timeout\n")
			msh.setErrorStatus(errors.New("connect timeout"))
		} else {
			msh.WriteToPtyBuffer("*forced disconnection\n")
			msh.WithLock(func() {
				msh.Status = StatusDisconnected
				go msh.NotifyRemoteUpdate()
			})
		}
		return
	}
	if err == nil && semver.MajorMinor(mshellVersion) != semver.MajorMinor(scbase.MShellVersion) {
		err = fmt.Errorf("mshell version is not compatible current=%s remote=%s", scbase.MShellVersion, mshellVersion)
	}
	if err != nil {
		msh.setErrorStatus(err)
		msh.WriteToPtyBuffer("*error connecting to remote: %v\n", err)
		go msh.tryAutoInstall()
		return
	}
	msh.updateRemoteStateVars(context.Background(), msh.RemoteId, initPk)
	msh.WithLock(func() {
		msh.ServerProc = cproc
		msh.Status = StatusConnected
	})
	go func() {
		exitErr := cproc.Cmd.Wait()
		exitCode := shexec.GetExitCode(exitErr)
		msh.WithLock(func() {
			if msh.Status == StatusConnected || msh.Status == StatusConnecting {
				msh.Status = StatusDisconnected
				go msh.NotifyRemoteUpdate()
			}
		})
		msh.WriteToPtyBuffer("*disconnected exitcode=%d\n", exitCode)
	}()
	go msh.ProcessPackets()
	msh.initActiveShells()
	go msh.NotifyRemoteUpdate()
	return
}

func (msh *MShellProc) initActiveShells() {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	activeShells, err := msh.getActiveShellTypes(ctx)
	if err != nil {
		// we're not going to fail the connect for this error (it will be unusable, but technically connected)
		msh.WriteToPtyBuffer("*error getting active shells: %v\n", err)
		return
	}
	for _, shellType := range activeShells {
		_, err = msh.ReInit(ctx, shellType)
		if err != nil {
			msh.WriteToPtyBuffer("*error reiniting shell %q: %v\n", shellType, err)
		}
	}
}

func (msh *MShellProc) IsConnected() bool {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Status == StatusConnected
}

func (msh *MShellProc) GetShellType() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.InitPkShellType
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

func (msh *MShellProc) IsCmdRunning(ck base.CommandKey) bool {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	_, ok := msh.RunningCmds[ck]
	return ok
}

func (msh *MShellProc) SendInput(dataPk *packet.DataPacketType) error {
	if !msh.IsConnected() {
		return fmt.Errorf("remote is not connected, cannot send input")
	}
	if !msh.IsCmdRunning(dataPk.CK) {
		return fmt.Errorf("cannot send input, cmd is not running")
	}
	return msh.ServerProc.Input.SendPacket(dataPk)
}

func (msh *MShellProc) KillRunningCommandAndWait(ctx context.Context, ck base.CommandKey) error {
	if !msh.IsCmdRunning(ck) {
		return nil
	}
	siPk := packet.MakeSpecialInputPacket()
	siPk.CK = ck
	siPk.SigName = "SIGTERM"
	err := msh.SendSpecialInput(siPk)
	if err != nil {
		return fmt.Errorf("error trying to kill running cmd: %w", err)
	}
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !msh.IsCmdRunning(ck) {
			return nil
		}
		// TODO fix busy wait (sync with msh.RunningCmds)
		// not a huge deal though since this is not processor intensive and not widely used
		time.Sleep(100 * time.Millisecond)
	}
}

func (msh *MShellProc) SendSpecialInput(siPk *packet.SpecialInputPacketType) error {
	if !msh.IsConnected() {
		return fmt.Errorf("remote is not connected, cannot send input")
	}
	if !msh.IsCmdRunning(siPk.CK) {
		return fmt.Errorf("cannot send input, cmd is not running")
	}
	return msh.ServerProc.Input.SendPacket(siPk)
}

func (msh *MShellProc) SendFileData(dataPk *packet.FileDataPacketType) error {
	if !msh.IsConnected() {
		return fmt.Errorf("remote is not connected, cannot send input")
	}
	return msh.ServerProc.Input.SendPacket(dataPk)
}

func makeTermOpts(runPk *packet.RunPacketType) sstore.TermOpts {
	return sstore.TermOpts{Rows: int64(runPk.TermOpts.Rows), Cols: int64(runPk.TermOpts.Cols), FlexRows: runPk.TermOpts.FlexRows, MaxPtySize: DefaultMaxPtySize}
}

// returns (ok, currentPSC)
func (msh *MShellProc) testAndSetPendingStateCmd(screenId string, rptr sstore.RemotePtrType, newCK *base.CommandKey) (bool, *base.CommandKey) {
	key := pendingStateKey{ScreenId: screenId, RemotePtr: rptr}
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	ck, found := msh.PendingStateCmds[key]
	if found {
		return false, &ck
	}
	if newCK != nil {
		msh.PendingStateCmds[key] = *newCK
	}
	return true, nil
}

func (msh *MShellProc) removePendingStateCmd(screenId string, rptr sstore.RemotePtrType, ck base.CommandKey) {
	key := pendingStateKey{ScreenId: screenId, RemotePtr: rptr}
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	existingCK, found := msh.PendingStateCmds[key]
	if !found {
		return
	}
	if existingCK == ck {
		delete(msh.PendingStateCmds, key)
	}
}

type RunCommandOpts struct {
	SessionId string
	ScreenId  string
	RemotePtr sstore.RemotePtrType

	// optional, if not provided shellstate will look up state from remote instance
	// ReturnState cannot be used with StatePtr
	// this will also cause this command to bypass the pending state cmd logic
	StatePtr *sstore.ShellStatePtr

	// set to true to skip creating the pty file (for restarted commands)
	NoCreateCmdPtyFile bool
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
	msh := GetRemoteById(remotePtr.RemoteId)
	if msh == nil {
		return nil, nil, fmt.Errorf("no remote id=%s found", remotePtr.RemoteId)
	}
	if !msh.IsConnected() {
		return nil, nil, fmt.Errorf("remote '%s' is not connected", remotePtr.RemoteId)
	}
	if runPacket.State != nil {
		return nil, nil, fmt.Errorf("runPacket.State should not be set, it is set in RunCommand")
	}
	if rcOpts.StatePtr != nil && runPacket.ReturnState {
		return nil, nil, fmt.Errorf("RunCommand: cannot use ReturnState with StatePtr")
	}

	// pending state command logic
	// if we are currently running a command that can change the state, we need to wait for it to finish
	if rcOpts.StatePtr == nil {
		var newPSC *base.CommandKey
		if runPacket.ReturnState {
			newPSC = &runPacket.CK
		}
		ok, existingPSC := msh.testAndSetPendingStateCmd(screenId, remotePtr, newPSC)
		if !ok {
			line, _, err := sstore.GetLineCmdByLineId(ctx, screenId, existingPSC.GetCmdId())
			if err != nil {
				return nil, nil, fmt.Errorf("cannot run command while a stateful command is still running: %v", err)
			}
			if line == nil {
				return nil, nil, fmt.Errorf("cannot run command while a stateful command is still running %s", *existingPSC)
			}
			return nil, nil, fmt.Errorf("cannot run command while a stateful command (linenum=%d) is still running", line.LineNum)
		}
		if newPSC != nil {
			defer func() {
				// if we get an error, remove the pending state cmd
				// if no error, PSC will get removed when we see a CmdDone or CmdFinal packet
				if rtnErr != nil {
					msh.removePendingStateCmd(screenId, remotePtr, *newPSC)
				}
			}()
		}
	}

	// get current remote-instance state
	var statePtr *sstore.ShellStatePtr
	if rcOpts.StatePtr != nil {
		statePtr = rcOpts.StatePtr
	} else {
		var err error
		statePtr, err = sstore.GetRemoteStatePtr(ctx, sessionId, screenId, remotePtr)
		if err != nil {
			return nil, nil, fmt.Errorf("cannot get current connection stateptr: %w", err)
		}
	}
	if statePtr == nil { // can be null if there is no remote-instance (screen has unchanged state from default)
		err := msh.EnsureShellType(ctx, msh.GetShellPref()) // make sure shellType is initialized
		if err != nil {
			return nil, nil, err
		}
		statePtr = msh.GetDefaultStatePtr(msh.GetShellPref())
		if statePtr == nil {
			return nil, nil, fmt.Errorf("cannot run command, no valid connection stateptr")
		}
	}
	currentState, err := sstore.GetFullState(ctx, *statePtr)
	if err != nil || currentState == nil {
		return nil, nil, fmt.Errorf("cannot load current remote state: %w", err)
	}
	runPacket.State = addScVarsToState(currentState)
	runPacket.StateComplete = true
	runPacket.ShellType = currentState.GetShellType()
	err = msh.EnsureShellType(ctx, runPacket.ShellType) // make sure shellType is initialized
	if err != nil {
		return nil, nil, err
	}

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

	// RegisterRpc + WaitForResponse is used to get any waveshell side errors
	// waveshell will either return an error (in a ResponsePacketType) or a CmdStartPacketType
	msh.ServerProc.Output.RegisterRpc(runPacket.ReqId)
	err = shexec.SendRunPacketAndRunData(ctx, msh.ServerProc.Input, runPacket)
	if err != nil {
		return nil, nil, fmt.Errorf("sending run packet to remote: %w", err)
	}
	rtnPk := msh.ServerProc.Output.WaitForResponse(ctx, runPacket.ReqId)
	if rtnPk == nil {
		return nil, nil, ctx.Err()
	}
	startPk, ok := rtnPk.(*packet.CmdStartPacketType)
	if !ok {
		respPk, ok := rtnPk.(*packet.ResponsePacketType)
		if !ok {
			return nil, nil, fmt.Errorf("invalid response received from server for run packet: %s", packet.AsString(rtnPk))
		}
		if respPk.Error != "" {
			return nil, nil, errors.New(respPk.Error)
		}
		return nil, nil, fmt.Errorf("invalid response received from server for run packet: %s", packet.AsString(rtnPk))
	}

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
		CmdPid:     startPk.Pid,
		RemotePid:  startPk.MShellPid,
		ExitCode:   0,
		DurationMs: 0,
		RunOut:     nil,
		RtnState:   runPacket.ReturnState,
	}
	if !rcOpts.NoCreateCmdPtyFile {
		err = sstore.CreateCmdPtyFile(ctx, cmd.ScreenId, cmd.LineId, cmd.TermOpts.MaxPtySize)
		if err != nil {
			// TODO the cmd is running, so this is a tricky error to handle
			return nil, nil, fmt.Errorf("cannot create local ptyout file for running command: %v", err)
		}
	}
	msh.AddRunningCmd(RunCmdType{
		SessionId: sessionId,
		ScreenId:  screenId,
		RemotePtr: remotePtr,
		RunPacket: runPacket,
	})

	go pushNumRunningCmdsUpdate(&runPacket.CK, 1)
	return cmd, func() { removeCmdWait(runPacket.CK) }, nil
}

func (msh *MShellProc) AddRunningCmd(rct RunCmdType) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	msh.RunningCmds[rct.RunPacket.CK] = rct
}

func (msh *MShellProc) GetRunningCmd(ck base.CommandKey) *RunCmdType {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	rct, found := msh.RunningCmds[ck]
	if !found {
		return nil
	}
	return &rct
}

func (msh *MShellProc) RemoveRunningCmd(ck base.CommandKey) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	delete(msh.RunningCmds, ck)
	for key, pendingCk := range msh.PendingStateCmds {
		if pendingCk == ck {
			delete(msh.PendingStateCmds, key)
		}
	}
}

func (msh *MShellProc) PacketRpcIter(ctx context.Context, pk packet.RpcPacketType) (*packet.RpcResponseIter, error) {
	if !msh.IsConnected() {
		return nil, fmt.Errorf("remote is not connected")
	}
	if pk == nil {
		return nil, fmt.Errorf("PacketRpc passed nil packet")
	}
	reqId := pk.GetReqId()
	msh.ServerProc.Output.RegisterRpc(reqId)
	err := msh.ServerProc.Input.SendPacketCtx(ctx, pk)
	if err != nil {
		return nil, err
	}
	return msh.ServerProc.Output.GetResponseIter(reqId), nil
}

func (msh *MShellProc) PacketRpcRaw(ctx context.Context, pk packet.RpcPacketType) (packet.RpcResponsePacketType, error) {
	if !msh.IsConnected() {
		return nil, fmt.Errorf("remote is not connected")
	}
	if pk == nil {
		return nil, fmt.Errorf("PacketRpc passed nil packet")
	}
	reqId := pk.GetReqId()
	msh.ServerProc.Output.RegisterRpc(reqId)
	defer msh.ServerProc.Output.UnRegisterRpc(reqId)
	err := msh.ServerProc.Input.SendPacketCtx(ctx, pk)
	if err != nil {
		return nil, err
	}
	rtnPk := msh.ServerProc.Output.WaitForResponse(ctx, reqId)
	if rtnPk == nil {
		return nil, ctx.Err()
	}
	return rtnPk, nil
}

func (msh *MShellProc) PacketRpc(ctx context.Context, pk packet.RpcPacketType) (*packet.ResponsePacketType, error) {
	rtnPk, err := msh.PacketRpcRaw(ctx, pk)
	if err != nil {
		return nil, err
	}
	if respPk, ok := rtnPk.(*packet.ResponsePacketType); ok {
		return respPk, nil
	}
	return nil, fmt.Errorf("invalid response packet received: %s", packet.AsString(rtnPk))
}

func (msh *MShellProc) WithLock(fn func()) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
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

func (msh *MShellProc) notifyHangups_nolock() {
	for ck := range msh.RunningCmds {
		cmd, err := sstore.GetCmdByScreenId(context.Background(), ck.GetGroupId(), ck.GetCmdId())
		if err != nil {
			continue
		}
		update := &sstore.ModelUpdate{Cmd: cmd}
		sstore.MainBus.SendScreenUpdate(ck.GetGroupId(), update)
		go pushNumRunningCmdsUpdate(&ck, -1)
	}
	msh.RunningCmds = make(map[base.CommandKey]RunCmdType)
	msh.PendingStateCmds = make(map[pendingStateKey]base.CommandKey)
}

func (msh *MShellProc) handleCmdDonePacket(donePk *packet.CmdDonePacketType) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	// this will remove from RunningCmds and from PendingStateCmds
	defer msh.RemoveRunningCmd(donePk.CK)
	if donePk.FinalState != nil {
		donePk.FinalState = stripScVarsFromState(donePk.FinalState)
	}
	if donePk.FinalStateDiff != nil {
		donePk.FinalStateDiff = stripScVarsFromStateDiff(donePk.FinalStateDiff)
	}
	update, err := sstore.UpdateCmdDoneInfo(ctx, donePk.CK, donePk, sstore.CmdStatusDone)
	if err != nil {
		msh.WriteToPtyBuffer("*error updating cmddone: %v\n", err)
		return
	}
	screen, err := sstore.UpdateScreenFocusForDoneCmd(ctx, donePk.CK.GetGroupId(), donePk.CK.GetCmdId())
	if err != nil {
		msh.WriteToPtyBuffer("*error trying to update screen focus type: %v\n", err)
		// fall-through (nothing to do)
	}
	if screen != nil {
		update.Screens = []*sstore.ScreenType{screen}
	}
	rct := msh.GetRunningCmd(donePk.CK)
	var statePtr *sstore.ShellStatePtr
	if donePk.FinalState != nil && rct != nil {
		feState := sstore.FeStateFromShellState(donePk.FinalState)
		remoteInst, err := sstore.UpdateRemoteState(ctx, rct.SessionId, rct.ScreenId, rct.RemotePtr, feState, donePk.FinalState, nil)
		if err != nil {
			msh.WriteToPtyBuffer("*error trying to update remotestate: %v\n", err)
			// fall-through (nothing to do)
		}
		if remoteInst != nil {
			update.Sessions = sstore.MakeSessionsUpdateForRemote(rct.SessionId, remoteInst)
		}
		statePtr = &sstore.ShellStatePtr{BaseHash: donePk.FinalState.GetHashVal(false)}
	} else if donePk.FinalStateDiff != nil && rct != nil {
		feState, err := msh.getFeStateFromDiff(donePk.FinalStateDiff)
		if err != nil {
			msh.WriteToPtyBuffer("*error trying to update remotestate: %v\n", err)
			// fall-through (nothing to do)
		} else {
			stateDiff := donePk.FinalStateDiff
			fullState := msh.StateMap.GetStateByHash(stateDiff.GetShellType(), stateDiff.BaseHash)
			if fullState != nil {
				sstore.StoreStateBase(ctx, fullState)
			}
			remoteInst, err := sstore.UpdateRemoteState(ctx, rct.SessionId, rct.ScreenId, rct.RemotePtr, feState, nil, stateDiff)
			if err != nil {
				msh.WriteToPtyBuffer("*error trying to update remotestate: %v\n", err)
				// fall-through (nothing to do)
			}
			if remoteInst != nil {
				update.Sessions = sstore.MakeSessionsUpdateForRemote(rct.SessionId, remoteInst)
			}
			diffHashArr := append(([]string)(nil), donePk.FinalStateDiff.DiffHashArr...)
			diffHashArr = append(diffHashArr, donePk.FinalStateDiff.GetHashVal(false))
			statePtr = &sstore.ShellStatePtr{BaseHash: donePk.FinalStateDiff.BaseHash, DiffHashArr: diffHashArr}
		}
	}
	if statePtr != nil {
		err = sstore.UpdateCmdRtnState(ctx, donePk.CK, *statePtr)
		if err != nil {
			msh.WriteToPtyBuffer("*error trying to update cmd rtnstate: %v\n", err)
			// fall-through (nothing to do)
		}
	}

	go pushNumRunningCmdsUpdate(&donePk.CK, -1)
	sstore.MainBus.SendUpdate(update)
	return
}

func (msh *MShellProc) handleCmdFinalPacket(finalPk *packet.CmdFinalPacketType) {
	defer msh.RemoveRunningCmd(finalPk.CK)
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
	update := &sstore.ModelUpdate{Cmd: rtnCmd}
	if screen != nil {
		update.Screens = []*sstore.ScreenType{screen}
	}
	go pushNumRunningCmdsUpdate(&finalPk.CK, -1)
	sstore.MainBus.SendUpdate(update)
}

// TODO notify FE about cmd errors
func (msh *MShellProc) handleCmdErrorPacket(errPk *packet.CmdErrorPacketType) {
	err := sstore.AppendCmdErrorPk(context.Background(), errPk)
	if err != nil {
		msh.WriteToPtyBuffer("cmderr> [remote %s] [error] adding cmderr: %v\n", msh.GetRemoteName(), err)
		return
	}
	return
}

func (msh *MShellProc) ResetDataPos(ck base.CommandKey) {
	msh.DataPosMap.Delete(ck)
}

func (msh *MShellProc) handleDataPacket(dataPk *packet.DataPacketType, dataPosMap *utilfn.SyncMap[base.CommandKey, int64]) {
	realData, err := base64.StdEncoding.DecodeString(dataPk.Data64)
	if err != nil {
		ack := makeDataAckPacket(dataPk.CK, dataPk.FdNum, 0, err)
		msh.ServerProc.Input.SendPacket(ack)
		return
	}
	var ack *packet.DataAckPacketType
	if len(realData) > 0 {
		dataPos := dataPosMap.Get(dataPk.CK)
		rcmd := msh.GetRunningCmd(dataPk.CK)
		update, err := sstore.AppendToCmdPtyBlob(context.Background(), rcmd.ScreenId, dataPk.CK.GetCmdId(), realData, dataPos)
		if err != nil {
			ack = makeDataAckPacket(dataPk.CK, dataPk.FdNum, 0, err)
		} else {
			ack = makeDataAckPacket(dataPk.CK, dataPk.FdNum, len(realData), nil)
		}
		utilfn.IncSyncMap(dataPosMap, dataPk.CK, int64(len(realData)))
		if update != nil {
			sstore.MainBus.SendScreenUpdate(dataPk.CK.GetGroupId(), update)
		}
	}
	if ack != nil {
		msh.ServerProc.Input.SendPacket(ack)
	}
	// log.Printf("data %s fd=%d len=%d eof=%v err=%v\n", dataPk.CK, dataPk.FdNum, len(realData), dataPk.Eof, dataPk.Error)
}

func (msh *MShellProc) makeHandleDataPacketClosure(dataPk *packet.DataPacketType, dataPosMap *utilfn.SyncMap[base.CommandKey, int64]) func() {
	return func() {
		msh.handleDataPacket(dataPk, dataPosMap)
	}
}

func (msh *MShellProc) makeHandleCmdDonePacketClosure(donePk *packet.CmdDonePacketType) func() {
	return func() {
		msh.handleCmdDonePacket(donePk)
	}
}

func (msh *MShellProc) makeHandleCmdFinalPacketClosure(finalPk *packet.CmdFinalPacketType) func() {
	return func() {
		msh.handleCmdFinalPacket(finalPk)
	}
}

func sendScreenUpdates(screens []*sstore.ScreenType) {
	for _, screen := range screens {
		sstore.MainBus.SendUpdate(&sstore.ModelUpdate{Screens: []*sstore.ScreenType{screen}})
	}
}

func (msh *MShellProc) ProcessPackets() {
	defer msh.WithLock(func() {
		if msh.Status == StatusConnected {
			msh.Status = StatusDisconnected
		}
		screens, err := sstore.HangupRunningCmdsByRemoteId(context.Background(), msh.Remote.RemoteId)
		if err != nil {
			msh.writeToPtyBuffer_nolock("error calling HUP on cmds %v\n", err)
		}
		msh.notifyHangups_nolock()
		go msh.NotifyRemoteUpdate()
		if len(screens) > 0 {
			go sendScreenUpdates(screens)
		}
	})
	for pk := range msh.ServerProc.Output.MainCh {
		if pk.GetType() == packet.DataPacketStr {
			dataPk := pk.(*packet.DataPacketType)
			runCmdUpdateFn(dataPk.CK, msh.makeHandleDataPacketClosure(dataPk, msh.DataPosMap))
			go pushStatusIndicatorUpdate(&dataPk.CK, sstore.StatusIndicatorLevel_Output)
			continue
		}
		if pk.GetType() == packet.DataAckPacketStr {
			// TODO process ack (need to keep track of buffer size for sending)
			// this is low priority though since most input is coming from keyboard and won't overflow this buffer
			continue
		}
		if pk.GetType() == packet.CmdDataPacketStr {
			dataPacket := pk.(*packet.CmdDataPacketType)
			go msh.WriteToPtyBuffer("cmd-data> [remote %s] [%s] pty=%d run=%d\n", msh.GetRemoteName(), dataPacket.CK, dataPacket.PtyDataLen, dataPacket.RunDataLen)
			go pushStatusIndicatorUpdate(&dataPacket.CK, sstore.StatusIndicatorLevel_Output)
			continue
		}
		if pk.GetType() == packet.CmdDonePacketStr {
			donePk := pk.(*packet.CmdDonePacketType)
			runCmdUpdateFn(donePk.CK, msh.makeHandleCmdDonePacketClosure(donePk))
			continue
		}
		if pk.GetType() == packet.CmdFinalPacketStr {
			finalPk := pk.(*packet.CmdFinalPacketType)
			runCmdUpdateFn(finalPk.CK, msh.makeHandleCmdFinalPacketClosure(finalPk))
			continue
		}
		if pk.GetType() == packet.CmdErrorPacketStr {
			msh.handleCmdErrorPacket(pk.(*packet.CmdErrorPacketType))
			continue
		}
		if pk.GetType() == packet.MessagePacketStr {
			msgPacket := pk.(*packet.MessagePacketType)
			msh.WriteToPtyBuffer("msg> [remote %s] [%s] %s\n", msh.GetRemoteName(), msgPacket.CK, msgPacket.Message)
			continue
		}
		if pk.GetType() == packet.RawPacketStr {
			rawPacket := pk.(*packet.RawPacketType)
			msh.WriteToPtyBuffer("stderr> [remote %s] %s\n", msh.GetRemoteName(), rawPacket.Data)
			continue
		}
		if pk.GetType() == packet.CmdStartPacketStr {
			startPk := pk.(*packet.CmdStartPacketType)
			msh.WriteToPtyBuffer("start> [remote %s] reqid=%s (%p)\n", msh.GetRemoteName(), startPk.RespId, msh.ServerProc.Output)
			continue
		}
		msh.WriteToPtyBuffer("MSH> [remote %s] unhandled packet %s\n", msh.GetRemoteName(), packet.AsString(pk))
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

func (msh *MShellProc) getFullState(shellType string, stateDiff *packet.ShellStateDiff) (*packet.ShellState, error) {
	baseState := msh.StateMap.GetStateByHash(shellType, stateDiff.BaseHash)
	if baseState != nil && len(stateDiff.DiffHashArr) == 0 {
		sapi, err := shellapi.MakeShellApi(baseState.GetShellType())
		newState, err := sapi.ApplyShellStateDiff(baseState, stateDiff)
		if err != nil {
			return nil, err
		}
		return newState, nil
	} else {
		fullState, err := sstore.GetFullState(context.Background(), sstore.ShellStatePtr{BaseHash: stateDiff.BaseHash, DiffHashArr: stateDiff.DiffHashArr})
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
func (msh *MShellProc) getFeStateFromDiff(stateDiff *packet.ShellStateDiff) (map[string]string, error) {
	baseState := msh.StateMap.GetStateByHash(stateDiff.GetShellType(), stateDiff.BaseHash)
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
		fullState, err := sstore.GetFullState(context.Background(), sstore.ShellStatePtr{BaseHash: stateDiff.BaseHash, DiffHashArr: stateDiff.DiffHashArr})
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

func (msh *MShellProc) TryAutoConnect() error {
	if msh.IsConnected() {
		return nil
	}
	rcopy := msh.GetRemoteCopy()
	if rcopy.ConnectMode == sstore.ConnectModeManual {
		return nil
	}
	var err error
	msh.WithLock(func() {
		if msh.NumTryConnect > 5 {
			err = fmt.Errorf("too many unsuccessful tries")
			return
		}
		msh.NumTryConnect++
	})
	if err != nil {
		return err
	}
	msh.Launch(false)
	if !msh.IsConnected() {
		return fmt.Errorf("error connecting")
	}
	return nil
}

func (msh *MShellProc) GetDisplayName() string {
	rcopy := msh.GetRemoteCopy()
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
