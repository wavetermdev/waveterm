// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package termlisten

import (
	"fmt"

	"golang.org/x/term"
)

func setTermMode(fd int) (*term.State, error) {
	return nil, fmt.Errorf("setTermMode not supported on Windows")
}
