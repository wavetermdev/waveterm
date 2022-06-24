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
const ReadBufSize = 128 * 1024
const WriteBufSize = 128 * 1024
const MaxFdNum = 1023
const FirstExtraFilesFdNum = 3

type ShExecType struct {
	Lock            *sync.Mutex
	StartTs         time.Time
	RunPacket       *packet.RunPacketType
	FileNames       *base.CommandFileNames
	Cmd             *exec.Cmd
	CmdPty          *os.File
	FdReaders       map[int]*FdReader // synchronized
	FdWriters       map[int]*FdWriter // synchronized
	CloseAfterStart []*os.File        // synchronized
}

func MakeShExec(pk *packet.RunPacketType) *ShExecType {
	return &ShExecType{
		Lock:      &sync.Mutex{},
		StartTs:   time.Now(),
		RunPacket: pk,
		FdReaders: make(map[int]*FdReader),
		FdWriters: make(map[int]*FdWriter),
	}
}

func (c *ShExecType) Close() {
	c.Lock.Lock()
	defer c.Lock.Unlock()

	if c.CmdPty != nil {
		c.CmdPty.Close()
	}
	for _, fd := range c.FdReaders {
		fd.Close()
	}
	for _, fw := range c.FdWriters {
		fw.Close()
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
	cmd.Lock.Lock()
	defer cmd.Lock.Unlock()
	cmd.FdReaders[fdNum] = MakeFdReader(cmd, pr, fdNum)
	cmd.CloseAfterStart = append(cmd.CloseAfterStart, pw)
	return pw, nil
}

// returns the *reader* to connect to process, writer is put in FdWriters
func (cmd *ShExecType) makeWriterPipe(fdNum int) (*os.File, error) {
	pr, pw, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	cmd.Lock.Lock()
	defer cmd.Lock.Unlock()
	cmd.FdWriters[fdNum] = MakeFdWriter(cmd, pw, fdNum)
	cmd.CloseAfterStart = append(cmd.CloseAfterStart, pr)
	return pr, nil
}

func (cmd *ShExecType) MakeDataAckPacket(fdNum int, ackLen int, err error) *packet.DataAckPacketType {
	ack := packet.MakeDataAckPacket()
	ack.SessionId = cmd.RunPacket.SessionId
	ack.CmdId = cmd.RunPacket.CmdId
	ack.FdNum = fdNum
	ack.AckLen = ackLen
	if err != nil {
		ack.Error = err.Error()
	}
	return ack
}

func (cmd *ShExecType) launchWriters(sender *packet.PacketSender) {
	cmd.Lock.Lock()
	defer cmd.Lock.Unlock()
	for _, fw := range cmd.FdWriters {
		go fw.WriteLoop(sender)
	}
}

func (cmd *ShExecType) processDataPacket(dataPacket *packet.DataPacketType) error {
	cmd.Lock.Lock()
	defer cmd.Lock.Unlock()
	fw := cmd.FdWriters[dataPacket.FdNum]
	if fw == nil {
		// add a closed FdWriter as a placeholder so we only send one error
		fw := MakeFdWriter(cmd, nil, dataPacket.FdNum)
		fw.Close()
		cmd.FdWriters[dataPacket.FdNum] = fw
		return fmt.Errorf("write to closed file")
	}
	err := fw.AddData([]byte(dataPacket.Data), dataPacket.Eof)
	if err != nil {
		fw.Close()
		return err
	}
	return nil
}

func (cmd *ShExecType) processAckPacket(ackPacket *packet.DataAckPacketType) {
	cmd.Lock.Lock()
	defer cmd.Lock.Unlock()
	fr := cmd.FdReaders[ackPacket.FdNum]
	if fr == nil {
		return
	}
	fr.NotifyAck(ackPacket.AckLen)
}

func (cmd *ShExecType) runPacketInputLoop(packetCh chan packet.PacketType, sender *packet.PacketSender) {
	for pk := range packetCh {
		if pk.GetType() == packet.DataPacketStr {
			dataPacket := pk.(*packet.DataPacketType)
			err := cmd.processDataPacket(dataPacket)
			if err != nil {
				errPacket := cmd.MakeDataAckPacket(dataPacket.FdNum, 0, err)
				sender.SendPacket(errPacket)
			}
			continue
		}
		if pk.GetType() == packet.DataAckPacketStr {
			ackPacket := pk.(*packet.DataAckPacketType)
			cmd.processAckPacket(ackPacket)
		}
		// other packet types are ignored
	}
}

func (cmd *ShExecType) launchReaders(wg *sync.WaitGroup, sender *packet.PacketSender) {
	cmd.Lock.Lock()
	defer cmd.Lock.Unlock()
	wg.Add(len(cmd.FdReaders))
	for _, fr := range cmd.FdReaders {
		go fr.ReadLoop(wg, sender)
	}
}

func (cmd *ShExecType) RunIOAndWait(packetCh chan packet.PacketType, sender *packet.PacketSender) {
	var wg sync.WaitGroup
	cmd.launchReaders(&wg, sender)
	cmd.launchWriters(sender)
	go cmd.runPacketInputLoop(packetCh, sender)
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
	extraFiles := make([]*os.File, 0, MaxFdNum+1)
	for _, rfd := range pk.Fds {
		if rfd.FdNum < 0 {
			cmd.Close()
			return nil, fmt.Errorf("mshell negative fd numbers fd=%d", rfd.FdNum)
		}
		if rfd.FdNum < FirstExtraFilesFdNum {
			cmd.Close()
			return nil, fmt.Errorf("mshell does not support re-opening fd=%d (0, 1, and 2, are always open)", rfd.FdNum)
		}
		if rfd.FdNum > MaxFdNum {
			cmd.Close()
			return nil, fmt.Errorf("mshell does not support opening fd numbers above %d", MaxFdNum)
		}
		if rfd.FdNum >= len(extraFiles) {
			extraFiles = extraFiles[:rfd.FdNum+1]
		}
		if extraFiles[rfd.FdNum] != nil {
			cmd.Close()
			return nil, fmt.Errorf("mshell got duplicate entries for fd=%d", rfd.FdNum)
		}
		if rfd.Read && rfd.Write {
			cmd.Close()
			return nil, fmt.Errorf("mshell does not support opening fd numbers for reading and writing, fd=%d", rfd.FdNum)
		}
		if !rfd.Read && !rfd.Write {
			cmd.Close()
			return nil, fmt.Errorf("invalid fd=%d, neither reading or writing mode specified", rfd.FdNum)
		}
		if rfd.Read {
			// client file is open for reading, so we make a writer pipe
			extraFiles[rfd.FdNum], err = cmd.makeWriterPipe(rfd.FdNum)
			if err != nil {
				cmd.Close()
				return nil, err
			}
		}
		if rfd.Write {
			// client file is open for writing, so we make a reader pipe
			extraFiles[rfd.FdNum], err = cmd.makeReaderPipe(rfd.FdNum)
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
