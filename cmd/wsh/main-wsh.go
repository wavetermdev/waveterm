// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"golang.org/x/term"
)

var shutdownOnce sync.Once
var origTermState *term.State

func doShutdown(reason string, exitCode int) {
	shutdownOnce.Do(func() {
		defer os.Exit(exitCode)
		log.Printf("shutting down: %s\r\n", reason)
		cmd := &wshutil.BlockSetMetaCommand{
			Command: wshutil.BlockCommand_SetMeta,
			Meta:    map[string]any{"term:mode": nil},
		}
		barr, _ := wshutil.EncodeWaveOSCMessage(cmd)
		if origTermState != nil {
			term.Restore(int(os.Stdin.Fd()), origTermState)
		}
		os.Stdout.Write(barr)
	})
}

func installShutdownSignalHandlers() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		for sig := range sigCh {
			doShutdown(fmt.Sprintf("got signal %v", sig), 1)
			break
		}
	}()
}

func main() {
	installShutdownSignalHandlers()
	defer doShutdown("normal exit", 0)
	origState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error setting raw mode: %v\n", err)
		return
	}
	origTermState = origState
	cmd := &wshutil.BlockSetMetaCommand{
		Command: wshutil.BlockCommand_SetMeta,
		Meta:    map[string]any{"term:mode": "html"},
	}
	barr, _ := wshutil.EncodeWaveOSCMessage(cmd)
	os.Stdout.Write(barr)
	for {
		var buf [1]byte
		_, err := os.Stdin.Read(buf[:])
		if err != nil {
			doShutdown(fmt.Sprintf("stdin closed/error (%v)", err), 1)
		}
		if buf[0] == 0x03 {
			doShutdown("read Ctrl-C from stdin", 1)
			break
		}
		if buf[0] == 'x' {
			doShutdown("read 'x' from stdin", 0)
			break
		}
	}
}
