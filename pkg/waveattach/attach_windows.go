// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package waveattach

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func Attach(rpcClient *wshutil.WshRpc, blockId string) error {
	return fmt.Errorf("wsh attach is not supported on Windows")
}
