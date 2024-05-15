// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"

	"github.com/creack/pty"
	"github.com/wavetermdev/thenextwave/pkg/util/shellutil"
)

type TermSize struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
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
	ecmd.SysProcAttr.Setsid = true
	ecmd.SysProcAttr.Setctty = true
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
