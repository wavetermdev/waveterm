//go:build !windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sigutil

import (
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

func InstallSIGUSR1Handler(w io.Writer) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGUSR1)
	go func() {
		defer func() {
			panichandler.PanicHandler("InstallSIGUSR1Handler", recover())
		}()
		for range sigCh {
			utilfn.DumpGoRoutineStacks(w)
		}
	}()
}
