// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ptyutil

import (
	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const maxUint16 = int(^uint16(0))

func toWinsizeDimension(v int) uint16 {
	if v <= 0 {
		return 0
	}
	if v > maxUint16 {
		return uint16(maxUint16)
	}
	return uint16(v)
}

func WinsizeFromTermSize(termSize waveobj.TermSize) *pty.Winsize {
	return &pty.Winsize{
		Rows: toWinsizeDimension(termSize.Rows),
		Cols: toWinsizeDimension(termSize.Cols),
		X:    toWinsizeDimension(termSize.XPixel),
		Y:    toWinsizeDimension(termSize.YPixel),
	}
}
