// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"

	"golang.org/x/term"
)

// these should both be 5 characters
const WaveOSC = "23198"
const WaveServerOSC = "23199"
const WaveOSCPrefixLen = 5 + 3 // \x1b] + WaveOSC + ; + \x07

const WaveOSCPrefix = "\x1b]" + WaveOSC + ";"
const WaveServerOSCPrefix = "\x1b]" + WaveServerOSC + ";"

const HexChars = "0123456789ABCDEF"
const BEL = 0x07
const ST = 0x9c
const ESC = 0x1b

// OSC escape types
// OSC 23198 ; (JSON | base64-JSON) ST
// JSON = must escape all ASCII control characters ([\x00-\x1F\x7F])
// we can tell the difference between JSON and base64-JSON by the first character: '{' or not

// for responses (terminal -> program), we'll use OSC 23199
// same json format

func copyOscPrefix(dst []byte, oscNum string) {
	dst[0] = ESC
	dst[1] = ']'
	copy(dst[2:], oscNum)
	dst[len(oscNum)+2] = ';'
}

func oscPrefixLen(oscNum string) int {
	return 3 + len(oscNum)
}

func makeOscPrefix(oscNum string) []byte {
	output := make([]byte, oscPrefixLen(oscNum))
	copyOscPrefix(output, oscNum)
	return output
}

func EncodeWaveOSCBytes(oscNum string, barr []byte) []byte {
	if len(oscNum) != 5 {
		panic("oscNum must be 5 characters")
	}
	hasControlChars := false
	for _, b := range barr {
		if b < 0x20 || b == 0x7F {
			hasControlChars = true
			break
		}
	}
	if !hasControlChars {
		// If no control characters, directly construct the output
		// \x1b] (2) + WaveOSC + ; (1) + message + \x07 (1)
		output := make([]byte, oscPrefixLen(oscNum)+len(barr)+1)
		copyOscPrefix(output, oscNum)
		copy(output[oscPrefixLen(oscNum):], barr)
		output[len(output)-1] = BEL
		return output
	}

	var buf bytes.Buffer
	buf.Write(makeOscPrefix(oscNum))
	escSeq := [6]byte{'\\', 'u', '0', '0', '0', '0'}
	for _, b := range barr {
		if b < 0x20 || b == 0x7f {
			escSeq[4] = HexChars[b>>4]
			escSeq[5] = HexChars[b&0x0f]
			buf.Write(escSeq[:])
		} else {
			buf.WriteByte(b)
		}
	}
	buf.WriteByte(BEL)
	return buf.Bytes()
}

func EncodeWaveOSCMessageEx(oscNum string, msg *RpcMessage) ([]byte, error) {
	if msg == nil {
		return nil, fmt.Errorf("nil message")
	}
	barr, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("error marshalling message to json: %w", err)
	}
	return EncodeWaveOSCBytes(oscNum, barr), nil
}

var termModeLock = sync.Mutex{}
var termIsRaw bool
var origTermState *term.State
var shutdownSignalHandlersInstalled bool
var shutdownOnce sync.Once
var extraShutdownFunc atomic.Pointer[func()]

func DoShutdown(reason string, exitCode int, quiet bool) {
	shutdownOnce.Do(func() {
		defer os.Exit(exitCode)
		RestoreTermState()
		extraFn := extraShutdownFunc.Load()
		if extraFn != nil {
			(*extraFn)()
		}
		if !quiet && reason != "" {
			log.Printf("shutting down: %s\r\n", reason)
		}
	})
}

func installShutdownSignalHandlers(quiet bool) {
	termModeLock.Lock()
	defer termModeLock.Unlock()
	if shutdownSignalHandlersInstalled {
		return
	}
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		for sig := range sigCh {
			DoShutdown(fmt.Sprintf("got signal %v", sig), 1, quiet)
			break
		}
	}()
}

func SetTermRawModeAndInstallShutdownHandlers(quietShutdown bool) {
	SetTermRawMode()
	installShutdownSignalHandlers(quietShutdown)
}

func SetExtraShutdownFunc(fn func()) {
	extraShutdownFunc.Store(&fn)
}

func SetTermRawMode() {
	termModeLock.Lock()
	defer termModeLock.Unlock()
	if termIsRaw {
		return
	}
	origState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error setting raw mode: %v\n", err)
		return
	}
	origTermState = origState
	termIsRaw = true
}

func RestoreTermState() {
	termModeLock.Lock()
	defer termModeLock.Unlock()
	if !termIsRaw || origTermState == nil {
		return
	}
	term.Restore(int(os.Stdin.Fd()), origTermState)
	termIsRaw = false
}

// returns (wshRpc, wrappedStdin)
func SetupTerminalRpcClient(handlerFn func(*RpcResponseHandler) bool) (*WshRpc, io.Reader) {
	messageCh := make(chan []byte, 32)
	outputCh := make(chan []byte, 32)
	ptyBuf := MakePtyBuffer(WaveServerOSCPrefix, os.Stdin, messageCh)
	rpcClient := MakeWshRpc(messageCh, outputCh, RpcContext{}, handlerFn)
	go func() {
		for msg := range outputCh {
			barr := EncodeWaveOSCBytes(WaveOSC, msg)
			os.Stdout.Write(barr)
		}
	}()
	return rpcClient, ptyBuf
}
