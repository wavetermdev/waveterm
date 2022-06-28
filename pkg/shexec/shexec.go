// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package shexec

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alessio/shellescape"
	"github.com/creack/pty"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/mpio"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

const DefaultRows = 25
const DefaultCols = 80
const MaxRows = 1024
const MaxCols = 1024
const MaxFdNum = 1023
const FirstExtraFilesFdNum = 3

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
	Lock        *sync.Mutex
	StartTs     time.Time
	CK          base.CommandKey
	FileNames   *base.CommandFileNames
	Cmd         *exec.Cmd
	CmdPty      *os.File
	Multiplexer *mpio.Multiplexer
}

func MakeShExec(ck base.CommandKey) *ShExecType {
	return &ShExecType{
		Lock:        &sync.Mutex{},
		StartTs:     time.Now(),
		CK:          ck,
		Multiplexer: mpio.MakeMultiplexer(ck),
	}
}

func (c *ShExecType) Close() {
	if c.CmdPty != nil {
		c.CmdPty.Close()
	}
	c.Multiplexer.Close()
}

func (c *ShExecType) MakeCmdStartPacket() *packet.CmdStartPacketType {
	startPacket := packet.MakeCmdStartPacket()
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
	if cmd.Env != nil {
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

func MakeExecCmd(pk *packet.RunPacketType, cmdTty *os.File) *exec.Cmd {
	ecmd := exec.Command("bash", "-c", pk.Command)
	UpdateCmdEnv(ecmd, pk.Env)
	if pk.Cwd != "" {
		ecmd.Dir = base.ExpandHomeDir(pk.Cwd)
	}
	ecmd.Stdin = cmdTty
	ecmd.Stdout = cmdTty
	ecmd.Stderr = cmdTty
	ecmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid:  true,
		Setctty: true,
	}
	return ecmd
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
			if rfd.Read {
				if rfd.Content == "" {
					return fmt.Errorf("cannot detach command with readable remote files fd=%d", rfd.FdNum)
				}
				if len(rfd.Content) > mpio.ReadBufSize {
					return fmt.Errorf("cannot detach command, constant readable input too large fd=%d, len=%d, max=%d", rfd.FdNum, len(rfd.Content), mpio.ReadBufSize)
				}
			}
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
	return nil
}

func GetWinsize(p *packet.RunPacketType) *pty.Winsize {
	rows := DefaultRows
	cols := DefaultCols
	if p.TermSize.Rows > 0 && p.TermSize.Rows <= MaxRows {
		rows = p.TermSize.Rows
	}
	if p.TermSize.Cols > 0 && p.TermSize.Cols <= MaxCols {
		cols = p.TermSize.Cols
	}
	return &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)}
}

// when err is nil, the command will have already been started
func RunCommand(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, error) {
	err := ValidateRunPacket(pk)
	if err != nil {
		return nil, err
	}
	if !pk.Detached {
		return runCommandSimple(pk, sender)
	} else {
		return runCommandDetached(pk, sender)
	}
}

type SharedSSHOpts struct {
	SSHHost     string
	SSHOptsStr  string
	SSHIdentity string
	SSHUser     string
}

type InstallOpts struct {
	SSHOpts SharedSSHOpts
	ArchStr string
	OptName string
}

type ClientOpts struct {
	SSHOpts           SharedSSHOpts
	Command           string
	Fds               []packet.RemoteFd
	Cwd               string
	Debug             bool
	Sudo              bool
	SudoWithPass      bool
	SudoPw            string
	CommandStdinFdNum int
	Detach            bool
}

