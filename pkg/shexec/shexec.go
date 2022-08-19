// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package shexec

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"os/user"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alessio/shellescape"
	"github.com/creack/pty"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/cirfile"
	"github.com/scripthaus-dev/mshell/pkg/mpio"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"golang.org/x/sys/unix"
)

const DefaultRows = 25
const DefaultCols = 80
const MaxRows = 1024
const MaxCols = 1024
const MaxFdNum = 1023
const FirstExtraFilesFdNum = 3
const DefaultTermType = "xterm-256color"
const DefaultMaxPtySize = 1024 * 1024

const ClientCommand = `
PATH=$PATH:~/.mshell;
which mshell > /dev/null;
if [[ "$?" -ne 0 ]]
then
  printf "\n##N{\"type\": \"init\", \"notfound\": true, \"uname\": \"%s | %s\"}\n" "$(uname -s)" "$(uname -m)"
else
  mshell --single
fi
`

const InstallCommand = `
printf "\n##N{\"type\": \"init\", \"notfound\": true, \"uname\": \"%s | %s\"}\n" "$(uname -s)" "$(uname -m)";
mkdir -p ~/.mshell/;
cat > ~/.mshell/mshell.temp; 
mv ~/.mshell/mshell.temp ~/.mshell/mshell;
chmod a+x ~/.mshell/mshell;
~/.mshell/mshell --single --version
`

const RunCommandFmt = `%s`
const RunSudoCommandFmt = `sudo -n -C %d bash /dev/fd/%d`
const RunSudoPasswordCommandFmt = `cat /dev/fd/%d | sudo -k -S -C %d bash -c "echo '[from-mshell]'; exec %d>&-; bash /dev/fd/%d < /dev/fd/%d"`

