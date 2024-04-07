// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shexec

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"os/user"
	"path"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alessio/shellescape"
	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/cirfile"
	"github.com/wavetermdev/waveterm/waveshell/pkg/mpio"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellapi"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellenv"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellutil"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
	"github.com/wavetermdev/waveterm/waveshell/pkg/wlog"
	"golang.org/x/mod/semver"
	"golang.org/x/sys/unix"
)

const MinTermRows = 2
const MinTermCols = 10
const MaxTermRows = 1024
const MaxTermCols = 1024
const MaxFdNum = 1023
const FirstExtraFilesFdNum = 3
const DefaultMaxPtySize = 1024 * 1024
const MinMaxPtySize = 16 * 1024
const MaxMaxPtySize = 100 * 1024 * 1024
const MaxRunDataSize = 1024 * 1024
const MaxTotalRunDataSize = 10 * MaxRunDataSize
const ShellVarName = "SHELL"
const SigKillWaitTime = 2 * time.Second
const RtnStateFdNum = 20
const ReturnStateReadWaitTime = 2 * time.Second
const ForceDebugRcFile = false
const ForceDebugReturnState = false

const ClientCommandFmt = `
PATH=$PATH:~/.mshell;
which mshell > /dev/null;
if [[ "$?" -ne 0 ]]
then
  printf "\n##N{\"type\": \"init\", \"notfound\": true, \"uname\": \"%s|%s\"}\n" "$(uname -s)" "$(uname -m)"
else
  mshell-[%VERSION%] --single
fi
`

func MakeClientCommandStr() string {
	return strings.ReplaceAll(ClientCommandFmt, "[%VERSION%]", semver.MajorMinor(base.MShellVersion))
}

const InstallCommandFmt = `
printf "\n##N{\"type\": \"init\", \"notfound\": true, \"uname\": \"%s|%s\"}\n" "$(uname -s)" "$(uname -m)";
mkdir -p ~/.mshell/;
cat > ~/.mshell/mshell.temp;
if [[ -s ~/.mshell/mshell.temp ]]
then
  mv ~/.mshell/mshell.temp ~/.mshell/mshell-[%VERSION%];
  chmod a+x ~/.mshell/mshell-[%VERSION%];
  ~/.mshell/mshell-[%VERSION%] --single --version
fi
`

func MakeInstallCommandStr() string {
	return strings.ReplaceAll(InstallCommandFmt, "[%VERSION%]", semver.MajorMinor(base.MShellVersion))
}

type MShellBinaryReaderFn func(version string, goos string, goarch string) (io.ReadCloser, error)

type ReturnStateBuf struct {
	Lock     *sync.Mutex
	Buf      []byte
	Done     bool
	Err      error
	Reader   *os.File
	FdNum    int
	EndBytes []byte
	DoneCh   chan bool
}

func MakeReturnStateBuf() *ReturnStateBuf {
	return &ReturnStateBuf{Lock: &sync.Mutex{}, DoneCh: make(chan bool)}
}

type ShExecType struct {
	Lock           *sync.Mutex // only locks "Exited" field
	StartTs        time.Time
	CK             base.CommandKey
	FileNames      *base.CommandFileNames
	Cmd            *exec.Cmd
	CmdPty         *os.File
	MaxPtySize     int64
	Multiplexer    *mpio.Multiplexer
	Detached       bool
	DetachedOutput *packet.PacketSender
	RunnerOutFd    *os.File
	MsgSender      *packet.PacketSender // where to send out-of-band messages back to calling proceess
	ReturnState    *ReturnStateBuf
	Exited         bool   // locked via Lock
	TmpRcFileName  string // file *or* directory holding temporary rc file(s)
	SAPI           shellapi.ShellApi
}

type StdContext struct{}

func (StdContext) GetWriter(fdNum int) io.WriteCloser {
	if fdNum == 0 {
		return os.Stdin
	}
	if fdNum == 1 {
		return os.Stdout
	}
	if fdNum == 2 {
		return os.Stderr
	}
	fd := os.NewFile(uintptr(fdNum), fmt.Sprintf("/dev/fd/%d", fdNum))
	return fd
}

func (StdContext) GetReader(fdNum int) io.ReadCloser {
	if fdNum == 0 {
		return os.Stdin
	}
	if fdNum == 1 {
		return os.Stdout
	}
	if fdNum == 2 {
		return os.Stdout
	}
	fd := os.NewFile(uintptr(fdNum), fmt.Sprintf("/dev/fd/%d", fdNum))
	return fd
}

type FdContext interface {
	GetWriter(fdNum int) io.WriteCloser
	GetReader(fdNum int) io.ReadCloser
}

type ShExecUPR struct {
	ShExec *ShExecType
	UPR    packet.UnknownPacketReporter
}

func (s *ShExecType) processSpecialInputPacket(pk *packet.SpecialInputPacketType) error {
	base.Logf("processSpecialInputPacket: %#v\n", pk)
	if pk.WinSize != nil {
		if s.CmdPty == nil {
			return fmt.Errorf("cannot change winsize, cmd was not started with a pty")
		}
		winSize := &pty.Winsize{
			Rows: uint16(base.BoundInt(pk.WinSize.Rows, MinTermRows, MaxTermRows)),
			Cols: uint16(base.BoundInt(pk.WinSize.Cols, MinTermCols, MaxTermCols)),
		}
		pty.Setsize(s.CmdPty, winSize)
		s.Cmd.Process.Signal(syscall.SIGWINCH)
	}
	if pk.SigName != "" {
		var signal syscall.Signal
		sigNumInt, err := strconv.Atoi(pk.SigName)
		if err == nil {
			signal = syscall.Signal(sigNumInt)
		} else {
			signal = unix.SignalNum(pk.SigName)
		}
		if signal == 0 {
			return fmt.Errorf("error signal %q not found, cannot send", pk.SigName)
		}
		s.SendSignal(syscall.Signal(signal))
	}
	return nil
}

