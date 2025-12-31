//go:build !windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
)

type WslName struct {
	Distro string `json:"distro"`
}

func RegisteredDistros(ctx context.Context) (distros []Distro, err error) {
	return nil, fmt.Errorf("RegisteredDistros not implemented on this system")
}

func DefaultDistro(ctx context.Context) (d Distro, ok bool, err error) {
	return d, false, fmt.Errorf("DefaultDistro not implemented on this system")
}

type Distro struct{}

func (d *Distro) Name() string {
	return ""
}

func (d *Distro) WslCommand(ctx context.Context, cmd string) *WslCmd {
	return nil
}

// just use the regular cmd since it's
// similar enough to not cause issues
// type WslCmd = exec.Cmd
type WslCmd struct {
	exec.Cmd
}

func (wc *WslCmd) GetProcess() *os.Process {
	return nil
}

func (wc *WslCmd) GetProcessState() *os.ProcessState {
	return nil
}

func (wc *WslCmd) ExitCode() int {
	return -1
}

func (c *WslCmd) SetStdin(stdin io.Reader) {
	c.Stdin = stdin
}

func (c *WslCmd) SetStdout(stdout io.Writer) {
	c.Stdout = stdout
}

func (c *WslCmd) SetStderr(stderr io.Writer) {
	c.Stderr = stderr
}

func GetDistroCmd(ctx context.Context, wslDistroName string, cmd string) (*WslCmd, error) {
	return nil, fmt.Errorf("GetDistroCmd not implemented on this system")
}

func GetDistro(ctx context.Context, wslDistroName WslName) (*Distro, error) {
	return nil, fmt.Errorf("GetDistro not implemented on this system")
}
