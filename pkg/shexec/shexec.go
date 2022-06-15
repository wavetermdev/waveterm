// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package shexec

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/scripthaus-dev/sh2-runner/pkg/base"
	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
)

type ShExecType struct {
	FileNames *base.CommandFileNames
	Cmd       *exec.Cmd
	CmdPty    *os.File
	StartTs   time.Time
}

func (c *ShExecType) Close() {
	c.CmdPty.Close()
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
	if pk.ChDir != "" {
		ecmd.Dir = pk.ChDir
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
	runnerPath, err := base.GetScRunnerPath()
	if err != nil {
		return nil, err
	}
	ecmd := exec.Command(runnerPath, cmdId)
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
	if pk.ChDir != "" {
		dirInfo, err := os.Stat(pk.ChDir)
		if err != nil {
			return fmt.Errorf("invalid cwd '%s' for command: %v", pk.ChDir, err)
		}
		if !dirInfo.IsDir() {
			return fmt.Errorf("invalid cwd '%s' for command, not a directory", pk.ChDir)
		}
	}
	return nil
}

// when err is nil, the command will have already been started
func RunCommand(pk *packet.RunPacketType, sender *packet.PacketSender) (*ShExecType, error) {
	if pk.CmdId == "" {
		pk.CmdId = uuid.New().String()
	}
	err := ValidateRunPacket(pk)
	if err != nil {
		return nil, err
	}
	fileNames, err := base.GetCommandFileNames(pk.SessionId, pk.CmdId)
	if err != nil {
		return nil, err
	}
	if _, err = os.Stat(fileNames.PtyOutFile); !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("cmdid '%s' was already used", pk.CmdId)
	}
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	defer func() {
		cmdTty.Close()
	}()
	startTs := time.Now()
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
	return &ShExecType{
		FileNames: fileNames,
		Cmd:       ecmd,
		CmdPty:    cmdPty,
		StartTs:   startTs,
	}, nil
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

func (c *ShExecType) WaitForCommand(cmdId string) *packet.CmdDonePacketType {
	exitErr := c.Cmd.Wait()
	endTs := time.Now()
	cmdDuration := endTs.Sub(c.StartTs)
	exitCode := GetExitCode(exitErr)
	donePacket := packet.MakeCmdDonePacket()
	donePacket.Ts = endTs.UnixMilli()
	donePacket.CmdId = cmdId
	donePacket.ExitCode = exitCode
	donePacket.DurationMs = int64(cmdDuration / time.Millisecond)
	os.Remove(c.FileNames.StdinFifo) // best effort (no need to check error)
	return donePacket
}