func (s ShExecUPR) UnknownPacket(pk packet.PacketType) {
	if pk.GetType() == packet.SpecialInputPacketStr {
		inputPacket := pk.(*packet.SpecialInputPacketType)
		err := s.ShExec.processSpecialInputPacket(inputPacket)
		if err != nil && s.ShExec.MsgSender != nil {
			msg := packet.MakeMessagePacket(err.Error())
			msg.CK = s.ShExec.CK
			s.ShExec.MsgSender.SendPacket(msg)
		}
		return
	}
	if s.UPR != nil {
		s.UPR.UnknownPacket(pk)
	}
}

func MakeShExec(ck base.CommandKey, upr packet.UnknownPacketReporter, sapi shellapi.ShellApi) *ShExecType {
	return &ShExecType{
		Lock:        &sync.Mutex{},
		StartTs:     time.Now(),
		CK:          ck,
		Multiplexer: mpio.MakeMultiplexer(ck, upr),
		SAPI:        sapi,
	}
}

func (c *ShExecType) Close() {
	if c.CmdPty != nil {
		c.CmdPty.Close()
	}
	c.Multiplexer.Close()
	if c.DetachedOutput != nil {
		c.DetachedOutput.Close()
		c.DetachedOutput.WaitForDone()
	}
	if c.RunnerOutFd != nil {
		c.RunnerOutFd.Close()
	}
	if c.ReturnState != nil {
		c.ReturnState.Reader.Close()
	}
	if c.TmpRcFileName != "" {
		// TmpRcFileName can be a file or a directory
		os.RemoveAll(c.TmpRcFileName)
	}
}

func (c *ShExecType) MakeCmdStartPacket(reqId string) *packet.CmdStartPacketType {
	startPacket := packet.MakeCmdStartPacket(reqId)
	startPacket.Ts = time.Now().UnixMilli()
	startPacket.CK = c.CK
	startPacket.Pid = c.Cmd.Process.Pid
	startPacket.MShellPid = os.Getpid()
	return startPacket
}

// returns (pr, err)
func MakeSimpleStaticWriterPipe(data []byte) (*os.File, error) {
	pr, pw, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	go func() {
		defer pw.Close()
		pw.Write(data)
	}()
	return pr, err
}

func MakeRunnerExec(ck base.CommandKey) (*exec.Cmd, error) {
	msPath, err := base.GetMShellPath()
	if err != nil {
		return nil, err
	}
	ecmd := exec.Command(msPath, string(ck))
	return ecmd, nil
}

func MakeDetachedExecCmd(pk *packet.RunPacketType, cmdTty *os.File) (*exec.Cmd, error) {
	sapi, err := shellapi.MakeShellApi(pk.ShellType)
	if err != nil {
		return nil, err
	}
	state := pk.State
	if state == nil {
		state = &packet.ShellState{}
	}
	ecmd := exec.Command(sapi.GetLocalShellPath(), "-c", pk.Command)
	if !pk.StateComplete {
		ecmd.Env = os.Environ()
	}
	shellutil.UpdateCmdEnv(ecmd, shellenv.EnvMapFromState(state))
	shellutil.UpdateCmdEnv(ecmd, shellutil.MShellEnvVars(getTermType(pk)))
	if state.Cwd != "" {
		ecmd.Dir = base.ExpandHomeDir(state.Cwd)
	}
	if HasDupStdin(pk.Fds) {
		return nil, fmt.Errorf("cannot detach command with dup stdin")
	}
	ecmd.Stdin = cmdTty
	ecmd.Stdout = cmdTty
	ecmd.Stderr = cmdTty
	ecmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid:  true,
		Setctty: true,
	}
	extraFiles := make([]*os.File, 0, MaxFdNum+1)
	if len(pk.Fds) > 0 {
		return nil, fmt.Errorf("invalid fd %d passed to detached command", pk.Fds[0].FdNum)
	}
	for _, runData := range pk.RunData {
		if runData.FdNum >= len(extraFiles) {
			extraFiles = extraFiles[:runData.FdNum+1]
		}
		var err error
		extraFiles[runData.FdNum], err = MakeSimpleStaticWriterPipe(runData.Data)
		if err != nil {
			return nil, err
		}
	}
	if len(extraFiles) > FirstExtraFilesFdNum {
		ecmd.ExtraFiles = extraFiles[FirstExtraFilesFdNum:]
	}
	return ecmd, nil
}

