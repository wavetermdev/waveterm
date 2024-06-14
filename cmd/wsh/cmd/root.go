// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"golang.org/x/term"
)

var (
	rootCmd = &cobra.Command{
		Use:   "wsh",
		Short: "CLI tool to control Wave Terminal",
		Long:  `wsh is a small utility that lets you do cool things with Wave Terminal, right from the command line`,
	}
)

var shutdownOnce sync.Once
var origTermState *term.State
var usingHtmlMode bool
var shutdownSignalHandlersInstalled bool

func doShutdown(reason string, exitCode int) {
	shutdownOnce.Do(func() {
		defer os.Exit(exitCode)
		log.Printf("shutting down: %s\r\n", reason)
		if usingHtmlMode {
			cmd := &wshutil.BlockSetMetaCommand{
				Command: wshutil.BlockCommand_SetMeta,
				Meta:    map[string]any{"term:mode": nil},
			}
			barr, _ := wshutil.EncodeWaveOSCMessage(cmd)
			os.Stdout.Write(barr)
		}
		if origTermState != nil {
			term.Restore(int(os.Stdin.Fd()), origTermState)
		}
	})
}

func setTermHtmlMode() {
	installShutdownSignalHandlers()
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
	usingHtmlMode = true
}

func installShutdownSignalHandlers() {
	if shutdownSignalHandlersInstalled {
		return
	}
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		for sig := range sigCh {
			doShutdown(fmt.Sprintf("got signal %v", sig), 1)
			break
		}
	}()
}

// Execute executes the root command.
func Execute() error {
	return rootCmd.Execute()
}
