// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sigutil

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

func InstallShutdownSignalHandlers(doShutdown func(string)) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		defer func() {
			panichandler.PanicHandler("InstallShutdownSignalHandlers", recover())
		}()
		for sig := range sigCh {
			doShutdown(fmt.Sprintf("got signal %v", sig))
			break
		}
	}()
}
