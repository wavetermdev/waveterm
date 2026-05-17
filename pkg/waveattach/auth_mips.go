// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build linux && (mips || mips64)

package waveattach

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func ResolveDataDir() (string, error) {
	return "", fmt.Errorf("wsh attach is not supported on this architecture")
}

func Connect() (*wshutil.WshRpc, string, error) {
	return nil, "", fmt.Errorf("wsh attach is not supported on this architecture")
}
