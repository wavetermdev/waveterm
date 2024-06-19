// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
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
var madeRaw bool
var usingHtmlMode bool
var shutdownSignalHandlersInstalled bool
var WrappedStdin io.Reader
var RpcClient *wshutil.WshRpc

func doShutdown(reason string, exitCode int) {
	shutdownOnce.Do(func() {
		defer os.Exit(exitCode)
		log.Printf("shutting down: %s\r\n", reason)
		if usingHtmlMode {
			cmd := &wshutil.BlockSetMetaCommand{
				Command: wshutil.BlockCommand_SetMeta,
				Meta:    map[string]any{"term:mode": nil},
			}
			RpcClient.SendCommand(cmd)
			time.Sleep(10 * time.Millisecond)
		}
		if origTermState != nil {
			term.Restore(int(os.Stdin.Fd()), origTermState)
		}
	})
}

// returns the wrapped stdin and a new rpc client (that wraps the stdin input and stdout output)
func setupRpcClient(handlerFn wshutil.CommandHandlerFnType) {
	log.Printf("setup rpc client\r\n")
	messageCh := make(chan wshutil.RpcMessage)
	ptyBuf := wshutil.MakePtyBuffer(wshutil.WaveServerOSCPrefix, os.Stdin, messageCh)
	rpcClient, outputCh := wshutil.MakeWshRpc(wshutil.WaveOSC, messageCh, handlerFn)
	go func() {
		for barr := range outputCh {
			os.Stdout.Write(barr)
		}
	}()
	WrappedStdin = ptyBuf
	RpcClient = rpcClient
}

func setTermRawMode() {
	if madeRaw {
		return
	}
	origState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error setting raw mode: %v\n", err)
		return
	}
	origTermState = origState
	madeRaw = true
}

func setTermHtmlMode() {
	installShutdownSignalHandlers()
	setTermRawMode()
	cmd := &wshutil.BlockSetMetaCommand{
		Command: wshutil.BlockCommand_SetMeta,
		Meta:    map[string]any{"term:mode": "html"},
	}
	RpcClient.SendCommand(cmd)
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

var oidRe = regexp.MustCompile(`^[0-9a-f]{8}$`)

func validateEasyORef(oref string) error {
	if strings.Contains(oref, ":") {
		_, err := waveobj.ParseORef(oref)
		if err != nil {
			return fmt.Errorf("invalid ORef: %v", err)
		}
		return nil
	}
	if len(oref) == 8 {
		if !oidRe.MatchString(oref) {
			return fmt.Errorf("invalid short OID format, must only use 0-9a-f: %q", oref)
		}
		return nil
	}
	_, err := uuid.Parse(oref)
	if err != nil {
		return fmt.Errorf("invalid OID (must be UUID): %v", err)
	}
	return nil
}

func isFullORef(orefStr string) bool {
	_, err := waveobj.ParseORef(orefStr)
	return err == nil
}

func resolveSimpleId(id string) (string, error) {
	if isFullORef(id) {
		return id, nil
	}
	resolveCmd := &wshutil.ResolveIdsCommand{
		Command: wshutil.Command_ResolveIds,
		Ids:     []string{id},
	}
	resp, err := RpcClient.SendRpcRequest(resolveCmd, 2000)
	if err != nil {
		return "", err
	}
	if resp[id] == nil {
		return "", fmt.Errorf("id not found: %q", id)
	}
	return resp[id].(string), nil
}

// Execute executes the root command.
func Execute() error {
	setupRpcClient(nil)
	return rootCmd.Execute()
}