// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

var (
	rootCmd = &cobra.Command{
		Use:   "wsh",
		Short: "CLI tool to control Wave Terminal",
		Long:  `wsh is a small utility that lets you do cool things with Wave Terminal, right from the command line`,
	}
)

var usingHtmlMode bool
var WrappedStdin io.Reader
var RpcClient *wshutil.WshRpc

func extraShutdownFn() {
	if usingHtmlMode {
		cmd := &wshrpc.CommandSetMetaData{
			Meta: map[string]any{"term:mode": nil},
		}
		RpcClient.SendCommand(wshrpc.Command_SetMeta, cmd)
		time.Sleep(10 * time.Millisecond)
	}
}

// returns the wrapped stdin and a new rpc client (that wraps the stdin input and stdout output)
func setupRpcClient(handlerFn wshutil.CommandHandlerFnType) {
	log.Printf("setup rpc client\r\n")
	RpcClient, WrappedStdin = wshutil.SetupTerminalRpcClient(handlerFn)
}

func setTermHtmlMode() {
	wshutil.SetExtraShutdownFunc(extraShutdownFn)
	wshutil.SetTermRawModeAndInstallShutdownHandlers(true)
	cmd := &wshrpc.CommandSetMetaData{
		Meta: map[string]any{"term:mode": "html"},
	}
	err := RpcClient.SendCommand(wshrpc.Command_SetMeta, cmd)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error setting html mode: %v\r\n", err)
	}
	usingHtmlMode = true
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

func resolveSimpleId(id string) (*waveobj.ORef, error) {
	if isFullORef(id) {
		orefObj, err := waveobj.ParseORef(id)
		if err != nil {
			return nil, fmt.Errorf("error parsing full ORef: %v", err)
		}
		return &orefObj, nil
	}
	rtnData, err := wshclient.ResolveIdsCommand(RpcClient, wshrpc.CommandResolveIdsData{Ids: []string{id}}, &wshrpc.WshRpcCommandOpts{Timeout: 2000})
	if err != nil {
		return nil, fmt.Errorf("error resolving ids: %v", err)
	}
	oref, ok := rtnData.ResolvedIds[id]
	if !ok {
		return nil, fmt.Errorf("id not found: %q", id)
	}
	return &oref, nil
}

// Execute executes the root command.
func Execute() error {
	defer wshutil.DoShutdown("", 0, false)
	setupRpcClient(nil)
	return rootCmd.Execute()
}