func (opts *ClientOpts) MakeExecCmd() *exec.Cmd {
	if opts.SSHOpts.SSHHost == "" {
		ecmd := exec.Command("bash", "-c", strings.TrimSpace(ClientCommand))
		return ecmd
	} else {
		var moreSSHOpts []string
		if opts.SSHOpts.SSHIdentity != "" {
			identityOpt := fmt.Sprintf("-i %s", shellescape.Quote(opts.SSHOpts.SSHIdentity))
			moreSSHOpts = append(moreSSHOpts, identityOpt)
		}
		if opts.SSHOpts.SSHUser != "" {
			userOpt := fmt.Sprintf("-l %s", shellescape.Quote(opts.SSHOpts.SSHUser))
			moreSSHOpts = append(moreSSHOpts, userOpt)
		}
		remoteCommand := strings.TrimSpace(ClientCommand)
		// note that SSHOptsStr is *not* escaped
		sshCmd := fmt.Sprintf("ssh %s %s %s %s", strings.Join(moreSSHOpts, " "), opts.SSHOpts.SSHOptsStr, shellescape.Quote(opts.SSHOpts.SSHHost), shellescape.Quote(remoteCommand))
		ecmd := exec.Command("bash", "-c", sshCmd)
		return ecmd
	}
}

func (opts *InstallOpts) MakeExecCmd() *exec.Cmd {
	var moreSSHOpts []string
	if opts.SSHOpts.SSHIdentity != "" {
		identityOpt := fmt.Sprintf("-i %s", shellescape.Quote(opts.SSHOpts.SSHIdentity))
		moreSSHOpts = append(moreSSHOpts, identityOpt)
	}
	if opts.SSHOpts.SSHUser != "" {
		userOpt := fmt.Sprintf("-l %s", shellescape.Quote(opts.SSHOpts.SSHUser))
		moreSSHOpts = append(moreSSHOpts, userOpt)
	}
	// note that SSHOptsStr is *not* escaped
	installCommand := strings.TrimSpace(InstallCommand)
	sshCmd := fmt.Sprintf("ssh %s %s %s %s", strings.Join(moreSSHOpts, " "), opts.SSHOpts.SSHOptsStr, shellescape.Quote(opts.SSHOpts.SSHHost), shellescape.Quote(installCommand))
	ecmd := exec.Command("bash", "-c", sshCmd)
	return ecmd
}

func (opts *ClientOpts) MakeInstallCommandString(goos string, goarch string) string {
	var moreSSHOpts []string
	if opts.SSHOpts.SSHIdentity != "" {
		identityOpt := fmt.Sprintf("-i %s", shellescape.Quote(opts.SSHOpts.SSHIdentity))
		moreSSHOpts = append(moreSSHOpts, identityOpt)
	}
	if opts.SSHOpts.SSHUser != "" {
		userOpt := fmt.Sprintf("-l %s", shellescape.Quote(opts.SSHOpts.SSHUser))
		moreSSHOpts = append(moreSSHOpts, userOpt)
	}
	if opts.SSHOpts.SSHOptsStr != "" {
		optsOpt := fmt.Sprintf("--ssh-opts %s", shellescape.Quote(opts.SSHOpts.SSHOptsStr))
		moreSSHOpts = append(moreSSHOpts, optsOpt)
	}
	if opts.SSHOpts.SSHHost != "" {
		sshArg := fmt.Sprintf("--ssh %s", shellescape.Quote(opts.SSHOpts.SSHHost))
		moreSSHOpts = append(moreSSHOpts, sshArg)
	}
	return fmt.Sprintf("mshell --install %s %s.%s", strings.Join(moreSSHOpts, " "), goos, goarch)
}

