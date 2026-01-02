//go:build windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/ubuntu/gowsl"
)

var RegisteredDistros = gowsl.RegisteredDistros
var DefaultDistro = gowsl.DefaultDistro

type WslName struct {
	Distro string `json:"distro"`
}

type Distro struct {
	gowsl.Distro
}

type WslCmd struct {
	c       *gowsl.Cmd
	wg      *sync.WaitGroup
	once    *sync.Once
	lock    *sync.Mutex
	waitErr error
}

func (d *Distro) WslCommand(ctx context.Context, cmd string) *WslCmd {
	if ctx == nil {
		panic("nil Context")
	}
	innerCmd := d.Command(ctx, cmd)
	var wg sync.WaitGroup
	var lock *sync.Mutex
	return &WslCmd{innerCmd, &wg, new(sync.Once), lock, nil}
}

func (c *WslCmd) CombinedOutput() (out []byte, err error) {
	return c.c.CombinedOutput()
}
func (c *WslCmd) Output() (out []byte, err error) {
	return c.c.Output()
}
func (c *WslCmd) Run() error {
	return c.c.Run()
}
func (c *WslCmd) Start() (err error) {
	return c.c.Start()
}
func (c *WslCmd) StderrPipe() (r io.ReadCloser, err error) {
	return c.c.StderrPipe()
}
func (c *WslCmd) StdinPipe() (w io.WriteCloser, err error) {
	return c.c.StdinPipe()
}
func (c *WslCmd) StdoutPipe() (r io.ReadCloser, err error) {
	return c.c.StdoutPipe()
}
func (c *WslCmd) Wait() (err error) {
	c.wg.Add(1)
	c.once.Do(func() {
		c.waitErr = c.c.Wait()
	})
	c.wg.Done()
	c.wg.Wait()
	if c.waitErr != nil && c.waitErr.Error() == "not started" {
		c.once = new(sync.Once)
		return c.waitErr
	}
	return c.waitErr
}
func (c *WslCmd) ExitCode() int {
	state := c.c.ProcessState
	if state == nil {
		return -1
	}
	return state.ExitCode()
}
func (c *WslCmd) GetProcess() *os.Process {
	return c.c.Process
}

func (c *WslCmd) GetProcessState() *os.ProcessState {
	return c.c.ProcessState
}

func (c *WslCmd) SetStdin(stdin io.Reader) {
	c.c.Stdin = stdin
}

func (c *WslCmd) SetStdout(stdout io.Writer) {
	c.c.Stdout = stdout
}

func (c *WslCmd) SetStderr(stderr io.Writer) {
	c.c.Stderr = stderr
}

func GetDistroCmd(ctx context.Context, wslDistroName string, cmd string) (*WslCmd, error) {
	distros, err := RegisteredDistros(ctx)
	if err != nil {
		return nil, err
	}
	for _, distro := range distros {
		if distro.Name() != wslDistroName {
			continue
		}
		wrappedDistro := Distro{distro}
		return wrappedDistro.WslCommand(ctx, cmd), nil
	}
	return nil, fmt.Errorf("wsl distro %s not found", wslDistroName)
}

func GetDistro(ctx context.Context, wslDistroName WslName) (*Distro, error) {
	distros, err := RegisteredDistros(ctx)
	if err != nil {
		return nil, err
	}
	for _, distro := range distros {
		if distro.Name() != wslDistroName.Distro {
			continue
		}
		wrappedDistro := Distro{distro}
		return &wrappedDistro, nil
	}
	return nil, fmt.Errorf("wsl distro %s not found", wslDistroName)
}