// this will never return (unless there is an error creating/opening the file), as fifoFile will never EOF
func MakeAndCopyStdinFifo(dst *os.File, fifoName string) error {
	os.Remove(fifoName)
	err := syscall.Mkfifo(fifoName, 0600) // only read/write from user for security
	if err != nil {
		return fmt.Errorf("cannot make stdin-fifo '%s': %v", fifoName, err)
	}
	// rw is non-blocking, will keep the fifo "open" for the blocking reader
	rwfd, err := os.OpenFile(fifoName, os.O_RDWR, 0600)
	if err != nil {
		return fmt.Errorf("cannot open stdin-fifo(1) '%s': %v", fifoName, err)
	}
	defer rwfd.Close()
	fifoReader, err := os.Open(fifoName) // blocking open/reads (open won't block because of rwfd)
	if err != nil {
		return fmt.Errorf("cannot open stdin-fifo(2) '%s': %w", fifoName, err)
	}
	defer fifoReader.Close()
	io.Copy(dst, fifoReader)
	return nil
}

func ValidateRunPacket(pk *packet.RunPacketType) error {
	if pk.Type != packet.RunPacketStr {
		return fmt.Errorf("run packet has wrong type: %s", pk.Type)
	}
	if pk.Detached {
		err := pk.CK.Validate("run packet")
		if err != nil {
			return err
		}
		for _, rfd := range pk.Fds {
			if rfd.Write {
				return fmt.Errorf("cannot detach command with writable remote files fd=%d", rfd.FdNum)
			}
			if rfd.Read && rfd.DupStdin {
				return fmt.Errorf("cannot detach command with dup stdin fd=%d", rfd.FdNum)
			}
			if rfd.Read {
				return fmt.Errorf("cannot detach command with readable remote files fd=%d", rfd.FdNum)
			}
		}
		totalRunData := 0
		for _, rd := range pk.RunData {
			if rd.DataLen > MaxRunDataSize {
				return fmt.Errorf("cannot detach command, constant rundata input too large fd=%d, len=%d, max=%d", rd.FdNum, rd.DataLen, mpio.ReadBufSize)
			}
			totalRunData += rd.DataLen
		}
		if totalRunData > MaxTotalRunDataSize {
			return fmt.Errorf("cannot detach command, constant rundata input too large len=%d, max=%d", totalRunData, mpio.MaxTotalRunDataSize)
		}
	}
	if pk.State != nil {
		pkCwd := pk.State.Cwd
		if pkCwd == "" {
			pkCwd = "~"
		}
		realCwd := base.ExpandHomeDir(pkCwd)
		dirInfo, err := os.Stat(realCwd)
		if err != nil {
			return base.CodedErrorf(packet.EC_InvalidCwd, "invalid cwd '%s' for command: %v", realCwd, err)
		}
		if !dirInfo.IsDir() {
			return base.CodedErrorf(packet.EC_InvalidCwd, "invalid cwd '%s' for command, not a directory", realCwd)
		}
	}
	for _, runData := range pk.RunData {
		if runData.DataLen != len(runData.Data) {
			return fmt.Errorf("rundata length mismatch, fd=%d, datalen=%d, expected=%d", runData.FdNum, len(runData.Data), runData.DataLen)
		}
	}
	if pk.UsePty && HasDupStdin(pk.Fds) {
		return fmt.Errorf("cannot use pty with command that has dup stdin")
	}
	return nil
}

func GetWinsize(p *packet.RunPacketType) *pty.Winsize {
	rows := shellutil.DefaultTermRows
	cols := shellutil.DefaultTermCols
	if p.TermOpts != nil {
		rows = base.BoundInt(p.TermOpts.Rows, MinTermRows, MaxTermRows)
		cols = base.BoundInt(p.TermOpts.Cols, MinTermCols, MaxTermCols)
	}
	return &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)}
}

type SSHOpts struct {
	SSHHost        string
	SSHOptsStr     string
	SSHIdentity    string
	SSHUser        string
	SSHPort        int
	SSHErrorsToTty bool
	BatchMode      bool
}

type InstallOpts struct {
	SSHOpts SSHOpts
	ArchStr string
	OptName string
	Detect  bool
	CmdPty  *os.File
}

type ClientOpts struct {
	SSHOpts      SSHOpts
	Command      string
	Fds          []packet.RemoteFd
	Cwd          string
	Debug        bool
	Sudo         bool
	SudoWithPass bool
	SudoPw       string
	Detach       bool
	UsePty       bool
}

func MakeMShellSingleCmd() (*exec.Cmd, error) {
	execFile, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("cannot find local mshell executable: %w", err)
	}
	ecmd := exec.Command(execFile, "--single-from-server")
	return ecmd, nil
}

func MakeLocalExecCmd(cmdStr string, sapi shellapi.ShellApi) *exec.Cmd {
	homeDir, _ := os.UserHomeDir() // ignore error
	if homeDir == "" {
		homeDir = "/"
	}
	ecmd := exec.Command(sapi.GetLocalShellPath(), "-c", cmdStr)
	ecmd.Dir = homeDir
	return ecmd
}

