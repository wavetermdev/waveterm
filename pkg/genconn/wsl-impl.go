//go:build windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package genconn

import (
	"fmt"
	"io"
	"sync"

	"github.com/ubuntu/gowsl"
)

var _ ShellClient = (*WSLShellClient)(nil)

type WSLShellClient struct {
	distro *gowsl.Distro
}

func MakeWSLShellClient(distro *gowsl.Distro) *WSLShellClient {
	return &WSLShellClient{distro: distro}
}

func (c *WSLShellClient) MakeProcessController(cmdSpec CommandSpec) (ShellProcessController, error) {
	return MakeWSLProcessController(c.distro, cmdSpec)
}

type WSLProcessController struct {
	distro      *gowsl.Distro
	cmd         *gowsl.Cmd
	lock        *sync.Mutex
	once        *sync.Once
	stdinPiped  bool
	stdoutPiped bool
	stderrPiped bool
	waitErr     error
	started     bool
	cmdSpec     CommandSpec
}

func MakeWSLProcessController(distro *gowsl.Distro, cmdSpec CommandSpec) (*WSLProcessController, error) {
	fullCmd, err := BuildShellCommand(cmdSpec)
	if err != nil {
		return nil, fmt.Errorf("failed to build shell command: %w", err)
	}

	cmd := distro.Command(nil, fullCmd)
	if cmd == nil {
		return nil, fmt.Errorf("failed to create WSL command")
	}

	return &WSLProcessController{
		distro:  distro,
		cmd:     cmd,
		lock:    &sync.Mutex{},
		once:    &sync.Once{},
		cmdSpec: cmdSpec,
	}, nil
}

func (w *WSLProcessController) Start() error {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.started {
		return fmt.Errorf("command already started")
	}

	if err := w.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	w.started = true
	return nil
}

func (w *WSLProcessController) Wait() error {
	w.once.Do(func() {
		w.waitErr = w.cmd.Wait()
	})
	return w.waitErr
}

func (w *WSLProcessController) Kill() {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.cmd != nil && w.cmd.Process != nil {
		w.cmd.Process.Kill()
	}
}

func (w *WSLProcessController) StdinPipe() (io.WriteCloser, error) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.started {
		return nil, fmt.Errorf("command already started")
	}
	if w.stdinPiped {
		return nil, fmt.Errorf("stdin already piped")
	}

	w.stdinPiped = true
	return w.cmd.StdinPipe()
}

func (w *WSLProcessController) StdoutPipe() (io.Reader, error) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.started {
		return nil, fmt.Errorf("command already started")
	}
	if w.stdoutPiped {
		return nil, fmt.Errorf("stdout already piped")
	}

	w.stdoutPiped = true
	stdout, err := w.cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	return stdout, nil
}

func (w *WSLProcessController) StderrPipe() (io.Reader, error) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.started {
		return nil, fmt.Errorf("command already started")
	}
	if w.stderrPiped {
		return nil, fmt.Errorf("stderr already piped")
	}

	w.stderrPiped = true
	stderr, err := w.cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	return stderr, nil
}
