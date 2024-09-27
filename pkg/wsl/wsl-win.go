//go:build windows

// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"context"
	"fmt"

	"github.com/ubuntu/gowsl"
)

var RegisteredDistros = gowsl.RegisteredDistros

type Distro = gowsl.Distro
type WslCmd = gowsl.Cmd

func GetDistroCmd(ctx context.Context, wslDistroName string, cmd string) (*WslCmd, error) {
	distros, err := RegisteredDistros(ctx)
	if err != nil {
		return nil, err
	}
	for _, distro := range distros {
		if distro.Name() != wslDistroName {
			continue
		}
		return distro.Command(ctx, cmd), nil
	}
	return nil, fmt.Errorf("wsl distro %s not found", wslDistroName)
}

func GetDistro(ctx context.Context, wslDistroName string) (*Distro, error) {
	distros, err := RegisteredDistros(ctx)
	if err != nil {
		return nil, err
	}
	for _, distro := range distros {
		if distro.Name() != wslDistroName {
			continue
		}
		return &distro, nil
	}
	return nil, fmt.Errorf("wsl distro %s not found", wslDistroName)
}