func (opts SSHOpts) MakeSSHExecCmd(remoteCommand string, sapi shellapi.ShellApi) *exec.Cmd {
	remoteCommand = strings.TrimSpace(remoteCommand)
	if opts.SSHHost == "" {
		homeDir, _ := os.UserHomeDir() // ignore error
		if homeDir == "" {
			homeDir = "/"
		}
		ecmd := exec.Command(sapi.GetLocalShellPath(), "-c", remoteCommand)
		ecmd.Dir = homeDir
		return ecmd
	} else {
		var moreSSHOpts []string
		if opts.SSHIdentity != "" {
			identityOpt := fmt.Sprintf("-i %s", shellescape.Quote(opts.SSHIdentity))
			moreSSHOpts = append(moreSSHOpts, identityOpt)
		}
		if opts.SSHUser != "" {
			userOpt := fmt.Sprintf("-l %s", shellescape.Quote(opts.SSHUser))
			moreSSHOpts = append(moreSSHOpts, userOpt)
		}
		if opts.SSHPort != 0 {
			portOpt := fmt.Sprintf("-p %d", opts.SSHPort)
			moreSSHOpts = append(moreSSHOpts, portOpt)
		}
		if opts.SSHErrorsToTty {
			errFdStr := "-E /dev/tty"
			moreSSHOpts = append(moreSSHOpts, errFdStr)
		}
		if opts.BatchMode {
			batchOpt := "-o 'BatchMode=yes'"
			moreSSHOpts = append(moreSSHOpts, batchOpt)
		}
		// note that SSHOptsStr is *not* escaped
		sshCmd := fmt.Sprintf("ssh %s %s %s %s", strings.Join(moreSSHOpts, " "), opts.SSHOptsStr, shellescape.Quote(opts.SSHHost), shellescape.Quote(remoteCommand))
		ecmd := exec.Command(sapi.GetRemoteShellPath(), "-c", sshCmd)
		return ecmd
	}
}

func (opts SSHOpts) MakeMShellSSHOpts() string {
	var moreSSHOpts []string
	if opts.SSHIdentity != "" {
		identityOpt := fmt.Sprintf("-i %s", shellescape.Quote(opts.SSHIdentity))
		moreSSHOpts = append(moreSSHOpts, identityOpt)
	}
	if opts.SSHUser != "" {
		userOpt := fmt.Sprintf("-l %s", shellescape.Quote(opts.SSHUser))
		moreSSHOpts = append(moreSSHOpts, userOpt)
	}
	if opts.SSHPort != 0 {
		portOpt := fmt.Sprintf("-p %d", opts.SSHPort)
		moreSSHOpts = append(moreSSHOpts, portOpt)
	}
	if opts.SSHOptsStr != "" {
		optsOpt := fmt.Sprintf("--ssh-opts %s", shellescape.Quote(opts.SSHOptsStr))
		moreSSHOpts = append(moreSSHOpts, optsOpt)
	}
	if opts.SSHHost != "" {
		sshArg := fmt.Sprintf("--ssh %s", shellescape.Quote(opts.SSHHost))
		moreSSHOpts = append(moreSSHOpts, sshArg)
	}
	return strings.Join(moreSSHOpts, " ")
}

func GetTerminalSize() (int, int, error) {
	fd, err := os.Open("/dev/tty")
	if err != nil {
		return 0, 0, err
	}
	defer fd.Close()
	return pty.Getsize(fd)
}

func AddRunData(pk *packet.RunPacketType, data string, dataType string) (int, error) {
	if len(data) > MaxRunDataSize {
		return 0, fmt.Errorf("%s too large, exceeds read buffer size size:%d", dataType, len(data))
	}
	fdNum, err := NextFreeFdNum(pk)
	if err != nil {
		return 0, err
	}
	runData := packet.RunDataType{FdNum: fdNum, DataLen: len(data), Data: []byte(data)}
	pk.RunData = append(pk.RunData, runData)
	return fdNum, nil
}

func NextFreeFdNum(pk *packet.RunPacketType) (int, error) {
	fdMap := make(map[int]bool)
	for _, fd := range pk.Fds {
		fdMap[fd.FdNum] = true
	}
	for _, rd := range pk.RunData {
		fdMap[rd.FdNum] = true
	}
	for i := 3; i <= MaxFdNum; i++ {
		if !fdMap[i] {
			return i, nil
		}
	}
	return 0, fmt.Errorf("reached maximum number of fds, all fds between 3-%d are in use", MaxFdNum)
}

func MaxFdNumInPacket(pk *packet.RunPacketType) int {
	maxFdNum := 3
	for _, fd := range pk.Fds {
		if fd.FdNum > maxFdNum {
			maxFdNum = fd.FdNum
		}
	}
	for _, rd := range pk.RunData {
		if rd.FdNum > maxFdNum {
			maxFdNum = rd.FdNum
		}
	}
	return maxFdNum
}

func ValidateRemoteFds(rfds []packet.RemoteFd) error {
	dupMap := make(map[int]bool)
	for _, rfd := range rfds {
		if rfd.FdNum < 0 {
			return fmt.Errorf("mshell negative fd numbers fd=%d", rfd.FdNum)
		}
		if rfd.FdNum < FirstExtraFilesFdNum {
			return fmt.Errorf("mshell does not support re-opening fd=%d (0, 1, and 2, are always open)", rfd.FdNum)
		}
		if rfd.FdNum > MaxFdNum {
			return fmt.Errorf("mshell does not support opening fd numbers above %d", MaxFdNum)
		}
		if dupMap[rfd.FdNum] {
			return fmt.Errorf("mshell got duplicate entries for fd=%d", rfd.FdNum)
		}
		if rfd.Read && rfd.Write {
			return fmt.Errorf("mshell does not support opening fd numbers for reading and writing, fd=%d", rfd.FdNum)
		}
		if !rfd.Read && !rfd.Write {
			return fmt.Errorf("invalid fd=%d, neither reading or writing mode specified", rfd.FdNum)
		}
		dupMap[rfd.FdNum] = true
	}
	return nil
}

