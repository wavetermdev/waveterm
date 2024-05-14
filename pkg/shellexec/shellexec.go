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

func RunSimpleCmdInPty(ecmd *exec.Cmd) ([]byte, error) {
	ecmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(ecmd, shellutil.WaveshellEnvVars(shellutil.DefaultTermType))
	cmdPty, cmdTty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening new pty: %w", err)
	}
	pty.Setsize(cmdPty, &pty.Winsize{Rows: shellutil.DefaultTermRows, Cols: shellutil.DefaultTermCols})
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
