// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows || (linux && (mips || mips64))

package waveattach

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func ResolveDataDir() (string, error) {
	return "", fmt.Errorf("wsh attach is not supported on this platform")
}

func Connect() (*wshutil.WshRpc, string, error) {
	return nil, "", fmt.Errorf("wsh attach is not supported on this platform")
}

func SelectBlock(rpcClient *wshutil.WshRpc) (string, error) {
	return "", fmt.Errorf("wsh attach is not supported on this platform")
}

func Attach(rpcClient *wshutil.WshRpc, blockId string) error {
	return fmt.Errorf("wsh attach is not supported on this platform")
}