func sendMShellBinary(input io.WriteCloser, mshellStream io.Reader) {
	go func() {
		defer input.Close()
		io.Copy(input, mshellStream)
	}()
}

func RunInstallFromCmd(ctx context.Context, ecmd ConnInterface, tryDetect bool, mshellStream io.Reader, mshellReaderFn MShellBinaryReaderFn, msgFn func(string)) error {
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("creating stdin pipe: %v", err)
	}
	stdoutReader, err := ecmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("creating stdout pipe: %v", err)
	}
	stderrReader, err := ecmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("creating stderr pipe: %v", err)
	}
	go func() {
		io.Copy(os.Stderr, stderrReader)
	}()
	if mshellStream != nil {
		sendMShellBinary(inputWriter, mshellStream)
	}
	packetParser := packet.MakePacketParser(stdoutReader, nil)
	err = ecmd.Start()
	if err != nil {
		return fmt.Errorf("running ssh command: %w", err)
	}
	firstInit := true
	for {
		var pk packet.PacketType
		select {
		case pk = <-packetParser.MainCh:
		case <-ctx.Done():
			return ctx.Err()
		}
		if pk == nil {
			return fmt.Errorf("no response packet received from client")
		}
		if pk.GetType() == packet.InitPacketStr && firstInit {
			firstInit = false
			initPacket := pk.(*packet.InitPacketType)
			if !tryDetect {
				continue // ignore
			}
			tryDetect = false
			if initPacket.UName == "" {
				return fmt.Errorf("cannot detect arch, no uname received from remote server")
			}
			goos, goarch, err := DetectGoArch(initPacket.UName)
			if err != nil {
				return fmt.Errorf("arch cannot be detected (might be incompatible with mshell): %w", err)
			}
			msgStr := fmt.Sprintf("mshell detected remote architecture as '%s.%s'\n", goos, goarch)
			msgFn(msgStr)
			detectedMSS, err := mshellReaderFn(base.MShellVersion, goos, goarch)
			if err != nil {
				return err
			}
			defer detectedMSS.Close()
			sendMShellBinary(inputWriter, detectedMSS)
			continue
		}
		if pk.GetType() == packet.InitPacketStr && !firstInit {
			initPacket := pk.(*packet.InitPacketType)
			if initPacket.Version == base.MShellVersion {
				return nil
			}
			return fmt.Errorf("invalid version '%s' received from client, expecting '%s'", initPacket.Version, base.MShellVersion)
		}
		if pk.GetType() == packet.RawPacketStr {
			rawPk := pk.(*packet.RawPacketType)
			msgFn(fmt.Sprintf("%s\n", rawPk.Data))
			continue
		}
		return fmt.Errorf("invalid response packet '%s' received from client", pk.GetType())
	}
}

func HasDupStdin(fds []packet.RemoteFd) bool {
	for _, rfd := range fds {
		if rfd.Read && rfd.DupStdin {
			return true
		}
	}
	return false
}

func min(v1 int, v2 int) int {
	if v1 <= v2 {
		return v1
	}
	return v2
}

func SendRunPacketAndRunData(ctx context.Context, sender *packet.PacketSender, runPacket *packet.RunPacketType) error {
	err := sender.SendPacketCtx(ctx, runPacket)
	if err != nil {
		return err
	}
	if len(runPacket.RunData) == 0 {
		return nil
	}
	for _, runData := range runPacket.RunData {
		sendBuf := runData.Data
		for len(sendBuf) > 0 {
			chunkSize := min(len(sendBuf), mpio.MaxSingleWriteSize)
			chunk := sendBuf[0:chunkSize]
			dataPk := packet.MakeDataPacket()
			dataPk.CK = runPacket.CK
			dataPk.FdNum = runData.FdNum
			dataPk.Data64 = base64.StdEncoding.EncodeToString(chunk)
			dataPk.Eof = (len(chunk) == len(sendBuf))
			sendBuf = sendBuf[chunkSize:]
			err = sender.SendPacketCtx(ctx, dataPk)
			if err != nil {
				return err
			}
		}
	}
	err = sender.SendPacketCtx(ctx, packet.MakeDataEndPacket(runPacket.CK))
	if err != nil {
		return err
	}
	return nil
}

func DetectGoArch(uname string) (string, string, error) {
	fields := strings.SplitN(uname, "|", 2)
	if len(fields) != 2 {
		return "", "", fmt.Errorf("invalid uname string returned")
	}
	osVal := strings.TrimSpace(strings.ToLower(fields[0]))
	archVal := strings.TrimSpace(strings.ToLower(fields[1]))
	if osVal != "darwin" && osVal != "linux" {
		return "", "", fmt.Errorf("invalid uname OS '%s', mshell only supports OS X (darwin) and linux", osVal)
	}
	goos := osVal
	goarch := ""
	if archVal == "x86_64" || archVal == "i686" || archVal == "amd64" {
		goarch = "amd64"
	} else if archVal == "aarch64" || archVal == "arm64" {
		goarch = "arm64"
	}
	if goarch == "" {
		return "", "", fmt.Errorf("invalid uname machine type '%s', mshell only supports aarch64 (amd64) and x86_64 (amd64)", archVal)
	}
	if !base.ValidGoArch(goos, goarch) {
		return "", "", fmt.Errorf("invalid arch detected %s.%s", goos, goarch)
	}
	return goos, goarch, nil
}

