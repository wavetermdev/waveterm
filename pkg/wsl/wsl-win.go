//go:build windows

// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"github.com/ubuntu/gowsl"
)

var RegisteredDistros = gowsl.RegisteredDistros

type Distro = gowsl.Distro
