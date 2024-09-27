//go:build !windows

// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"context"
	"fmt"
	"os/exec"
)

func RegisteredDistros(ctx context.Context) (distros []Distro, err error) {
	return nil, fmt.Errorf("RegisteredDistros not implemented on this system")
}

type Distro struct{}

func (d *Distro) Name() string {
	return ""
}

func (d *Distro) Command(ctx context.Context, cmd string) *WslCmd {
	return nil
}

// just use the regular cmd since it's
// similar enough to not cause issues
type WslCmd = exec.Cmd

func GetDistroCmd(ctx context.Context, wslDistroName string, cmd string) (*WslCmd, error) {
	return nil, fmt.Errorf("GetDistroCmd not implemented on this system")
}

func GetDistro(ctx context.Context, wslDistroName string) (*Distro, error) {
	return nil, fmt.Errorf("GetDistro not implemented on this system")
}