func (cmd *ShExecType) RunRemoteIOAndWait(packetParser *packet.PacketParser, sender *packet.PacketSender) {
	defer cmd.Close()
	if cmd.ReturnState != nil {
		go cmd.ReturnState.Run()
	}
	cmd.Multiplexer.RunIOAndWait(packetParser, sender, true, false, false)
	donePacket := cmd.WaitForCommand()
	sender.SendPacket(donePacket)
}

func getTermType(pk *packet.RunPacketType) string {
	termType := shellutil.DefaultTermType
	if pk.TermOpts != nil && pk.TermOpts.Term != "" {
		termType = pk.TermOpts.Term
	}
	return termType
}

func (s *ShExecType) SendSignal(sig syscall.Signal) {
	base.Logf("signal start %v\n", sig)
	if sig == syscall.SIGKILL {
		// SIGKILL is special, it also needs to kill waveshell if it's hanging
		go func() {
			wsPid := syscall.Getpid()
			base.Logf("special sigkill handling waveshell-pid:%d\n", wsPid)
			time.Sleep(SigKillWaitTime)
			base.Logf("running self-sigkill %d\n", wsPid)
			syscall.Kill(wsPid, syscall.SIGKILL)
		}()
	}
	if s.Cmd == nil || s.Cmd.Process == nil || s.IsExited() {
		base.Logf("signal, no cmd or exited (exited:%v)\n", s.IsExited())
		return
	}
	pgroup := false
	if s.Cmd.SysProcAttr != nil && (s.Cmd.SysProcAttr.Setsid || s.Cmd.SysProcAttr.Setpgid) {
		pgroup = true
	}
	pid := s.Cmd.Process.Pid
	if pgroup {
		base.Logf("send signal %s to %d (pgroup)\n", sig, -pid)
		syscall.Kill(-pid, sig)
	} else {
		base.Logf("send signal %s to %d (normal)\n", sig, pid)
		syscall.Kill(pid, sig)
	}
}

