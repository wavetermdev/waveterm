// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"os"
	"runtime/debug"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var (
	rootCmd = &cobra.Command{
		Use:          "wsh",
		Short:        "CLI tool to control Wave Terminal",
		Long:         `wsh is a small utility that lets you do cool things with Wave Terminal, right from the command line`,
		SilenceUsage: true,
	}
)

var WrappedStdin io.Reader = os.Stdin
var WrappedStdout io.Writer = &WrappedWriter{dest: os.Stdout}
var WrappedStderr io.Writer = &WrappedWriter{dest: os.Stderr}
var RpcClient *wshutil.WshRpc
var RpcContext wshrpc.RpcContext
var UsingTermWshMode bool
var blockArg string
var WshExitCode int

type WrappedWriter struct {
	dest io.Writer
}

func (w *WrappedWriter) Write(p []byte) (n int, err error) {
	if !UsingTermWshMode {
		return w.dest.Write(p)
	}
	count := 0
	for _, b := range p {
		if b == '\n' {
			count++
		}
	}
	if count == 0 {
		return w.dest.Write(p)
	}
	buf := make([]byte, len(p)+count) // Each '\n' adds one extra byte for '\r'
	writeIdx := 0
	for _, b := range p {
		if b == '\n' {
			buf[writeIdx] = '\r'
			buf[writeIdx+1] = '\n'
			writeIdx += 2
		} else {
			buf[writeIdx] = b
			writeIdx++
		}
	}
	return w.dest.Write(buf)
}

func WriteStderr(fmtStr string, args ...interface{}) {
	WrappedStderr.Write([]byte(fmt.Sprintf(fmtStr, args...)))
}

func WriteStdout(fmtStr string, args ...interface{}) {
	WrappedStdout.Write([]byte(fmt.Sprintf(fmtStr, args...)))
}

func OutputHelpMessage(cmd *cobra.Command) {
	cmd.SetOutput(WrappedStderr)
	cmd.Help()
	WriteStderr("\n")
}

func preRunSetupRpcClient(cmd *cobra.Command, args []string) error {
	jwtToken := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwtToken == "" {
		wshutil.SetTermRawModeAndInstallShutdownHandlers(true)
		UsingTermWshMode = true
		RpcClient, WrappedStdin = wshutil.SetupTerminalRpcClient(nil, "wshcmd-termclient")
		return nil
	}
	err := setupRpcClient(nil, jwtToken)
	if err != nil {
		return err
	}
	return nil
}

func getIsTty() bool {
	if fileInfo, _ := os.Stdout.Stat(); (fileInfo.Mode() & os.ModeCharDevice) != 0 {
		return true
	}
	return false
}

func getThisBlockMeta() (waveobj.MetaMapType, error) {
	blockORef := waveobj.ORef{OType: waveobj.OType_Block, OID: RpcContext.BlockId}
	resp, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: blockORef}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return nil, fmt.Errorf("getting metadata: %w", err)
	}
	return resp, nil
}

type RunEFnType = func(*cobra.Command, []string) error

func activityWrap(activityStr string, origRunE RunEFnType) RunEFnType {
	return func(cmd *cobra.Command, args []string) (rtnErr error) {
		defer func() {
			sendActivity(activityStr, rtnErr == nil)
		}()
		return origRunE(cmd, args)
	}
}

func resolveBlockArg() (*waveobj.ORef, error) {
	oref := blockArg
	if oref == "" {
		oref = "this"
	}
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		return nil, fmt.Errorf("resolving blockid: %w", err)
	}
	return fullORef, nil
}

