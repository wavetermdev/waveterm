// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package termlisten

import (
	"os"
	"os/signal"
	"syscall"
)

// SetupSignals installs OS signal handlers for the listener.
//
// Before acting on any signal, onSignal(sig) is called (if non-nil). Returning
// false cancels the default handling for that signal; returning true (or passing
// nil) lets the handler proceed normally. onSignal is the right place to emit
// secondary teardown or re-entry signals (e.g. wave-tsunami-suspend).
//
//   - SIGTERM, SIGINT, SIGHUP: emit listen-exit and call os.Exit(0).
//   - SIGTSTP: emit listen-exit, then raise SIGSTOP to suspend the process
//     without re-triggering this handler.
//   - SIGCONT: call Reenter() to re-establish a fresh listen session, then call
//     onResume(newPort) if set.
func SetupSignals(l *Listener, onSignal func(sig syscall.Signal) bool, onResume func(port int)) {
	termCh := make(chan os.Signal, 1)
	signal.Notify(termCh, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)

	tstpCh := make(chan os.Signal, 1)
	signal.Notify(tstpCh, syscall.SIGTSTP)

	contCh := make(chan os.Signal, 1)
	signal.Notify(contCh, syscall.SIGCONT)

	allow := func(sig os.Signal) bool {
		if onSignal == nil {
			return true
		}
		if s, ok := sig.(syscall.Signal); ok {
			return onSignal(s)
		}
		return true
	}

	go func() {
		for {
			select {
			case sig := <-termCh:
				if !allow(sig) {
					continue
				}
				l.Close()
				os.Exit(0)

			case sig := <-tstpCh:
				if !allow(sig) {
					continue
				}
				l.Close()
				// SIGSTOP actually suspends the process; SIGTSTP would re-enter this handler.
				_ = syscall.Kill(os.Getpid(), syscall.SIGSTOP)

			case sig := <-contCh:
				if !allow(sig) {
					continue
				}
				port, err := l.Reenter()
				if err != nil {
					continue
				}
				if onResume != nil {
					onResume(port)
				}
			}
		}
	}()
}