func RunCommandSimple(pk *packet.RunPacketType, sender *packet.PacketSender, fromServer bool) (rtnShExec *ShExecType, rtnErr error) {
	sapi, err := shellapi.MakeShellApi(pk.ShellType)
	if err != nil {
		return nil, err
	}
	state := pk.State
	if state == nil {
		return nil, fmt.Errorf("invalid run packet, no state")
	}
	cmd := MakeShExec(pk.CK, nil, sapi)
	defer func() {
		// on error, call cmd.Close()
		if rtnErr != nil {
			cmd.Close()
		}
	}()
	if fromServer {
		msgUpr := packet.MessageUPR{CK: pk.CK, Sender: sender}
		upr := ShExecUPR{ShExec: cmd, UPR: msgUpr}
		cmd.Multiplexer.UPR = upr
		cmd.MsgSender = sender
	}
	var rtnStateWriter *os.File
	rcFileStr := sapi.MakeRcFileStr(pk)
	if pk.ReturnState {
		pr, pw, err := os.Pipe()
		if err != nil {
			return nil, fmt.Errorf("cannot create returnstate pipe: %v", err)
		}
		cmd.ReturnState = MakeReturnStateBuf()
		cmd.ReturnState.Reader = pr
		cmd.ReturnState.FdNum = RtnStateFdNum
		rtnStateWriter = pw
		defer pw.Close()
		trapCmdStr, endBytes := sapi.MakeExitTrap(cmd.ReturnState.FdNum)
		cmd.ReturnState.EndBytes = endBytes
		rcFileStr += trapCmdStr
	}
	shellVarMap := shellenv.ShellVarMapFromState(state)
	if base.HasDebugFlag(shellVarMap, base.DebugFlag_LogRcFile) || ForceDebugRcFile {
		wlog.Logf("debugrc file %q\n", base.GetDebugRcFileName())
		debugRcFileName := base.GetDebugRcFileName()
		err := os.WriteFile(debugRcFileName, []byte(rcFileStr), 0600)
		if err != nil {
			base.Logf("error writing %s: %v\n", debugRcFileName, err)
		}
	}
	var isOldBashVersion bool
	if sapi.GetShellType() == packet.ShellType_bash {
		bashVersion := sapi.GetLocalMajorVersion()
		isOldBashVersion = (semver.Compare(bashVersion, "v4") < 0)
	}
	var rcFileName string
	var zdotdir string
	if isOldBashVersion {
		rcFileDir, err := base.EnsureRcFilesDir()
		if err != nil {
			return nil, err
		}
		rcFileName = path.Join(rcFileDir, uuid.New().String())
		err = os.WriteFile(rcFileName, []byte(rcFileStr), 0600)
		if err != nil {
			return nil, fmt.Errorf("could not write temp rcfile: %w", err)
		}
		cmd.TmpRcFileName = rcFileName
	} else if sapi.GetShellType() == packet.ShellType_zsh {
		rcFileDir, err := base.EnsureRcFilesDir()
		if err != nil {
			return nil, err
		}
		zdotdir = path.Join(rcFileDir, uuid.New().String())
		os.Mkdir(zdotdir, 0700)
		rcFileName = path.Join(zdotdir, ".zshenv")
		err = os.WriteFile(rcFileName, []byte(rcFileStr), 0600)
		if err != nil {
			return nil, fmt.Errorf("could not write temp rcfile: %w", err)
		}
		cmd.TmpRcFileName = zdotdir
	} else {
		rcFileFdNum, err := AddRunData(pk, rcFileStr, "rcfile")
		if err != nil {
			return nil, err
		}
		rcFileName = fmt.Sprintf("/dev/fd/%d", rcFileFdNum)
	}
	if cmd.TmpRcFileName != "" {
		go func() {
			// cmd.Close() will also remove rcFileName
			// adding this to also try to proactively clean up after 2-seconds.
			time.Sleep(2 * time.Second)
			os.Remove(cmd.TmpRcFileName)
		}()
	}
	cmd.Cmd = sapi.MakeShExecCommand(pk.Command, rcFileName, pk.UsePty)
	if !pk.StateComplete {
		cmd.Cmd.Env = os.Environ()
	}
	shellutil.UpdateCmdEnv(cmd.Cmd, shellenv.EnvMapFromState(state))
	if sapi.GetShellType() == packet.ShellType_zsh {
		shellutil.UpdateCmdEnv(cmd.Cmd, map[string]string{"ZDOTDIR": zdotdir})
	}
	if state.Cwd == "" {
		cmd.Cmd.Dir = base.ExpandHomeDir("~")
	} else if state.Cwd != "" {
		cmd.Cmd.Dir = base.ExpandHomeDir(state.Cwd)
	}
	err = ValidateRemoteFds(pk.Fds)
	if err != nil {
		return nil, err
	}
	var cmdPty *os.File
	var cmdTty *os.File
	if pk.UsePty {
		cmdPty, cmdTty, err = pty.Open()
		if err != nil {
			return nil, fmt.Errorf("opening new pty: %w", err)
		}
		pty.Setsize(cmdPty, GetWinsize(pk))
		defer func() {
			cmdTty.Close()
		}()
		cmd.CmdPty = cmdPty
		shellutil.UpdateCmdEnv(cmd.Cmd, shellutil.MShellEnvVars(getTermType(pk)))
	}
	if cmdTty != nil {
		cmd.Cmd.Stdin = cmdTty
		cmd.Cmd.Stdout = cmdTty
		cmd.Cmd.Stderr = cmdTty
		cmd.Cmd.SysProcAttr = &syscall.SysProcAttr{
			Setsid:  true,
			Setctty: true,
		}
		cmd.Multiplexer.MakeRawFdWriter(0, cmdPty, false, "simple")
		cmd.Multiplexer.MakeRawFdReader(1, cmdPty, false, true)
		nullFd, err := os.Open("/dev/null")
		if err != nil {
			return nil, fmt.Errorf("cannot open /dev/null: %w", err)
		}
		cmd.Multiplexer.MakeRawFdReader(2, nullFd, true, false)
	} else {
		cmd.Cmd.Stdin, err = cmd.Multiplexer.MakeWriterPipe(0, "simple")
		if err != nil {
			return nil, err
		}
		cmd.Cmd.Stdout, err = cmd.Multiplexer.MakeReaderPipe(1)
		if err != nil {
			return nil, err
		}
		cmd.Cmd.Stderr, err = cmd.Multiplexer.MakeReaderPipe(2)
		if err != nil {
			return nil, err
		}
	}
	extraFiles := make([]*os.File, 0, MaxFdNum+1)
	for _, runData := range pk.RunData {
		if runData.FdNum >= len(extraFiles) {
			extraFiles = extraFiles[:runData.FdNum+1]
		}
		extraFiles[runData.FdNum], err = cmd.Multiplexer.MakeStaticWriterPipe(runData.FdNum, runData.Data, MaxRunDataSize, "simple-rundata")
		if err != nil {
			return nil, err
		}
	}
	for _, rfd := range pk.Fds {
		if rfd.FdNum >= len(extraFiles) {
			extraFiles = extraFiles[:rfd.FdNum+1]
		}
		if rfd.Read {
			// client file is open for reading, so we make a writer pipe
			extraFiles[rfd.FdNum], err = cmd.Multiplexer.MakeWriterPipe(rfd.FdNum, "simple")
			if err != nil {
				return nil, err
			}
		}
		if rfd.Write {
			// client file is open for writing, so we make a reader pipe
			extraFiles[rfd.FdNum], err = cmd.Multiplexer.MakeReaderPipe(rfd.FdNum)
			if err != nil {
				return nil, err
			}
		}
	}
	if cmd.ReturnState != nil {
		if cmd.ReturnState.FdNum >= len(extraFiles) {
			extraFiles = extraFiles[:cmd.ReturnState.FdNum+1]
		}
		extraFiles[cmd.ReturnState.FdNum] = rtnStateWriter
	}
	if len(extraFiles) > FirstExtraFilesFdNum {
		cmd.Cmd.ExtraFiles = extraFiles[FirstExtraFilesFdNum:]
	}
	err = cmd.Cmd.Start()
	if err != nil {
		return nil, err
	}
	return cmd, nil
}

// TODO limit size of read state buffer
func (rs *ReturnStateBuf) Run() {
	buf := make([]byte, 1024)
	defer func() {
		rs.Lock.Lock()
		defer rs.Lock.Unlock()
		rs.Reader.Close()
		rs.Done = true
		close(rs.DoneCh)
	}()
	for {
		n, readErr := rs.Reader.Read(buf)
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			rs.Lock.Lock()
			rs.Err = readErr
			rs.Lock.Unlock()
			break
		}
		rs.Lock.Lock()
		rs.Buf = append(rs.Buf, buf[0:n]...)
		if bytes.HasSuffix(rs.Buf, rs.EndBytes) {
			rs.Buf = rs.Buf[:len(rs.Buf)-len(rs.EndBytes)]
			rs.Lock.Unlock()
			break
		}
		rs.Lock.Unlock()
	}
}