type ShExecType struct {
	Lock           *sync.Mutex
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

func MakeShExec(ck base.CommandKey, upr packet.UnknownPacketReporter) *ShExecType {
	return &ShExecType{
		Lock:        &sync.Mutex{},
		StartTs:     time.Now(),
		CK:          ck,
		Multiplexer: mpio.MakeMultiplexer(ck, upr),
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
}

func (c *ShExecType) MakeCmdStartPacket(reqId string) *packet.CmdStartPacketType {
	startPacket := packet.MakeCmdStartPacket(reqId)
	startPacket.Ts = time.Now().UnixMilli()
	startPacket.CK = c.CK
	startPacket.Pid = c.Cmd.Process.Pid
	startPacket.MShellPid = os.Getpid()
	return startPacket
}

func getEnvStrKey(envStr string) string {
	eqIdx := strings.Index(envStr, "=")
	if eqIdx == -1 {
		return envStr
	}
	return envStr[0:eqIdx]
}

func UpdateCmdEnv(cmd *exec.Cmd, envVars map[string]string) {
	if len(envVars) == 0 {
		return
	}
	if cmd.Env == nil {
		cmd.Env = os.Environ()
	}
	found := make(map[string]bool)
	var newEnv []string
	for _, envStr := range cmd.Env {
		envKey := getEnvStrKey(envStr)
		newEnvVal, ok := envVars[envKey]
		if ok {
			if newEnvVal == "" {
				continue
			}
			newEnv = append(newEnv, envKey+"="+newEnvVal)
			found[envKey] = true
		} else {
			newEnv = append(newEnv, envStr)
		}
	}
	for envKey, envVal := range envVars {
		if found[envKey] {
			continue
		}
		newEnv = append(newEnv, envKey+"="+envVal)
	}
	cmd.Env = newEnv
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

func MakeDetachedExecCmd(pk *packet.RunPacketType, cmdTty *os.File) (*exec.Cmd, error) {
	ecmd := exec.Command("bash", "-c", pk.Command)
	UpdateCmdEnv(ecmd, pk.Env)
	UpdateCmdEnv(ecmd, map[string]string{"TERM": getTermType(pk)})
	if pk.Cwd != "" {
		ecmd.Dir = base.ExpandHomeDir(pk.Cwd)
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

func MakeRunnerExec(ck base.CommandKey) (*exec.Cmd, error) {
	msPath, err := base.GetMShellPath()
	if err != nil {
		return nil, err
	}
	ecmd := exec.Command(msPath, string(ck))
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
			if rd.DataLen > mpio.ReadBufSize {
				return fmt.Errorf("cannot detach command, constant rundata input too large fd=%d, len=%d, max=%d", rd.FdNum, rd.DataLen, mpio.ReadBufSize)
			}
			totalRunData += rd.DataLen
		}
		if totalRunData > mpio.MaxTotalRunDataSize {
			return fmt.Errorf("cannot detach command, constant rundata input too large len=%d, max=%d", totalRunData, mpio.MaxTotalRunDataSize)
		}
	}
	if pk.Cwd != "" {
		realCwd := base.ExpandHomeDir(pk.Cwd)
		dirInfo, err := os.Stat(realCwd)
		if err != nil {
			return fmt.Errorf("invalid cwd '%s' for command: %v", realCwd, err)
		}
		if !dirInfo.IsDir() {
			return fmt.Errorf("invalid cwd '%s' for command, not a directory", realCwd)
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
	rows := DefaultRows
	cols := DefaultCols
	if p.TermOpts != nil {
		if p.TermOpts.Rows > 0 && p.TermOpts.Rows <= MaxRows {
			rows = p.TermOpts.Rows
		}
		if p.TermOpts.Cols > 0 && p.TermOpts.Cols <= MaxCols {
			cols = p.TermOpts.Cols
		}
	}
	return &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)}
}

type SSHOpts struct {
	SSHHost     string
	SSHOptsStr  string
	SSHIdentity string
	SSHUser     string
}

type InstallOpts struct {
	SSHOpts SSHOpts
	ArchStr string
	OptName string
	Detect  bool
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

func (opts SSHOpts) MakeSSHInstallCmd() (*exec.Cmd, error) {
	if opts.SSHHost == "" {
		return nil, fmt.Errorf("no ssh host provided, can only install to a remote host")
	}
	return opts.MakeSSHExecCmd(InstallCommand), nil
}

func (opts SSHOpts) MakeMShellServerCmd() (*exec.Cmd, error) {
	msPath, err := base.GetMShellPath()
	if err != nil {
		return nil, err
	}
	ecmd := exec.Command(msPath, "--server")
	return ecmd, nil
}

func (opts SSHOpts) MakeMShellSingleCmd() (*exec.Cmd, error) {
	if opts.SSHHost == "" {
		execFile, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("cannot find local mshell executable: %w", err)
		}
		ecmd := exec.Command(execFile, "--single")
		return ecmd, nil
	}
	return opts.MakeSSHExecCmd(ClientCommand), nil
}

func (opts SSHOpts) MakeSSHExecCmd(remoteCommand string) *exec.Cmd {
	remoteCommand = strings.TrimSpace(remoteCommand)
	if opts.SSHHost == "" {
		ecmd := exec.Command("bash", "-c", remoteCommand)
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
		// note that SSHOptsStr is *not* escaped
		sshCmd := fmt.Sprintf("ssh %s %s %s %s", strings.Join(moreSSHOpts, " "), opts.SSHOptsStr, shellescape.Quote(opts.SSHHost), shellescape.Quote(remoteCommand))
		ecmd := exec.Command("bash", "-c", sshCmd)
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

func (opts *ClientOpts) MakeRunPacket() (*packet.RunPacketType, error) {
	runPacket := packet.MakeRunPacket()
	runPacket.Detached = opts.Detach
	runPacket.Cwd = opts.Cwd
	runPacket.Fds = opts.Fds
	if opts.UsePty {
		runPacket.UsePty = true
		runPacket.TermOpts = &packet.TermOpts{}
		rows, cols, err := GetTerminalSize()
		if err == nil {
			runPacket.TermOpts.Rows = rows
			runPacket.TermOpts.Cols = cols
		}
		term := os.Getenv("TERM")
		if term != "" {
			runPacket.TermOpts.Term = term
		}
	}
	if !opts.Sudo {
		// normal, non-sudo command
		runPacket.Command = fmt.Sprintf(RunCommandFmt, opts.Command)
		return runPacket, nil
	}
	if opts.SudoWithPass {
		pwFdNum, err := AddRunData(runPacket, opts.SudoPw, "sudo pw")
		if err != nil {
			return nil, err
		}
		commandFdNum, err := AddRunData(runPacket, opts.Command, "command")
		if err != nil {
			return nil, err
		}
		commandStdinFdNum, err := NextFreeFdNum(runPacket)
		if err != nil {
			return nil, err
		}
		commandStdinRfd := packet.RemoteFd{FdNum: commandStdinFdNum, Read: true, DupStdin: true}
		runPacket.Fds = append(runPacket.Fds, commandStdinRfd)
		maxFdNum := MaxFdNumInPacket(runPacket)
		runPacket.Command = fmt.Sprintf(RunSudoPasswordCommandFmt, pwFdNum, maxFdNum+1, pwFdNum, commandFdNum, commandStdinFdNum)
		return runPacket, nil
	} else {
		commandFdNum, err := AddRunData(runPacket, opts.Command, "command")
		if err != nil {
			return nil, err
		}
		maxFdNum := MaxFdNumInPacket(runPacket)
		runPacket.Command = fmt.Sprintf(RunSudoCommandFmt, maxFdNum+1, commandFdNum)
		return runPacket, nil
	}
}

func AddRunData(pk *packet.RunPacketType, data string, dataType string) (int, error) {
	if len(data) > mpio.ReadBufSize {
		return 0, fmt.Errorf("%s too large, exceeds read buffer size", dataType)
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

func sendOptFile(input io.WriteCloser, optName string) error {
	fd, err := os.Open(optName)
	if err != nil {
		return fmt.Errorf("cannot open '%s': %w", optName, err)
	}
	go func() {
		defer input.Close()
		io.Copy(input, fd)
	}()
	return nil
}

func RunInstallSSHCommand(opts *InstallOpts) error {
	tryDetect := opts.Detect
	ecmd, err := opts.SSHOpts.MakeSSHInstallCmd()
	if err != nil {
		return err
	}
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
	if opts.OptName != "" {
		sendOptFile(inputWriter, opts.OptName)
	}
	packetParser := packet.MakePacketParser(stdoutReader)
	err = ecmd.Start()
	if err != nil {
		return fmt.Errorf("running ssh command: %w", err)
	}
	firstInit := true
	for pk := range packetParser.MainCh {
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
			fmt.Printf("mshell detected remote architecture as '%s.%s'\n", goos, goarch)
			optName := base.GoArchOptFile(goos, goarch)
			sendOptFile(inputWriter, optName)
			continue
		}
		if pk.GetType() == packet.InitPacketStr && !firstInit {
			initPacket := pk.(*packet.InitPacketType)
			if initPacket.Version == base.MShellVersion {
				fmt.Printf("mshell %s, installed successfully at %s:~/.mshell/mshell\n", initPacket.Version, opts.SSHOpts.SSHHost)
				return nil
			}
			return fmt.Errorf("invalid version '%s' received from client, expecting '%s'", initPacket.Version, base.MShellVersion)
		}
		if pk.GetType() == packet.RawPacketStr {
			rawPk := pk.(*packet.RawPacketType)
			fmt.Printf("%s\n", rawPk.Data)
			continue
		}
		return fmt.Errorf("invalid response packet '%s' received from client", pk.GetType())
	}
	return fmt.Errorf("did not receive version string from client, install not successful")
}

func HasDupStdin(fds []packet.RemoteFd) bool {
	for _, rfd := range fds {
		if rfd.Read && rfd.DupStdin {
			return true
		}
	}
	return false
}

func RunClientSSHCommandAndWait(runPacket *packet.RunPacketType, fdContext FdContext, sshOpts SSHOpts, upr packet.UnknownPacketReporter, debug bool) (*packet.CmdDonePacketType, error) {
	cmd := MakeShExec(runPacket.CK, upr)
	ecmd, err := sshOpts.MakeMShellSingleCmd()
	if err != nil {
		return nil, err
	}
	cmd.Cmd = ecmd
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stdin pipe: %v", err)
	}
	stdoutReader, err := ecmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stdout pipe: %v", err)
	}
	stderrReader, err := ecmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("creating stderr pipe: %v", err)
	}
	if !HasDupStdin(runPacket.Fds) {
		cmd.Multiplexer.MakeRawFdReader(0, fdContext.GetReader(0), false, false)
	}
	cmd.Multiplexer.MakeRawFdWriter(1, fdContext.GetWriter(1), false)
	cmd.Multiplexer.MakeRawFdWriter(2, fdContext.GetWriter(2), false)
	for _, rfd := range runPacket.Fds {
		if rfd.Read && rfd.DupStdin {
			cmd.Multiplexer.MakeRawFdReader(rfd.FdNum, fdContext.GetReader(0), false, false)
			continue
		}
		if rfd.Read {
			fd := fdContext.GetReader(rfd.FdNum)
			cmd.Multiplexer.MakeRawFdReader(rfd.FdNum, fd, false, false)
		} else if rfd.Write {
			fd := fdContext.GetWriter(rfd.FdNum)
			cmd.Multiplexer.MakeRawFdWriter(rfd.FdNum, fd, true)
		}
	}
	err = ecmd.Start()
	if err != nil {
		return nil, fmt.Errorf("running ssh command: %w", err)
	}
	defer cmd.Close()
	stdoutPacketParser := packet.MakePacketParser(stdoutReader)
	stderrPacketParser := packet.MakePacketParser(stderrReader)
	packetParser := packet.CombinePacketParsers(stdoutPacketParser, stderrPacketParser)
	sender := packet.MakePacketSender(inputWriter)
	versionOk := false
	for pk := range packetParser.MainCh {
		if pk.GetType() == packet.RawPacketStr {
			rawPk := pk.(*packet.RawPacketType)
			fmt.Printf("%s\n", rawPk.Data)
			continue
		}
		if pk.GetType() == packet.InitPacketStr {
			initPk := pk.(*packet.InitPacketType)
			if initPk.NotFound {
				if sshOpts.SSHHost == "" {
					return nil, fmt.Errorf("mshell command not found on local server")
				}
				if initPk.UName == "" {
					return nil, fmt.Errorf("mshell command not found on remote server, no uname detected")
				}
				goos, goarch, err := DetectGoArch(initPk.UName)
				if err != nil {
					return nil, fmt.Errorf("mshell command not found on remote server, architecture cannot be detected (might be incompatible with mshell): %w", err)
				}
				sshOptsStr := sshOpts.MakeMShellSSHOpts()
				return nil, fmt.Errorf("mshell command not found on remote server, can install with 'mshell --install %s %s.%s'", sshOptsStr, goos, goarch)
			}
			if initPk.Version != base.MShellVersion {
				return nil, fmt.Errorf("invalid remote mshell version 'v%s', must be v%s", initPk.Version, base.MShellVersion)
			}
			versionOk = true
			if debug {
				fmt.Printf("VERSION> %s\n", initPk.Version)
			}
			break
		}
	}
	if !versionOk {
		return nil, fmt.Errorf("did not receive version from remote mshell")
	}
	SendRunPacketAndRunData(context.Background(), sender, runPacket)
	if debug {
		cmd.Multiplexer.Debug = true
	}
	remoteDonePacket := cmd.Multiplexer.RunIOAndWait(packetParser, sender, false, true, true)
	donePacket := cmd.WaitForCommand()
	if remoteDonePacket != nil {
		donePacket = remoteDonePacket
	}
	return donePacket, nil
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
	} else if archVal == "aarch64" || archVal == "amd64" {
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
	cmd.Multiplexer.RunIOAndWait(packetParser, sender, true, false, false)
	donePacket := cmd.WaitForCommand()
	sender.SendPacket(donePacket)
}

func getTermType(pk *packet.RunPacketType) string {
	termType := DefaultTermType
	if pk.TermOpts != nil && pk.TermOpts.Term != "" {
		termType = pk.TermOpts.Term
	}
	return termType
}

func RunCommandSimple(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, error) {
	cmd := MakeShExec(pk.CK, nil)
	cmd.Cmd = exec.Command("bash", "-c", pk.Command)
	UpdateCmdEnv(cmd.Cmd, pk.Env)
	if pk.Cwd != "" {
		cmd.Cmd.Dir = base.ExpandHomeDir(pk.Cwd)
	}
	err := ValidateRemoteFds(pk.Fds)
	if err != nil {
		cmd.Close()
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
		UpdateCmdEnv(cmd.Cmd, map[string]string{"TERM": getTermType(pk)})
	}
	if cmdTty != nil {
		cmd.Cmd.Stdin = cmdTty
		cmd.Cmd.Stdout = cmdTty
		cmd.Cmd.Stderr = cmdTty
		cmd.Cmd.SysProcAttr = &syscall.SysProcAttr{
			Setsid:  true,
			Setctty: true,
		}
		cmd.Multiplexer.MakeRawFdWriter(0, cmdPty, false)
		cmd.Multiplexer.MakeRawFdReader(1, cmdPty, false, true)
		nullFd, err := os.Open("/dev/null")
		if err != nil {
			cmd.Close()
			return nil, fmt.Errorf("cannot open /dev/null: %w", err)
		}
		cmd.Multiplexer.MakeRawFdReader(2, nullFd, true, false)
	} else {
		cmd.Cmd.Stdin, err = cmd.Multiplexer.MakeWriterPipe(0)
		if err != nil {
			cmd.Close()
			return nil, err
		}
		cmd.Cmd.Stdout, err = cmd.Multiplexer.MakeReaderPipe(1)
		if err != nil {
			cmd.Close()
			return nil, err
		}
		cmd.Cmd.Stderr, err = cmd.Multiplexer.MakeReaderPipe(2)
		if err != nil {
			cmd.Close()
			return nil, err
		}
	}
	extraFiles := make([]*os.File, 0, MaxFdNum+1)
	for _, runData := range pk.RunData {
		if runData.FdNum >= len(extraFiles) {
			extraFiles = extraFiles[:runData.FdNum+1]
		}
		extraFiles[runData.FdNum], err = cmd.Multiplexer.MakeStaticWriterPipe(runData.FdNum, runData.Data)
		if err != nil {
			cmd.Close()
			return nil, err
		}
	}
	for _, rfd := range pk.Fds {
		if rfd.FdNum >= len(extraFiles) {
			extraFiles = extraFiles[:rfd.FdNum+1]
		}
		if rfd.Read {
			// client file is open for reading, so we make a writer pipe
			extraFiles[rfd.FdNum], err = cmd.Multiplexer.MakeWriterPipe(rfd.FdNum)
			if err != nil {
				cmd.Close()
				return nil, err
			}
		}
		if rfd.Write {
			// client file is open for writing, so we make a reader pipe
			extraFiles[rfd.FdNum], err = cmd.Multiplexer.MakeReaderPipe(rfd.FdNum)
			if err != nil {
				cmd.Close()
				return nil, err
			}
		}
	}
	if len(extraFiles) > FirstExtraFilesFdNum {
		cmd.Cmd.ExtraFiles = extraFiles[FirstExtraFilesFdNum:]
	}

	err = cmd.Cmd.Start()
	if err != nil {
		cmd.Close()
		return nil, err
	}
	return cmd, nil
}

// in detached run mode, we don't want mshell to die from signals
// since we want mshell to persist even if the mshell --server is terminated
func SetupSignalsForDetach() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		for range sigCh {
			// do nothing
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

func (cmd *ShExecType) DetachedWait(startPacket *packet.CmdStartPacketType) {
	// after Start(), any output/errors must go to DetachedOutput
	// close stdin, redirect stdout/stderr to /dev/null, but wait for cmdstart packet to get sent
	cmd.DetachedOutput.SendPacket(startPacket)
	err := os.Stdin.Close()
	if err != nil {
		cmd.DetachedOutput.SendCmdError(cmd.CK, fmt.Errorf("cannot close stdin: %w", err))
	}
	err = unix.Dup2(int(cmd.RunnerOutFd.Fd()), int(os.Stdout.Fd()))
	if err != nil {
		cmd.DetachedOutput.SendCmdError(cmd.CK, fmt.Errorf("cannot dup2 stdin to runout: %w", err))
	}
	err = unix.Dup2(int(cmd.RunnerOutFd.Fd()), int(os.Stderr.Fd()))
	if err != nil {
		cmd.DetachedOutput.SendCmdError(cmd.CK, fmt.Errorf("cannot dup2 stdin to runout: %w", err))
	}
	ptyOutFile, err := cirfile.CreateCirFile(cmd.FileNames.PtyOutFile, cmd.MaxPtySize)
	if err != nil {
		cmd.DetachedOutput.SendCmdError(cmd.CK, fmt.Errorf("cannot open ptyout file '%s': %w", cmd.FileNames.PtyOutFile, err))
		// don't return (command is already running)
	}
	ptyCopyDone := make(chan bool)
	go func() {
		// copy pty output to .ptyout file
		defer close(ptyCopyDone)
		defer ptyOutFile.Close()
		copyErr := copyToCirFile(ptyOutFile, cmd.CmdPty)
		if copyErr != nil {
			cmd.DetachedOutput.SendCmdError(cmd.CK, fmt.Errorf("copying pty output to ptyout file: %w", copyErr))
		}
	}()
	go func() {
		// copy .stdin fifo contents to pty input
		copyFifoErr := MakeAndCopyStdinFifo(cmd.CmdPty, cmd.FileNames.StdinFifo)
		if copyFifoErr != nil {
			cmd.DetachedOutput.SendCmdError(cmd.CK, fmt.Errorf("reading from stdin fifo: %w", copyFifoErr))
		}
	}()
	donePacket := cmd.WaitForCommand()
	cmd.DetachedOutput.SendPacket(donePacket)
	<-ptyCopyDone
	cmd.Close()
	return
}

func RunCommandDetached(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, *packet.CmdStartPacketType, error) {
	fileNames, err := base.GetCommandFileNames(pk.CK)
	if err != nil {
		return nil, nil, err
	}
	runOutInfo, err := os.Stat(fileNames.RunnerOutFile)
	if err == nil { // non-nil error will be caught by regular OpenFile below
		// must have size 0
		if runOutInfo.Size() != 0 {
			return nil, nil, fmt.Errorf("cmdkey '%s' was already used (runout len=%d)", pk.CK, runOutInfo.Size())
		}
	}
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, nil, fmt.Errorf("opening new pty: %w", err)
	}
	pty.Setsize(cmdPty, GetWinsize(pk))
	defer func() {
		cmdTty.Close()
	}()
	cmd := MakeShExec(pk.CK, nil)
	cmd.FileNames = fileNames
	cmd.CmdPty = cmdPty
	cmd.Detached = true
	if pk.TermOpts != nil && pk.TermOpts.MaxPtySize != 0 {
		cmd.MaxPtySize = pk.TermOpts.MaxPtySize
	} else {
		cmd.MaxPtySize = DefaultMaxPtySize
	}
	cmd.RunnerOutFd, err = os.OpenFile(fileNames.RunnerOutFile, os.O_TRUNC|os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return nil, nil, fmt.Errorf("cannot open runout file '%s': %w", fileNames.RunnerOutFile, err)
	}
	cmd.DetachedOutput = packet.MakePacketSender(cmd.RunnerOutFd)
	ecmd, err := MakeDetachedExecCmd(pk, cmdTty)
	if err != nil {
		return nil, nil, err
	}
	cmd.Cmd = ecmd
	SetupSignalsForDetach()
	err = ecmd.Start()
	if err != nil {
		return nil, nil, fmt.Errorf("starting command: %w", err)
	}
	for _, fd := range ecmd.ExtraFiles {
		if fd != cmdTty {
			fd.Close()
		}
	}
	startPacket := cmd.MakeCmdStartPacket(pk.ReqId)
	return cmd, startPacket, nil
}

func GetExitCode(err error) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	} else {
		return -1
	}
}

func (c *ShExecType) WaitForCommand() *packet.CmdDonePacketType {
	exitErr := c.Cmd.Wait()
	endTs := time.Now()
	cmdDuration := endTs.Sub(c.StartTs)
	exitCode := GetExitCode(exitErr)
	donePacket := packet.MakeCmdDonePacket(c.CK)
	donePacket.Ts = endTs.UnixMilli()
	donePacket.ExitCode = exitCode
	donePacket.DurationMs = int64(cmdDuration / time.Millisecond)
	if c.FileNames != nil {
		os.Remove(c.FileNames.StdinFifo) // best effort (no need to check error)
	}
	return donePacket
}

func MakeInitPacket() *packet.InitPacketType {
	initPacket := packet.MakeInitPacket()
	initPacket.Version = base.MShellVersion
	initPacket.HomeDir = base.GetHomeDir()
	initPacket.MShellHomeDir = base.GetMShellHomeDir()
	if user, _ := user.Current(); user != nil {
		initPacket.User = user.Username
	}
	initPacket.HostName, _ = os.Hostname()
	return initPacket
}

func MakeServerInitPacket() (*packet.InitPacketType, error) {
	var err error
	initPacket := MakeInitPacket()
	initPacket.Env = os.Environ()
	initPacket.RemoteId, err = base.GetRemoteId()
	if err != nil {
		return nil, err
	}
	return initPacket, nil
}
