// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/thenextwave/pkg/remote"
	"github.com/wavetermdev/thenextwave/pkg/util/shellutil"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"golang.org/x/term"
)

type TermSize struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
}

type CommandOptsType struct {
	Interactive bool              `json:"interactive,omitempty"`
	Login       bool              `json:"login,omitempty"`
	Cwd         string            `json:"cwd,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
}

type ShellProc struct {
	Cmd       ConnInterface
	Pty       *os.File
	CloseOnce *sync.Once
	DoneCh    chan any // closed after proc.Wait() returns
	WaitErr   error    // WaitErr is synchronized by DoneCh (written before DoneCh is closed) and CloseOnce
}

func (sp *ShellProc) Close() {
	sp.Cmd.Kill()
	go func() {
		waitErr := sp.Cmd.Wait()
		sp.SetWaitErrorAndSignalDone(waitErr)
		sp.Pty.Close()
	}()
}

func (sp *ShellProc) SetWaitErrorAndSignalDone(waitErr error) {
	sp.CloseOnce.Do(func() {
		sp.WaitErr = waitErr
		close(sp.DoneCh)
	})
}

func (sp *ShellProc) Wait() error {
	<-sp.DoneCh
	return sp.WaitErr
}

// returns (done, waitError)
func (sp *ShellProc) WaitNB() (bool, error) {
	select {
	case <-sp.DoneCh:
		return true, sp.WaitErr
	default:
		return false, nil
	}
}

func ExitCodeFromWaitErr(err error) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			return status.ExitStatus()
		}
	}
	return -1

}

func setBoolConditionally(rval reflect.Value, field string, value bool) {
	if rval.Elem().FieldByName(field).IsValid() {
		rval.Elem().FieldByName(field).SetBool(value)
	}
}

func setSysProcAttrs(cmd *exec.Cmd) {
	rval := reflect.ValueOf(cmd.SysProcAttr)
	setBoolConditionally(rval, "Setsid", true)
	setBoolConditionally(rval, "Setctty", true)
}

func checkCwd(cwd string) error {
	if cwd == "" {
		return fmt.Errorf("cwd is empty")
	}
	if _, err := os.Stat(cwd); err != nil {
		return fmt.Errorf("error statting cwd %q: %w", cwd, err)
	}
	return nil
}

var userHostRe = regexp.MustCompile(`^([a-zA-Z0-9][a-zA-Z0-9._@\\-]*@)?([a-z0-9][a-z0-9.-]*)(?::([0-9]+))?$`)

func StartRemoteShellProc(termSize TermSize, cmdStr string, cmdOpts CommandOptsType, remoteName string) (*ShellProc, error) {
	ctx, cancelFunc := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancelFunc()

	var shellPath string
	if cmdStr == "" {
		shellPath = "/bin/bash"
	} else {
		shellPath = cmdStr
	}

	var shellOpts []string
	if cmdOpts.Login {
		shellOpts = append(shellOpts, "-l")
	}
	if cmdOpts.Interactive {
		shellOpts = append(shellOpts, "-i")
	}
	cmdCombined := fmt.Sprintf("%s %s", shellPath, strings.Join(shellOpts, " "))
	log.Print(cmdCombined)
	m := userHostRe.FindStringSubmatch(remoteName)
	if m == nil {
		return nil, fmt.Errorf("invalid format of user@host argument")
	}
	remoteUser, remoteHost, remotePortStr := m[1], m[2], m[3]
	remoteUser = strings.Trim(remoteUser, "@")
	var remotePort int
	if remotePortStr != "" {
		var err error
		remotePort, err = strconv.Atoi(remotePortStr)
		if err != nil {
			return nil, fmt.Errorf("invalid port specified on user@host argument")
		}
	}

	client, err := remote.ConnectToClient(ctx, &remote.SSHOpts{SSHHost: remoteHost, SSHUser: remoteUser, SSHPort: remotePort}) //todo specify or remove opts
	if err != nil {
		return nil, err
	}
	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	// todo: connect pty output, etc
	// redirect to fake pty???

	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	term.MakeRaw(int(cmdTty.Fd()))
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	pty.Setsize(cmdPty, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	session.Stdin = cmdTty
	session.Stdout = cmdTty
	session.Stderr = cmdTty
	for envKey, envVal := range cmdOpts.Env {
		// note these might fail depending on server settings, but we still try
		session.Setenv(envKey, envVal)
	}

	session.RequestPty("xterm-256color", termSize.Rows, termSize.Cols, nil)

	sessionWrap := SessionWrap{session, cmdCombined, cmdTty}
	err = sessionWrap.Start()
	if err != nil {
		cmdPty.Close()
		return nil, err
	}
	return &ShellProc{Cmd: sessionWrap, Pty: cmdPty, CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func StartShellProc(termSize TermSize, cmdStr string, cmdOpts CommandOptsType) (*ShellProc, error) {
	var ecmd *exec.Cmd
	var shellOpts []string
	if cmdOpts.Login {
		shellOpts = append(shellOpts, "-l")
	}
	if cmdOpts.Interactive {
		shellOpts = append(shellOpts, "-i")
	}
	if cmdStr == "" {
		shellPath := shellutil.DetectLocalShellPath()
		ecmd = exec.Command(shellPath, shellOpts...)
	} else {
		shellPath := shellutil.DetectLocalShellPath()
		shellOpts = append(shellOpts, "-c", cmdStr)
		ecmd = exec.Command(shellPath, shellOpts...)
	}
	ecmd.Env = os.Environ()
	if cmdOpts.Cwd != "" {
		ecmd.Dir = cmdOpts.Cwd
	}
	if cwdErr := checkCwd(ecmd.Dir); cwdErr != nil {
		ecmd.Dir = wavebase.GetHomeDir()
	}
	envToAdd := shellutil.WaveshellEnvVars(shellutil.DefaultTermType)
	if os.Getenv("LANG") == "" {
		envToAdd["LANG"] = wavebase.DetermineLang()
	}
	shellutil.UpdateCmdEnv(ecmd, envToAdd)
	shellutil.UpdateCmdEnv(ecmd, cmdOpts.Env)
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	pty.Setsize(cmdPty, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	ecmd.Stdin = cmdTty
	ecmd.Stdout = cmdTty
	ecmd.Stderr = cmdTty
	ecmd.SysProcAttr = &syscall.SysProcAttr{}
	setSysProcAttrs(ecmd)
	err = ecmd.Start()
	cmdTty.Close()
	if err != nil {
		cmdPty.Close()
		return nil, err
	}
	return &ShellProc{Cmd: CmdWrap{ecmd}, Pty: cmdPty, CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func RunSimpleCmdInPty(ecmd *exec.Cmd, termSize TermSize) ([]byte, error) {
	ecmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(ecmd, shellutil.WaveshellEnvVars(shellutil.DefaultTermType))
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	pty.Setsize(cmdPty, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	ecmd.Stdin = cmdTty
	ecmd.Stdout = cmdTty
	ecmd.Stderr = cmdTty
	ecmd.SysProcAttr = &syscall.SysProcAttr{}
	setSysProcAttrs(ecmd)
	err = ecmd.Start()
	cmdTty.Close()
	if err != nil {
		cmdPty.Close()
		return nil, err
	}
	defer cmdPty.Close()
	ioDone := make(chan bool)
	var outputBuf bytes.Buffer
	go func() {
		// ignore error (/dev/ptmx has read error when process is done)
		defer close(ioDone)
		io.Copy(&outputBuf, cmdPty)
	}()
	exitErr := ecmd.Wait()
	if exitErr != nil {
		return nil, exitErr
	}
	<-ioDone
	return outputBuf.Bytes(), nil
}
