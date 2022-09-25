package remote

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/armon/circbuf"
	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"golang.org/x/mod/semver"
)

const RemoteTypeMShell = "mshell"
const DefaultTerm = "xterm-256color"
const DefaultMaxPtySize = 1024 * 1024
const CircBufSize = 64 * 1024
const RemoteTermRows = 8
const RemoteTermCols = 80
const PtyReadBufSize = 100

const MShellVersion = "v0.1.0"
const MShellVersionConstraint = "^0.1"

const MShellServerCommand = `
PATH=$PATH:~/.mshell;
which mshell > /dev/null;
if [[ "$?" -ne 0 ]]
then
  printf "\n##N{\"type\": \"init\", \"notfound\": true, \"uname\": \"%s | %s\"}\n" "$(uname -s)" "$(uname -m)"
else
  mshell --server
fi
`

const (
	StatusInit         = "init"
	StatusConnected    = "connected"
	StatusConnecting   = "connecting"
	StatusDisconnected = "disconnected"
	StatusError        = "error"
)

func init() {
	if MShellVersion != base.MShellVersion {
		panic(fmt.Sprintf("sh2-server mshell version must match '%s' vs '%s'", MShellVersion, base.MShellVersion))
	}
}

var GlobalStore *Store

type Store struct {
	Lock       *sync.Mutex
	Map        map[string]*MShellProc // key=remoteid
	CmdWaitMap map[base.CommandKey][]func()
}

type MShellProc struct {
	Lock   *sync.Mutex
	Remote *sstore.RemoteType

	// runtime
	Status             string
	ServerProc         *shexec.ClientProc
	UName              string
	Err                error
	ControllingPty     *os.File
	PtyBuffer          *circbuf.Buffer
	MakeClientCancelFn context.CancelFunc
	NeedsMShellUpgrade bool

	RunningCmds []base.CommandKey
}

type RemoteRuntimeState struct {
	RemoteType          string              `json:"remotetype"`
	RemoteId            string              `json:"remoteid"`
	PhysicalId          string              `json:"physicalremoteid"`
	RemoteAlias         string              `json:"remotealias,omitempty"`
	RemoteCanonicalName string              `json:"remotecanonicalname"`
	RemoteVars          map[string]string   `json:"remotevars"`
	Status              string              `json:"status"`
	ErrorStr            string              `json:"errorstr,omitempty"`
	DefaultState        *sstore.RemoteState `json:"defaultstate"`
	ConnectMode         string              `json:"connectmode"`
	AutoInstall         bool                `json:"autoinstall"`
	Archived            bool                `json:"archived"`
	RemoteIdx           int64               `json:"remoteidx"`
	UName               string              `json:"uname"`
	MShellVersion       string              `json:"mshellversion"`
}

func (state RemoteRuntimeState) IsConnected() bool {
	return state.Status == StatusConnected
}

func (msh *MShellProc) GetStatus() string {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Status
}

func (state RemoteRuntimeState) GetBaseDisplayName() string {
	if state.RemoteAlias != "" {
		return state.RemoteAlias
	}
	return state.RemoteCanonicalName
}