func (opts *ClientOpts) MakeRunPacket() (*packet.RunPacketType, error) {
	runPacket := packet.MakeRunPacket()
	runPacket.Detached = opts.Detach
	runPacket.Cwd = opts.Cwd
	runPacket.Fds = opts.Fds
	if !opts.Sudo {
		// normal, non-sudo command
		runPacket.Command = fmt.Sprintf(RunCommandFmt, opts.Command)
		return runPacket, nil
	}
	if opts.SudoWithPass {
		pwFdNum, err := opts.NextFreeFdNum()
		if err != nil {
			return nil, err
		}
		pwRfd := packet.RemoteFd{FdNum: pwFdNum, Read: true, Content: opts.SudoPw}
		opts.Fds = append(opts.Fds, pwRfd)
		commandFdNum, err := opts.NextFreeFdNum()
		if err != nil {
			return nil, err
		}
		commandRfd := packet.RemoteFd{FdNum: commandFdNum, Read: true, Content: opts.Command}
		opts.Fds = append(opts.Fds, commandRfd)
		commandStdinFdNum, err := opts.NextFreeFdNum()
		if err != nil {
			return nil, err
		}
		commandStdinRfd := packet.RemoteFd{FdNum: commandStdinFdNum, Read: true, DupStdin: true}
		opts.Fds = append(opts.Fds, commandStdinRfd)
		opts.CommandStdinFdNum = commandStdinFdNum
		maxFdNum := opts.MaxFdNum()
		runPacket.Command = fmt.Sprintf(RunSudoPasswordCommandFmt, pwFdNum, maxFdNum+1, pwFdNum, commandFdNum, commandStdinFdNum)
		runPacket.Fds = opts.Fds
		return runPacket, nil
	} else {
		commandFdNum, err := opts.NextFreeFdNum()
		if err != nil {
			return nil, err
		}
		rfd := packet.RemoteFd{FdNum: commandFdNum, Read: true, Content: opts.Command}
		opts.Fds = append(opts.Fds, rfd)
		maxFdNum := opts.MaxFdNum()
		runPacket.Command = fmt.Sprintf(RunSudoCommandFmt, maxFdNum+1, commandFdNum)
		runPacket.Fds = opts.Fds
		return runPacket, nil
	}
}

func (opts *ClientOpts) NextFreeFdNum() (int, error) {
	fdMap := make(map[int]bool)
	for _, fd := range opts.Fds {
		fdMap[fd.FdNum] = true
	}
	for i := 3; i <= MaxFdNum; i++ {
		if !fdMap[i] {
			return i, nil
		}
	}
	return 0, fmt.Errorf("reached maximum number of fds, all fds between 3-%d are in use", MaxFdNum)
}