// in detached run mode, we don't want mshell to die from signals
// since we want mshell to persist even if the mshell --server is terminated
func SetupSignalsForDetach() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGPIPE)
	go func() {
		for range sigCh {
			// do nothing
		}
	}()
}

// in detached run mode, we don't want mshell to die from signals
// since we want mshell to persist even if the mshell --server is terminated
func IgnoreSigPipe() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGPIPE)
	go func() {
		for sig := range sigCh {
			base.Logf("ignoring signal %v\n", sig)
		}
	}()
}

func copyToCirFile(dest *cirfile.File, src io.Reader) error {
	buf := make([]byte, 64*1024)
	for {
		var appendErr error
		nr, readErr := src.Read(buf)
		if nr > 0 {
			appendErr = dest.AppendData(context.Background(), buf[0:nr])
		}
		if readErr != nil && readErr != io.EOF {
			return readErr
		}
		if appendErr != nil {
			return appendErr
		}
		if readErr == io.EOF {
			return nil
		}
	}
}

func (c *ShExecType) ProcWait() error {
	exitErr := c.Cmd.Wait()
	c.Lock.Lock()
	c.Exited = true
	c.Lock.Unlock()
	return exitErr
}

func (c *ShExecType) IsExited() bool {
	c.Lock.Lock()
	defer c.Lock.Unlock()
	return c.Exited
}

// called in waveshell --single mode (returns the real cmddone packet)
func (c *ShExecType) WaitForCommand() *packet.CmdDonePacketType {
	donePacket := packet.MakeCmdDonePacket(c.CK)
	exitErr := c.ProcWait()
	if c.ReturnState != nil {
		// processing ReturnState *should* be fast. strange bug while running [[[ eval $(ssh-agent -s) ]]]
		// where the process exits, but the ReturnState.Reader does not return EOF!  Limit this to 2 seconds
		go func() {
			time.Sleep(ReturnStateReadWaitTime)
			c.ReturnState.Reader.Close()
		}()
		<-c.ReturnState.DoneCh
		if ForceDebugReturnState {
			wlog.Logf("debug returnstate file %q\n", base.GetDebugReturnStateFileName())
			os.WriteFile(base.GetDebugReturnStateFileName(), c.ReturnState.Buf, 0666)
		}
		state, _, _ := c.SAPI.ParseShellStateOutput(c.ReturnState.Buf) // TODO what to do with error?
		donePacket.FinalState = state
	}
	endTs := time.Now()
	cmdDuration := endTs.Sub(c.StartTs)
	donePacket.Ts = endTs.UnixMilli()
	donePacket.ExitCode = utilfn.GetCmdExitCode(c.Cmd, exitErr)
	donePacket.DurationMs = int64(cmdDuration / time.Millisecond)
	if c.FileNames != nil {
		os.Remove(c.FileNames.StdinFifo) // best effort (no need to check error)
	}
	return donePacket
}

func MakeInitPacket() *packet.InitPacketType {
	initPacket := packet.MakeInitPacket()
	initPacket.Version = base.MShellVersion
	initPacket.BuildTime = base.BuildTime
	initPacket.HomeDir = base.GetHomeDir()
	initPacket.MShellHomeDir = base.GetMShellHomeDir()
	if user, _ := user.Current(); user != nil {
		initPacket.User = user.Username
	}
	initPacket.HostName, _ = os.Hostname()
	initPacket.UName = fmt.Sprintf("%s|%s", runtime.GOOS, runtime.GOARCH)
	initPacket.Shell = shellapi.DetectLocalShellType()
	return initPacket
}

func MakeServerInitPacket() (*packet.InitPacketType, error) {
	var err error
	initPacket := MakeInitPacket()
	initPacket.RemoteId, err = base.GetRemoteId()
	if err != nil {
		return nil, err
	}
	return initPacket, nil
}

func ParseEnv0(env []byte) map[string]string {
	envLines := bytes.Split(env, []byte{0})
	rtn := make(map[string]string)
	for _, envLine := range envLines {
		if len(envLine) == 0 {
			continue
		}
		eqIdx := bytes.Index(envLine, []byte{'='})
		if eqIdx == -1 {
			continue
		}
		varName := string(envLine[0:eqIdx])
		varVal := string(envLine[eqIdx+1:])
		rtn[varName] = varVal
	}
	return rtn
}

func MakeEnv0(envMap map[string]string) []byte {
	var buf bytes.Buffer
	for envName, envVal := range envMap {
		buf.WriteString(envName)
		buf.WriteByte('=')
		buf.WriteString(envVal)
		buf.WriteByte(0)
	}
	return buf.Bytes()
}

func getStderr(err error) string {
	exitErr, ok := err.(*exec.ExitError)
	if !ok {
		return ""
	}
	if len(exitErr.Stderr) == 0 {
		return ""
	}
	lines := strings.SplitN(string(exitErr.Stderr), "\n", 2)
	if len(lines[0]) > 100 {
		return lines[0][0:100]
	}
	return lines[0]
}