func setupRpcClientWithToken(swapTokenStr string) (wshrpc.CommandAuthenticateRtnData, error) {
	var rtn wshrpc.CommandAuthenticateRtnData
	token, err := shellutil.UnpackSwapToken(swapTokenStr)
	if err != nil {
		return rtn, fmt.Errorf("error unpacking token: %w", err)
	}
	if token.SockName == "" {
		return rtn, fmt.Errorf("no sockname in token")
	}
	if token.RpcContext == nil {
		return rtn, fmt.Errorf("no rpccontext in token")
	}
	RpcContext = *token.RpcContext
	RpcClient, err = wshutil.SetupDomainSocketRpcClient(token.SockName, nil, "wshcmd")
	if err != nil {
		return rtn, fmt.Errorf("error setting up domain socket rpc client: %w", err)
	}
	return wshclient.AuthenticateTokenCommand(RpcClient, wshrpc.CommandAuthenticateTokenData{Token: token.Token}, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
}

// returns the wrapped stdin and a new rpc client (that wraps the stdin input and stdout output)
func setupRpcClient(serverImpl wshutil.ServerImpl, jwtToken string) error {
	rpcCtx, err := wshutil.ExtractUnverifiedRpcContext(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting rpc context from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	RpcContext = *rpcCtx
	sockName, err := wshutil.ExtractUnverifiedSocketName(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting socket name from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	RpcClient, err = wshutil.SetupDomainSocketRpcClient(sockName, serverImpl, "wshcmd")
	if err != nil {
		return fmt.Errorf("error setting up domain socket rpc client: %v", err)
	}
	wshclient.AuthenticateCommand(RpcClient, jwtToken, &wshrpc.RpcOpts{NoResponse: true, Route: wshutil.ControlRoute})
	blockId := os.Getenv("WAVETERM_BLOCKID")
	if blockId != "" {
		peerInfo := fmt.Sprintf("domain:block:%s", blockId)
		wshclient.SetPeerInfoCommand(RpcClient, peerInfo, &wshrpc.RpcOpts{NoResponse: true, Route: wshutil.ControlRoute})
	}
	// note we don't modify WrappedStdin here (just use os.Stdin)
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
	blockId := os.Getenv("WAVETERM_BLOCKID")
	if blockId == "" {
		return nil, fmt.Errorf("no WAVETERM_BLOCKID env var set")
	}
	rtnData, err := wshclient.ResolveIdsCommand(RpcClient, wshrpc.CommandResolveIdsData{
		BlockId: blockId,
		Ids:     []string{id},
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return nil, fmt.Errorf("error resolving ids: %v", err)
	}
	oref, ok := rtnData.ResolvedIds[id]
	if !ok {
		return nil, fmt.Errorf("id not found: %q", id)
	}
	return &oref, nil
}

func getTabIdFromEnv() string {
	return os.Getenv("WAVETERM_TABID")
}

// this will send wsh activity to the client running on *your* local machine (it does not contact any wave cloud infrastructure)
// if you've turned off telemetry in your local client, this data never gets sent to us
// no parameters or timestamps are sent, as you can see below, it just sends the name of the command (and if there was an error)
// (e.g. "wsh ai ..." would send "ai")
// this helps us understand which commands are actually being used so we know where to concentrate our effort
func sendActivity(wshCmdName string, success bool) {
	if RpcClient == nil || wshCmdName == "" {
		return
	}
	dataMap := make(map[string]int)
	dataMap[wshCmdName] = 1
	if !success {
		dataMap[wshCmdName+"#"+"error"] = 1
	}
	wshclient.WshActivityCommand(RpcClient, dataMap, nil)
}

// Execute executes the root command.
func Execute() {
	defer func() {
		r := recover()
		if r != nil {
			WriteStderr("[panic] %v\n", r)
			debug.PrintStack()
			wshutil.DoShutdown("", 1, true)
		} else {
			wshutil.DoShutdown("", WshExitCode, false)
		}
	}()
	rootCmd.PersistentFlags().StringVarP(&blockArg, "block", "b", "", "for commands which require a block id")
	err := rootCmd.Execute()
	if err != nil {
		wshutil.DoShutdown("", 1, true)
		return
	}
}