func (state RemoteRuntimeState) GetDisplayName(rptr *sstore.RemotePtrType) string {
	name := state.GetBaseDisplayName()
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
	for _, remote := range allRemotes {
		msh := MakeMShell(remote)
		GlobalStore.Map[remote.RemoteId] = msh
		if remote.ConnectMode == sstore.ConnectModeStartup {
			go msh.Launch()
		}
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
		return fmt.Errorf("cannot add remote %d, already in global map", remoteId)
	}
	GlobalStore.Map[r.RemoteId] = msh
	if r.ConnectMode == sstore.ConnectModeStartup {
		go msh.Launch()
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

func AddRemote(ctx context.Context, r *sstore.RemoteType) error {
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
	err := sstore.UpsertRemote(ctx, r)
	if err != nil {
		return fmt.Errorf("cannot create remote %q: %v", r.RemoteCanonicalName, err)
	}
	newMsh := MakeMShell(r)
	GlobalStore.Map[r.RemoteId] = newMsh
	go newMsh.NotifyRemoteUpdate()
	if r.ConnectMode == sstore.ConnectModeStartup {
		go newMsh.Launch()
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
	rcopy := msh.GetRemoteCopy()
	archivedRemote := &sstore.RemoteType{
		RemoteId:            rcopy.RemoteId,
		RemoteType:          rcopy.RemoteType,
		RemoteCanonicalName: rcopy.RemoteCanonicalName,
		ConnectMode:         sstore.ConnectModeManual,
		Archived:            true,
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

func (msh *MShellProc) GetRemoteRuntimeState() RemoteRuntimeState {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	state := RemoteRuntimeState{
		RemoteType:          msh.Remote.RemoteType,
		RemoteId:            msh.Remote.RemoteId,
		RemoteAlias:         msh.Remote.RemoteAlias,
		RemoteCanonicalName: msh.Remote.RemoteCanonicalName,
		PhysicalId:          msh.Remote.PhysicalId,
		Status:              msh.Status,
		ConnectMode:         msh.Remote.ConnectMode,
		AutoInstall:         msh.Remote.AutoInstall,
		Archived:            msh.Remote.Archived,
		RemoteIdx:           msh.Remote.RemoteIdx,
		UName:               msh.UName,
	}
	if msh.Err != nil {
		state.ErrorStr = msh.Err.Error()
	}
	local := (msh.Remote.SSHOpts == nil || msh.Remote.SSHOpts.Local)
	vars := make(map[string]string)
	vars["user"] = msh.Remote.RemoteUser
	vars["bestuser"] = vars["user"]
	vars["host"] = msh.Remote.RemoteHost
	vars["shorthost"] = makeShortHost(msh.Remote.RemoteHost)
	vars["alias"] = msh.Remote.RemoteAlias
	vars["cname"] = msh.Remote.RemoteCanonicalName
	vars["physicalid"] = msh.Remote.PhysicalId
	vars["remoteid"] = msh.Remote.RemoteId
	vars["status"] = msh.Status
	vars["type"] = msh.Remote.RemoteType
	if msh.Remote.RemoteSudo {
		vars["sudo"] = "1"
	}
	if local {
		vars["local"] = "1"
	}
	if msh.ServerProc != nil && msh.ServerProc.InitPk != nil {
		state.DefaultState = &sstore.RemoteState{
			Cwd:  msh.ServerProc.InitPk.Cwd,
			Env0: msh.ServerProc.InitPk.Env0,
		}
		state.MShellVersion = msh.ServerProc.InitPk.Version
		vars["home"] = msh.ServerProc.InitPk.HomeDir
		vars["remoteuser"] = msh.ServerProc.InitPk.User
		vars["bestuser"] = vars["remoteuser"]
		vars["remotehost"] = msh.ServerProc.InitPk.HostName
		vars["remoteshorthost"] = makeShortHost(msh.ServerProc.InitPk.HostName)
		vars["besthost"] = vars["remotehost"]
		vars["bestshorthost"] = vars["remoteshorthost"]
	}
	if local && msh.Remote.RemoteSudo {
		vars["bestuser"] = "sudo"
	} else if msh.Remote.RemoteSudo {
		vars["bestuser"] = "sudo@" + vars["bestuser"]
	}
	if local {
		vars["bestname"] = vars["bestuser"] + "@local"
		vars["bestshortname"] = vars["bestuser"] + "@local"
	} else {
		vars["bestname"] = vars["bestuser"] + "@" + vars["besthost"]
		vars["bestshortname"] = vars["bestuser"] + "@" + vars["bestshorthost"]
	}
	state.RemoteVars = vars
	return state
}

func (msh *MShellProc) NotifyRemoteUpdate() {
	rstate := msh.GetRemoteRuntimeState()
	update := &sstore.ModelUpdate{Remotes: []interface{}{rstate}}
	sstore.MainBus.SendUpdate("", update)
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

func GetDefaultRemoteStateById(remoteId string) (*sstore.RemoteState, error) {
	remote := GetRemoteById(remoteId)
	if remote == nil {
		return nil, fmt.Errorf("remote not found")
	}
	if !remote.IsConnected() {
		return nil, fmt.Errorf("remote not connected")
	}
	state := remote.GetDefaultState()
	if state == nil {
		return nil, fmt.Errorf("could not get default remote state")
	}
	return state, nil
}

func MakeMShell(r *sstore.RemoteType) *MShellProc {
	buf, err := circbuf.NewBuffer(CircBufSize)
	if err != nil {
		panic(err) // this should never happen (NewBuffer only returns an error if CirBufSize <= 0)
	}
	rtn := &MShellProc{
		Lock:      &sync.Mutex{},
		Remote:    r,
		Status:    StatusInit,
		PtyBuffer: buf,
	}
	rtn.WriteToPtyBuffer("console for remote [%s]\n", r.GetName())
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
	return nil
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

func (msh *MShellProc) Disconnect() {
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
			realStr = "\033[0m\033[31mscripthaus>\033[0m " + realStr[1:]
		} else {
			realStr = "\033[0m\033[32mscripthaus>\033[0m " + realStr
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
	sstore.MainBus.SendUpdate("", update)
}

func (msh *MShellProc) RunPtyReadLoop(cmdPty *os.File) {
	buf := make([]byte, PtyReadBufSize)
	for {
		n, readErr := cmdPty.Read(buf)
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			msh.WriteToPtyBuffer("*error reading from controlling-pty: %v\n", readErr)
			break
		}
		msh.WithLock(func() {
			curOffset := msh.PtyBuffer.TotalWritten()
			msh.PtyBuffer.Write(buf[0:n])
			sendRemotePtyUpdate(msh.Remote.RemoteId, curOffset, buf[0:n])
		})
	}
}

func (msh *MShellProc) Launch() {
	remoteCopy := msh.GetRemoteCopy()
	if remoteCopy.Archived {
		msh.WriteToPtyBuffer("cannot launch archived remote\n")
		return
	}
	curStatus := msh.GetStatus()
	if curStatus == StatusConnecting {
		msh.WriteToPtyBuffer("remote is already connecting, disconnect before trying to connect again\n")
		return
	}
	msh.WriteToPtyBuffer("connecting to %s...\n", remoteCopy.RemoteCanonicalName)
	sshOpts := convertSSHOpts(remoteCopy.SSHOpts)
	sshOpts.SSHErrorsToTty = true
	ecmd := sshOpts.MakeSSHExecCmd(MShellServerCommand)
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
	makeClientCtx, makeClientCancelFn := context.WithCancel(context.Background())
	defer makeClientCancelFn()
	msh.WithLock(func() {
		msh.Status = StatusConnecting
		msh.MakeClientCancelFn = makeClientCancelFn
		go msh.NotifyRemoteUpdate()
	})
	cproc, uname, err := shexec.MakeClientProc(makeClientCtx, ecmd)
	var mshellVersion string
	msh.WithLock(func() {
		msh.UName = uname
		msh.MakeClientCancelFn = nil
		if cproc != nil && cproc.InitPk != nil {
			msh.Remote.InitPk = cproc.InitPk
			mshellVersion = cproc.InitPk.Version
		}
		if semver.Compare(mshellVersion, MShellVersion) < 0 {
			msh.NeedsMShellUpgrade = true
		}
		// no notify here, because we'll call notify in either case below
	})
	if err == context.Canceled {
		err = fmt.Errorf("forced disconnection")
	}
	if err == nil && semver.MajorMinor(mshellVersion) != semver.MajorMinor(MShellVersion) {
		err = fmt.Errorf("mshell version is not compatible current=%s remote=%s", MShellVersion, mshellVersion)
	}
	if err != nil {
		msh.setErrorStatus(err)
		msh.WriteToPtyBuffer("*error connecting to remote (uname=%q): %v\n", msh.UName, err)
		return
	}
	msh.WriteToPtyBuffer("connected\n")
	msh.WithLock(func() {
		msh.ServerProc = cproc
		msh.Status = StatusConnected
		go msh.NotifyRemoteUpdate()
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
	return
}

func (msh *MShellProc) IsConnected() bool {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	return msh.Status == StatusConnected
}

func (msh *MShellProc) GetDefaultState() *sstore.RemoteState {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	if msh.ServerProc == nil || msh.ServerProc.InitPk == nil {
		return nil
	}
	return &sstore.RemoteState{Cwd: msh.ServerProc.InitPk.HomeDir, Env0: msh.ServerProc.InitPk.Env0}
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

func (state RemoteRuntimeState) ExpandHomeDir(pathStr string) (string, error) {
	if pathStr != "~" && !strings.HasPrefix(pathStr, "~/") {
		return pathStr, nil
	}
	homeDir := state.RemoteVars["home"]
	if homeDir == "" {
		return "", fmt.Errorf("remote does not have HOME set, cannot do ~ expansion")
	}
	if pathStr == "~" {
		return homeDir, nil
	}
	return path.Join(homeDir, pathStr[2:]), nil
}

func (msh *MShellProc) IsCmdRunning(ck base.CommandKey) bool {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	for _, runningCk := range msh.RunningCmds {
		if runningCk == ck {
			return true
		}
	}
	return false
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

func (msh *MShellProc) SendSpecialInput(siPk *packet.SpecialInputPacketType) error {
	if !msh.IsConnected() {
		return fmt.Errorf("remote is not connected, cannot send input")
	}
	if !msh.IsCmdRunning(siPk.CK) {
		return fmt.Errorf("cannot send input, cmd is not running")
	}
	return msh.ServerProc.Input.SendPacket(siPk)
}

func makeTermOpts(runPk *packet.RunPacketType) sstore.TermOpts {
	return sstore.TermOpts{Rows: int64(runPk.TermOpts.Rows), Cols: int64(runPk.TermOpts.Cols), FlexRows: true, MaxPtySize: DefaultMaxPtySize}
}

// returns (cmdtype, allow-updates-callback, err)
func RunCommand(ctx context.Context, cmdId string, remotePtr sstore.RemotePtrType, remoteState *sstore.RemoteState, runPacket *packet.RunPacketType) (*sstore.CmdType, func(), error) {
	if remotePtr.OwnerId != "" {
		return nil, nil, fmt.Errorf("cannot run command against another user's remote '%s'", remotePtr.MakeFullRemoteRef())
	}
	msh := GetRemoteById(remotePtr.RemoteId)
	if msh == nil {
		return nil, nil, fmt.Errorf("no remote id=%s found", remotePtr.RemoteId)
	}
	if !msh.IsConnected() {
		return nil, nil, fmt.Errorf("remote '%s' is not connected", remotePtr.RemoteId)
	}
	if remoteState == nil {
		return nil, nil, fmt.Errorf("no remote state passed to RunCommand")
	}
	msh.ServerProc.Output.RegisterRpc(runPacket.ReqId)
	err := shexec.SendRunPacketAndRunData(ctx, msh.ServerProc.Input, runPacket)
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
	status := sstore.CmdStatusRunning
	if runPacket.Detached {
		status = sstore.CmdStatusDetached
	}
	cmd := &sstore.CmdType{
		SessionId:   runPacket.CK.GetSessionId(),
		CmdId:       startPk.CK.GetCmdId(),
		CmdStr:      runPacket.Command,
		Remote:      remotePtr,
		RemoteState: *remoteState,
		TermOpts:    makeTermOpts(runPacket),
		Status:      status,
		StartPk:     startPk,
		DonePk:      nil,
		RunOut:      nil,
	}
	err = sstore.CreateCmdPtyFile(ctx, cmd.SessionId, cmd.CmdId, cmd.TermOpts.MaxPtySize)
	if err != nil {
		// TODO the cmd is running, so this is a tricky error to handle
		return nil, nil, fmt.Errorf("cannot create local ptyout file for running command: %v", err)
	}
	msh.AddRunningCmd(startPk.CK)
	return cmd, func() { removeCmdWait(startPk.CK) }, nil
}

func (msh *MShellProc) AddRunningCmd(ck base.CommandKey) {
	msh.Lock.Lock()
	defer msh.Lock.Unlock()
	msh.RunningCmds = append(msh.RunningCmds, ck)
}

func (msh *MShellProc) PacketRpc(ctx context.Context, pk packet.RpcPacketType) (*packet.ResponsePacketType, error) {
	if !msh.IsConnected() {
		return nil, fmt.Errorf("runner is not connected")
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
	for _, ck := range msh.RunningCmds {
		cmd, err := sstore.GetCmdById(context.Background(), ck.GetSessionId(), ck.GetCmdId())
		if err != nil {
			continue
		}
		update := sstore.ModelUpdate{Cmd: cmd}
		sstore.MainBus.SendUpdate(ck.GetSessionId(), update)
	}
	msh.RunningCmds = nil
}

func (msh *MShellProc) handleCmdDonePacket(donePk *packet.CmdDonePacketType) {
	update, err := sstore.UpdateCmdDonePk(context.Background(), donePk)
	if err != nil {
		msh.WriteToPtyBuffer("[error] updating cmddone: %v\n", err)
		return
	}
	if update != nil {
		sstore.MainBus.SendUpdate(donePk.CK.GetSessionId(), update)
	}
	return
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

func (msh *MShellProc) handleDataPacket(dataPk *packet.DataPacketType, dataPosMap map[base.CommandKey]int64) {
	realData, err := base64.StdEncoding.DecodeString(dataPk.Data64)
	if err != nil {
		ack := makeDataAckPacket(dataPk.CK, dataPk.FdNum, 0, err)
		msh.ServerProc.Input.SendPacket(ack)
		return
	}
	var ack *packet.DataAckPacketType
	if len(realData) > 0 {
		dataPos := dataPosMap[dataPk.CK]
		update, err := sstore.AppendToCmdPtyBlob(context.Background(), dataPk.CK.GetSessionId(), dataPk.CK.GetCmdId(), realData, dataPos)
		if err != nil {
			ack = makeDataAckPacket(dataPk.CK, dataPk.FdNum, 0, err)
		} else {
			ack = makeDataAckPacket(dataPk.CK, dataPk.FdNum, len(realData), nil)
		}
		dataPosMap[dataPk.CK] += int64(len(realData))
		if update != nil {
			sstore.MainBus.SendUpdate(dataPk.CK.GetSessionId(), update)
		}
	}
	if ack != nil {
		msh.ServerProc.Input.SendPacket(ack)
	}
	// fmt.Printf("data %s fd=%d len=%d eof=%v err=%v\n", dataPk.CK, dataPk.FdNum, len(realData), dataPk.Eof, dataPk.Error)
}

func (msh *MShellProc) makeHandleDataPacketClosure(dataPk *packet.DataPacketType, dataPosMap map[base.CommandKey]int64) func() {
	return func() {
		msh.handleDataPacket(dataPk, dataPosMap)
	}
}

func (msh *MShellProc) makeHandleCmdDonePacketClosure(donePk *packet.CmdDonePacketType) func() {
	return func() {
		msh.handleCmdDonePacket(donePk)
	}
}

func (msh *MShellProc) ProcessPackets() {
	defer msh.WithLock(func() {
		if msh.Status == StatusConnected {
			msh.Status = StatusDisconnected
		}
		err := sstore.HangupRunningCmdsByRemoteId(context.Background(), msh.Remote.RemoteId)
		if err != nil {
			msh.writeToPtyBuffer_nolock("error calling HUP on cmds %v\n", err)
		}
		msh.notifyHangups_nolock()
		go msh.NotifyRemoteUpdate()
	})
	dataPosMap := make(map[base.CommandKey]int64)
	for pk := range msh.ServerProc.Output.MainCh {
		if pk.GetType() == packet.DataPacketStr {
			dataPk := pk.(*packet.DataPacketType)
			runCmdUpdateFn(dataPk.CK, msh.makeHandleDataPacketClosure(dataPk, dataPosMap))
			continue
		}
		if pk.GetType() == packet.DataAckPacketStr {
			// TODO process ack (need to keep track of buffer size for sending)
			// this is low priority though since most input is coming from keyboard and won't overflow this buffer
			continue
		}
		if pk.GetType() == packet.CmdDataPacketStr {
			dataPacket := pk.(*packet.CmdDataPacketType)
			msh.WriteToPtyBuffer("cmd-data> [remote %s] [%s] pty=%d run=%d\n", msh.GetRemoteName(), dataPacket.CK, dataPacket.PtyDataLen, dataPacket.RunDataLen)
			continue
		}
		if pk.GetType() == packet.CmdDonePacketStr {
			donePk := pk.(*packet.CmdDonePacketType)
			runCmdUpdateFn(donePk.CK, msh.makeHandleCmdDonePacketClosure(donePk))
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

func EvalPrompt(promptFmt string, vars map[string]string, state *sstore.RemoteState) string {
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

func evalPromptEsc(escCode string, vars map[string]string, state *sstore.RemoteState) string {
	if strings.HasPrefix(escCode, "x{") && strings.HasSuffix(escCode, "}") {
		varName := escCode[2 : len(escCode)-1]
		return vars[varName]
	}
	if strings.HasPrefix(escCode, "y{") && strings.HasSuffix(escCode, "}") {
		if state == nil {
			return ""
		}
		varName := escCode[2 : len(escCode)-1]
		varMap := shexec.ParseEnv0(state.Env0)
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
		return string([]byte{byte(ival)})
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
