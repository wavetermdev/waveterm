// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/unixutil"
	"github.com/wavetermdev/waveterm/pkg/wsl"
	"golang.org/x/crypto/ssh"
)

type ConnInterface interface {
	Kill()
	KillGraceful(time.Duration)
	Wait() error
	Start() error
	ExitCode() int
	ExitSignal() string
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.ReadCloser, error)
	StderrPipe() (io.ReadCloser, error)
	SetSize(w int, h int) error
	pty.Pty
}

type CmdWrap struct {
	Cmd      *exec.Cmd
	WaitOnce *sync.Once
	WaitErr  error
	pty.Pty
}

func MakeCmdWrap(cmd *exec.Cmd, cmdPty pty.Pty) CmdWrap {
	return CmdWrap{
		Cmd:      cmd,
		WaitOnce: &sync.Once{},
		Pty:      cmdPty,
	}
}

func (cw CmdWrap) Kill() {
	cw.Cmd.Process.Kill()
}

func (cw CmdWrap) Wait() error {
	cw.WaitOnce.Do(func() {
		cw.WaitErr = cw.Cmd.Wait()
	})
	return cw.WaitErr
}

// only valid once Wait() has returned (or you know Cmd is done)
func (cw CmdWrap) ExitCode() int {
	state := cw.Cmd.ProcessState
	if state == nil {
		return -1
	}
	return state.ExitCode()
}

func (cw CmdWrap) ExitSignal() string {
	state := cw.Cmd.ProcessState
	if state == nil {
		return ""
	}
	if ws, ok := state.Sys().(syscall.WaitStatus); ok {
		if ws.Signaled() {
			return unixutil.GetSignalName(ws.Signal())
		}
	}
	return ""
}

func (cw CmdWrap) KillGraceful(timeout time.Duration) {
	if cw.Cmd.Process == nil {
		return
	}
	if cw.Cmd.ProcessState != nil && cw.Cmd.ProcessState.Exited() {
		return
	}
	if runtime.GOOS == "windows" {
		cw.Cmd.Process.Signal(os.Interrupt)
	} else {
		cw.Cmd.Process.Signal(syscall.SIGTERM)
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("KillGraceful:Kill", recover())
		}()
		time.Sleep(timeout)
		if cw.Cmd.ProcessState == nil || !cw.Cmd.ProcessState.Exited() {
			cw.Cmd.Process.Kill() // force kill if it is already not exited
		}
	}()
}

func (cw CmdWrap) Start() error {
	defer func() {
		for _, extraFile := range cw.Cmd.ExtraFiles {
			if extraFile != nil {
				extraFile.Close()
			}
		}
	}()
	return cw.Cmd.Start()
}

func (cw CmdWrap) StdinPipe() (io.WriteCloser, error) {
	return cw.Cmd.StdinPipe()
}

func (cw CmdWrap) StdoutPipe() (io.ReadCloser, error) {
	return cw.Cmd.StdoutPipe()
}

func (cw CmdWrap) StderrPipe() (io.ReadCloser, error) {
	return cw.Cmd.StderrPipe()
}

func (cw CmdWrap) SetSize(w int, h int) error {
	err := pty.Setsize(cw.Pty, &pty.Winsize{Rows: uint16(w), Cols: uint16(h)})
	if err != nil {
		return err
	}
	return nil
}

type SessionWrap struct {
	Session  *ssh.Session
	StartCmd string
	Tty      pty.Tty
	WaitOnce *sync.Once
	WaitErr  error
	pty.Pty
}

func MakeSessionWrap(session *ssh.Session, startCmd string, sessionPty pty.Pty) SessionWrap {
	return SessionWrap{
		Session:  session,
		StartCmd: startCmd,
		Tty:      sessionPty,
		WaitOnce: &sync.Once{},
		Pty:      sessionPty,
	}
}

func (sw SessionWrap) Kill() {
	sw.Tty.Close()
	sw.Session.Close()
}

func (sw SessionWrap) KillGraceful(timeout time.Duration) {
	sw.Kill()
}

func (sw SessionWrap) ExitCode() int {
	waitErr := sw.WaitErr
	if waitErr == nil {
		return -1
	}
	return ExitCodeFromWaitErr(waitErr)
}

func (sw SessionWrap) ExitSignal() string {
	if sw.WaitErr == nil {
		return ""
	}
	if exitErr, ok := sw.WaitErr.(*ssh.ExitError); ok {
		signal := exitErr.Signal()
		if signal != "" {
			return signal
		}
	}
	return ""
}

func (sw SessionWrap) Wait() error {
	sw.WaitOnce.Do(func() {
		sw.WaitErr = sw.Session.Wait()
	})
	return sw.WaitErr
}

func (sw SessionWrap) Start() error {
	return sw.Session.Start(sw.StartCmd)
}

func (sw SessionWrap) StdinPipe() (io.WriteCloser, error) {
	return sw.Session.StdinPipe()
}

func (sw SessionWrap) StdoutPipe() (io.ReadCloser, error) {
	stdoutReader, err := sw.Session.StdoutPipe()
	if err != nil {
		return nil, err
	}
	return io.NopCloser(stdoutReader), nil
}

func (sw SessionWrap) StderrPipe() (io.ReadCloser, error) {
	stderrReader, err := sw.Session.StderrPipe()
	if err != nil {
		return nil, err
	}
	return io.NopCloser(stderrReader), nil
}

func (sw SessionWrap) SetSize(h int, w int) error {
	return sw.Session.WindowChange(h, w)
}

type WslCmdWrap struct {
	*wsl.WslCmd
	Tty pty.Tty
	pty.Pty
}

func (wcw WslCmdWrap) Kill() {
	wcw.Tty.Close()
	wcw.Close()
}

func (wcw WslCmdWrap) KillGraceful(timeout time.Duration) {
	process := wcw.WslCmd.GetProcess()
	if process == nil {
		return
	}
	processState := wcw.WslCmd.GetProcessState()
	if processState != nil && processState.Exited() {
		return
	}
	process.Signal(os.Interrupt)
	go func() {
		defer func() {
			panichandler.PanicHandler("KillGraceful-wsl:Kill", recover())
		}()
		time.Sleep(timeout)
		process := wcw.WslCmd.GetProcess()
		processState := wcw.WslCmd.GetProcessState()
		if processState == nil || !processState.Exited() {
			process.Kill() // force kill if it is already not exited
		}
	}()
}

/**
 * SetSize does nothing for WslCmdWrap as there
 * is no pty to manage.
**/
func (wcw WslCmdWrap) SetSize(w int, h int) error {
	return nil
}
