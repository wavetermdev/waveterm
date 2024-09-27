//go:build !windows

// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"context"
	"fmt"
)

func RegisteredDistros(ctx context.Context) (distros []Distro, err error) {
	return nil, fmt.Errorf("unimplemented")
}

type Distro struct{}

func (d *Distro) Name() string {
	return ""
}
