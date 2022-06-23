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

	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

const DefaultRows = 25
const DefaultCols = 80
const MaxRows = 1024
const MaxCols = 1024

type ShExecType struct {
	StartTs         time.Time
	RunPacket       *packet.RunPacketType
	FileNames       *base.CommandFileNames
	Cmd             *exec.Cmd
	CmdPty          *os.File
	FdReaders       map[int]*os.File
	FdWriters       map[int]*os.File
	CloseAfterStart []*os.File
}

func MakeShExec(pk *packet.RunPacketType) *ShExecType {
	return &ShExecType{
		StartTs:   time.Now(),
		RunPacket: pk,
		FdReaders: make(map[int]*os.File),
		FdWriters: make(map[int]*os.File),
	}
}

func (c *ShExecType) Close() {
	if c.CmdPty != nil {
		c.CmdPty.Close()
	}
	for _, fd := range c.FdReaders {
		fd.Close()
	}
	for _, fd := range c.FdWriters {
		fd.Close()
	}
	for _, fd := range c.CloseAfterStart {
		fd.Close()
	}
}

func (c *ShExecType) MakeCmdStartPacket() *packet.CmdStartPacketType {
	startPacket := packet.MakeCmdStartPacket()
	startPacket.Ts = time.Now().UnixMilli()
	startPacket.SessionId = c.RunPacket.SessionId
	startPacket.CmdId = c.RunPacket.CmdId
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
		ecmd.Dir = pk.Cwd
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

func MakeRunnerExec(cmdId string) (*exec.Cmd, error) {
	msPath, err := base.GetMShellPath()
	if err != nil {
		return nil, err
	}
	ecmd := exec.Command(msPath, cmdId)
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
		if pk.SessionId == "" {
			return fmt.Errorf("run packet does not have sessionid")
		}
		_, err := uuid.Parse(pk.SessionId)
		if err != nil {
			return fmt.Errorf("invalid sessionid '%s' for command", pk.SessionId)
		}
		if pk.CmdId == "" {
			return fmt.Errorf("run packet does not have cmdid")
		}
		_, err = uuid.Parse(pk.CmdId)
		if err != nil {
			return fmt.Errorf("invalid cmdid '%s' for command", pk.CmdId)
		}
	}
	if pk.Cwd != "" {
		dirInfo, err := os.Stat(pk.Cwd)
		if err != nil {
			return fmt.Errorf("invalid cwd '%s' for command: %v", pk.Cwd, err)
		}
		if !dirInfo.IsDir() {
			return fmt.Errorf("invalid cwd '%s' for command, not a directory", pk.Cwd)
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

// returns the *writer* to connect to process, reader is put in FdReaders
func (cmd *ShExecType) makeReaderPipe(fdNum int) (*os.File, error) {
	pr, pw, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	cmd.FdReaders[fdNum] = pr
	cmd.CloseAfterStart = append(cmd.CloseAfterStart, pw)
	return pw, nil
}

// returns the *reader* to connect to process, writer is put in FdWriters
func (cmd *ShExecType) makeWriterPipe(fdNum int) (*os.File, error) {
	pr, pw, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	cmd.FdWriters[fdNum] = pw
	cmd.CloseAfterStart = append(cmd.CloseAfterStart, pr)
	return pr, nil
}

func (cmd *ShExecType) MakeDataPacket(fdNum int, data []byte) *packet.DataPacketType {
	pk := packet.MakeDataPacket()
	pk.SessionId = cmd.RunPacket.SessionId
	pk.CmdId = cmd.RunPacket.CmdId
	pk.FdNum = fdNum
	pk.Data = string(data)
	return pk
}

func (cmd *ShExecType) runReadLoop(wg *sync.WaitGroup, fdNum int, fd *os.File, sender *packet.PacketSender) {
	go func() {
		defer fd.Close()
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			nr, err := fd.Read(buf)
			pk := cmd.MakeDataPacket(fdNum, buf[0:nr])
			if err == io.EOF {
				pk.Eof = true
				sender.SendPacket(pk)
				break
			} else if err != nil {
				pk.Error = err.Error()
				sender.SendPacket(pk)
				break
			} else {
				sender.SendPacket(pk)
			}
		}
	}()
}

func (cmd *ShExecType) RunIOAndWait(sender *packet.PacketSender) {
	var wg sync.WaitGroup
	wg.Add(len(cmd.FdReaders))
	go func() {
		for fdNum, fd := range cmd.FdReaders {
			cmd.runReadLoop(&wg, fdNum, fd, sender)
		}
	}()
	donePacket := cmd.WaitForCommand()
	wg.Wait()
	sender.SendPacket(donePacket)
}

func runCommandSimple(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, error) {
	cmd := MakeShExec(pk)
	cmd.Cmd = exec.Command("bash", "-c", pk.Command)
	UpdateCmdEnv(cmd.Cmd, pk.Env)
	if pk.Cwd != "" {
		cmd.Cmd.Dir = pk.Cwd
	}
	var err error
	cmd.Cmd.Stdin, err = cmd.makeWriterPipe(0)
	if err != nil {
		cmd.Close()
		return nil, err
	}
	cmd.Cmd.Stdout, err = cmd.makeReaderPipe(1)
	if err != nil {
		cmd.Close()
		return nil, err
	}
	cmd.Cmd.Stderr, err = cmd.makeReaderPipe(2)
	if err != nil {
		cmd.Close()
		return nil, err
	}
	err = cmd.Cmd.Start()
	if err != nil {
		cmd.Close()
		return nil, err
	}
	for _, fd := range cmd.CloseAfterStart {
		fd.Close()
	}
	cmd.CloseAfterStart = nil
	return cmd, nil
}

func runCommandDetached(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, error) {
	fileNames, err := base.GetCommandFileNames(pk.SessionId, pk.CmdId)
	if err != nil {
		return nil, err
	}
	ptyOutInfo, err := os.Stat(fileNames.PtyOutFile)
	if err == nil { // non-nil error will be caught by regular OpenFile below
		// must have size 0
		if ptyOutInfo.Size() != 0 {
			return nil, fmt.Errorf("cmdid '%s' was already used (ptyout len=%d)", pk.CmdId, ptyOutInfo.Size())
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
	rtn := MakeShExec(pk)
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
	donePacket.SessionId = c.RunPacket.SessionId
	donePacket.CmdId = c.RunPacket.CmdId
	donePacket.ExitCode = exitCode
	donePacket.DurationMs = int64(cmdDuration / time.Millisecond)
	if c.FileNames != nil {
		os.Remove(c.FileNames.StdinFifo) // best effort (no need to check error)
	}
	return donePacket
}