func (opts *ClientOpts) MaxFdNum() int {
	maxFdNum := 3
	for _, fd := range opts.Fds {
		if fd.FdNum > maxFdNum {
			maxFdNum = fd.FdNum
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

func RunInstallSSHCommand(opts *InstallOpts) error {
	ecmd := opts.MakeExecCmd()
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
	fd, err := os.Open(opts.OptName)
	if err != nil {
		return fmt.Errorf("cannot open '%s': %w", opts.OptName, err)
	}
	go func() {
		defer inputWriter.Close()
		io.Copy(inputWriter, fd)
	}()
	packetParser := packet.MakePacketParser(stdoutReader)
	err = ecmd.Start()
	if err != nil {
		return fmt.Errorf("running ssh command: %w", err)
	}
	for pk := range packetParser.MainCh {
		if pk.GetType() == packet.InitPacketStr {
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

func RunClientSSHCommandAndWait(opts *ClientOpts) (*packet.CmdDonePacketType, error) {
	err := ValidateRemoteFds(opts.Fds)
	if err != nil {
		return nil, err
	}
	runPacket, err := opts.MakeRunPacket() // modifies opts
	if err != nil {
		return nil, err
	}
	cmd := MakeShExec("")
	ecmd := opts.MakeExecCmd()
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
	if !opts.SudoWithPass {
		cmd.Multiplexer.MakeRawFdReader(0, os.Stdin, false)
	}
	cmd.Multiplexer.MakeRawFdWriter(1, os.Stdout, false)
	cmd.Multiplexer.MakeRawFdWriter(2, os.Stderr, false)
	for _, rfd := range runPacket.Fds {
		if rfd.Read && rfd.Content != "" {
			err = cmd.Multiplexer.MakeStringFdReader(rfd.FdNum, rfd.Content)
			if err != nil {
				return nil, fmt.Errorf("creating content fd %d", rfd.FdNum)
			}
			continue
		}
		if rfd.Read && rfd.DupStdin {
			cmd.Multiplexer.MakeRawFdReader(rfd.FdNum, os.Stdin, false)
			continue
		}
		fd := os.NewFile(uintptr(rfd.FdNum), fmt.Sprintf("/dev/fd/%d", rfd.FdNum))
		if fd == nil {
			return nil, fmt.Errorf("cannot open fd %d", rfd.FdNum)
		}
		if rfd.Read {
			cmd.Multiplexer.MakeRawFdReader(rfd.FdNum, fd, true)
		} else if rfd.Write {
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
				fmt.Printf("UNAME> %s\n", initPk.UName)
				if initPk.UName == "" {
					return nil, fmt.Errorf("mshell command not found on remote server, no uname detected")
				}
				goos, goarch, err := UNameStringToGoArch(initPk.UName)
				if err != nil {
					return nil, fmt.Errorf("mshell command not found on remote server, architecture cannot be detected (might be incompatible with mshell): %w", err)
				}
				installCmd := opts.MakeInstallCommandString(goos, goarch)
				return nil, fmt.Errorf("mshell command not found on remote server, can install with '%s'", installCmd)
			}
			if initPk.Version != base.MShellVersion {
				return nil, fmt.Errorf("invalid remote mshell version 'v%s', must be v%s", initPk.Version, base.MShellVersion)
			}
			versionOk = true
			if opts.Debug {
				fmt.Printf("VERSION> %s\n", initPk.Version)
			}
			break
		}
	}
	if !versionOk {
		return nil, fmt.Errorf("did not receive version from remote mshell")
	}
	sender.SendPacket(runPacket)
	if opts.Debug {
		cmd.Multiplexer.Debug = true
	}
	remoteDonePacket := cmd.Multiplexer.RunIOAndWait(packetParser, sender, false, true, true)
	donePacket := cmd.WaitForCommand()
	if remoteDonePacket != nil {
		donePacket = remoteDonePacket
	}
	return donePacket, nil
}

func UNameStringToGoArch(uname string) (string, string, error) {
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

func runCommandSimple(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, error) {
	cmd := MakeShExec(pk.CK)
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
	extraFiles := make([]*os.File, 0, MaxFdNum+1)
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

func runCommandDetached(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, error) {
	fileNames, err := base.GetCommandFileNames(pk.CK)
	if err != nil {
		return nil, err
	}
	ptyOutInfo, err := os.Stat(fileNames.PtyOutFile)
	if err == nil { // non-nil error will be caught by regular OpenFile below
		// must have size 0
		if ptyOutInfo.Size() != 0 {
			return nil, fmt.Errorf("cmdkey '%s' was already used (ptyout len=%d)", pk.CK, ptyOutInfo.Size())
		}
	}
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	pty.Setsize(cmdPty, GetWinsize(pk))
	defer func() {
		cmdTty.Close()
	}()
	rtn := MakeShExec(pk.CK)
	ecmd := MakeExecCmd(pk, cmdTty)
	err = ecmd.Start()
	if err != nil {
		return nil, fmt.Errorf("starting command: %w", err)
	}
	ptyOutFd, err := os.OpenFile(fileNames.PtyOutFile, os.O_TRUNC|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("cannot open ptyout file '%s': %w", fileNames.PtyOutFile, err)
	}
	go func() {
		// copy pty output to .ptyout file
		_, copyErr := io.Copy(ptyOutFd, cmdPty)
		if copyErr != nil {
			sender.SendErrorPacket(fmt.Sprintf("copying pty output to ptyout file: %v", copyErr))
		}
	}()
	go func() {
		// copy .stdin fifo contents to pty input
		copyFifoErr := MakeAndCopyStdinFifo(cmdPty, fileNames.StdinFifo)
		if copyFifoErr != nil {
			sender.SendErrorPacket(fmt.Sprintf("reading from stdin fifo: %v", copyFifoErr))
		}
	}()
	rtn.FileNames = fileNames
	rtn.Cmd = ecmd
	rtn.CmdPty = cmdPty
	return rtn, nil
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
	donePacket := packet.MakeCmdDonePacket()
	donePacket.Ts = endTs.UnixMilli()
	donePacket.CK = c.CK
	donePacket.ExitCode = exitCode
	donePacket.DurationMs = int64(cmdDuration / time.Millisecond)
	if c.FileNames != nil {
		os.Remove(c.FileNames.StdinFifo) // best effort (no need to check error)
	}
	return donePacket
}
