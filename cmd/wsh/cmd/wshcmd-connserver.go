// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/util/packetparser"
	"github.com/wavetermdev/waveterm/pkg/util/sigutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshremote"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var serverCmd = &cobra.Command{
	Use:    "connserver",
	Hidden: true,
	Short:  "remote server to power wave blocks",
	Args:   cobra.NoArgs,
	RunE:   serverRun,
}

var connServerRouter bool
var connServerConnName string

func init() {
	serverCmd.Flags().BoolVar(&connServerRouter, "router", false, "run in local router mode")
	serverCmd.Flags().StringVar(&connServerConnName, "conn", "", "connection name")
	rootCmd.AddCommand(serverCmd)
}

func getRemoteDomainSocketName() string {
	homeDir := wavebase.GetHomeDir()
	return filepath.Join(homeDir, wavebase.RemoteWaveHomeDirName, wavebase.RemoteDomainSocketBaseName)
}

func MakeRemoteUnixListener() (net.Listener, error) {
	serverAddr := getRemoteDomainSocketName()
	os.Remove(serverAddr) // ignore error
	rtn, err := net.Listen("unix", serverAddr)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", serverAddr, err)
	}
	os.Chmod(serverAddr, 0700)
	log.Printf("Server [unix-domain] listening on %s\n", serverAddr)
	return rtn, nil
}

func handleNewListenerConn(conn net.Conn, router *wshutil.WshRouter) {
	defer func() {
		panichandler.PanicHandler("handleNewListenerConn", recover())
	}()
	var linkIdContainer atomic.Int32
	proxy := wshutil.MakeRpcProxy(fmt.Sprintf("connserver:%s", conn.RemoteAddr().String()))
	go func() {
		defer func() {
			panichandler.PanicHandler("handleNewListenerConn:AdaptOutputChToStream", recover())
		}()
		writeErr := wshutil.AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("error writing to domain socket: %v\n", writeErr)
		}
	}()
	go func() {
		// when input is closed, close the connection
		defer func() {
			panichandler.PanicHandler("handleNewListenerConn:AdaptStreamToMsgCh", recover())
		}()
		defer func() {
			conn.Close()
			linkId := linkIdContainer.Load()
			if linkId != wshutil.NoLinkId {
				router.UnregisterLink(wshutil.LinkId(linkId))
			}
		}()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()
	linkId := router.RegisterUntrustedLink(proxy)
	linkIdContainer.Store(int32(linkId))
}

func runListener(listener net.Listener, router *wshutil.WshRouter) {
	defer func() {
		log.Printf("listener closed, exiting\n")
		time.Sleep(500 * time.Millisecond)
		wshutil.DoShutdown("", 1, true)
	}()
	for {
		conn, err := listener.Accept()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("error accepting connection: %v\n", err)
			continue
		}
		go handleNewListenerConn(conn, router)
	}
}

func setupConnServerRpcClientWithRouter(router *wshutil.WshRouter) (*wshutil.WshRpc, error) {
	inputCh := make(chan []byte, wshutil.DefaultInputChSize)
	outputCh := make(chan []byte, wshutil.DefaultOutputChSize)
	routeId := wshutil.MakeConnectionRouteId(connServerConnName)
	rpcCtx := wshrpc.RpcContext{
		RouteId: routeId,
		Conn:    connServerConnName,
	}
	connServerClient := wshutil.MakeWshRpc(inputCh, outputCh, rpcCtx, &wshremote.ServerImpl{LogWriter: os.Stdout}, routeId)
	router.RegisterTrustedLeaf(connServerClient, routeId)
	return connServerClient, nil
}

func serverRunRouter() error {
	log.Printf("starting connserver router")
	router := wshutil.NewWshRouter()
	termProxy := wshutil.MakeRpcProxy("connserver-term")
	rawCh := make(chan []byte, wshutil.DefaultOutputChSize)
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouter:Parse", recover())
		}()
		packetparser.Parse(os.Stdin, termProxy.FromRemoteCh, rawCh)
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouter:WritePackets", recover())
		}()
		for msg := range termProxy.ToRemoteCh {
			packetparser.WritePacket(os.Stdout, msg)
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouter:drainRawCh", recover())
		}()
		// just ignore and drain the rawCh (stdin)
		// when stdin is closed, shutdown
		defer wshutil.DoShutdown("", 0, true)
		for range rawCh {
			// ignore
		}
	}()
	router.RegisterUpstream(termProxy)

	// setup the connserver rpc client first
	client, err := setupConnServerRpcClientWithRouter(router)
	if err != nil {
		return fmt.Errorf("error setting up connserver rpc client: %v", err)
	}
	wshfs.RpcClient = client

	log.Printf("trying to get JWT public key")

	// fetch and set JWT public key
	jwtPublicKeyB64, err := wshclient.GetJwtPublicKeyCommand(client, nil)
	if err != nil {
		return fmt.Errorf("error getting jwt public key: %v", err)
	}
	jwtPublicKeyBytes, err := base64.StdEncoding.DecodeString(jwtPublicKeyB64)
	if err != nil {
		return fmt.Errorf("error decoding jwt public key: %v", err)
	}
	err = wavejwt.SetPublicKey(jwtPublicKeyBytes)
	if err != nil {
		return fmt.Errorf("error setting jwt public key: %v", err)
	}

	log.Printf("got JWT public key")

	// now set up the domain socket
	unixListener, err := MakeRemoteUnixListener()
	if err != nil {
		return fmt.Errorf("cannot create unix listener: %v", err)
	}
	log.Printf("unix listener started")
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouter:runListener", recover())
		}()
		runListener(unixListener, router)
	}()
	// run the sysinfo loop
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouter:RunSysInfoLoop", recover())
		}()
		wshremote.RunSysInfoLoop(client, connServerConnName)
	}()
	log.Printf("running server, successfully started")
	select {}
}

func serverRunNormal(jwtToken string) error {
	err := setupRpcClient(&wshremote.ServerImpl{LogWriter: os.Stdout}, jwtToken)
	if err != nil {
		return err
	}
	wshfs.RpcClient = RpcClient
	WriteStdout("running wsh connserver (%s)\n", RpcContext.Conn)
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunNormal:RunSysInfoLoop", recover())
		}()
		wshremote.RunSysInfoLoop(RpcClient, RpcContext.Conn)
	}()
	select {} // run forever
}

func askForJwtToken() (string, error) {
	// if it already exists in the environment, great, use it
	jwtToken := os.Getenv(wavebase.WaveJwtTokenVarName)
	if jwtToken != "" {
		fmt.Printf("HAVE-JWT\n")
		return jwtToken, nil
	}

	// otherwise, ask for it
	fmt.Printf("%s\n", wavebase.NeedJwtConst)

	// read a single line from stdin
	var line string
	_, err := fmt.Fscanln(os.Stdin, &line)
	if err != nil {
		return "", fmt.Errorf("failed to read JWT token from stdin: %w", err)
	}
	return strings.TrimSpace(line), nil
}

func serverRun(cmd *cobra.Command, args []string) error {
	if connServerConnName == "" {
		return fmt.Errorf("--conn parameter is required")
	}
	installErr := wshutil.InstallRcFiles()
	if installErr != nil {
		log.Printf("error installing rc files: %v", installErr)
	}
	sigutil.InstallSIGUSR1Handler()
	if connServerRouter {
		return serverRunRouter()
	}
	jwtToken, err := askForJwtToken()
	if err != nil {
		return err
	}
	return serverRunNormal(jwtToken)
}
