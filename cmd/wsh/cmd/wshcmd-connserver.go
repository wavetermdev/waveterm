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
	"github.com/wavetermdev/waveterm/pkg/baseds"
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
var connServerRouterDomainSocket bool
var connServerConnName string
var connServerDev bool
var ConnServerWshRouter *wshutil.WshRouter

func init() {
	serverCmd.Flags().BoolVar(&connServerRouter, "router", false, "run in local router mode (stdio upstream)")
	serverCmd.Flags().BoolVar(&connServerRouterDomainSocket, "router-domainsocket", false, "run in local router mode (domain socket upstream)")
	serverCmd.Flags().StringVar(&connServerConnName, "conn", "", "connection name")
	serverCmd.Flags().BoolVar(&connServerDev, "dev", false, "enable dev mode with file logging and PID in logs")
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
			if linkId != baseds.NoLinkId {
				router.UnregisterLink(baseds.LinkId(linkId))
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
	routeId := wshutil.MakeConnectionRouteId(connServerConnName)
	rpcCtx := wshrpc.RpcContext{
		RouteId: routeId,
		Conn:    connServerConnName,
	}

	bareRouteId := wshutil.MakeRandomProcRouteId()
	bareClient := wshutil.MakeWshRpc(wshrpc.RpcContext{}, &wshclient.WshServer{}, bareRouteId)
	router.RegisterTrustedLeaf(bareClient, bareRouteId)

	connServerClient := wshutil.MakeWshRpc(rpcCtx, wshremote.MakeRemoteRpcServerImpl(os.Stdout, router, bareClient, false), routeId)
	router.RegisterTrustedLeaf(connServerClient, routeId)
	return connServerClient, nil
}

func serverRunRouter() error {
	log.Printf("starting connserver router")
	router := wshutil.NewWshRouter()
	ConnServerWshRouter = router
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
		defer func() {
			log.Printf("stdin closed, shutting down")
			wshutil.DoShutdown("", 0, true)
		}()
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

func serverRunRouterDomainSocket(jwtToken string) error {
	log.Printf("starting connserver router (domain socket upstream)")

	// extract socket name from JWT token (unverified - we're on the client side)
	sockName, err := wshutil.ExtractUnverifiedSocketName(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting socket name from JWT: %v", err)
	}

	// connect to the forwarded domain socket
	sockName = wavebase.ExpandHomeDirSafe(sockName)
	conn, err := net.Dial("unix", sockName)
	if err != nil {
		return fmt.Errorf("error connecting to domain socket %s: %v", sockName, err)
	}

	// create router
	router := wshutil.NewWshRouter()
	ConnServerWshRouter = router

	// create proxy for the domain socket connection
	upstreamProxy := wshutil.MakeRpcProxy("connserver-upstream")

	// goroutine to write to the domain socket
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouterDomainSocket:WriteLoop", recover())
		}()
		writeErr := wshutil.AdaptOutputChToStream(upstreamProxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("error writing to upstream domain socket: %v\n", writeErr)
		}
	}()

	// goroutine to read from the domain socket
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouterDomainSocket:ReadLoop", recover())
		}()
		defer func() {
			log.Printf("upstream domain socket closed, shutting down")
			wshutil.DoShutdown("", 0, true)
		}()
		wshutil.AdaptStreamToMsgCh(conn, upstreamProxy.FromRemoteCh)
	}()

	// register the domain socket connection as upstream
	router.RegisterUpstream(upstreamProxy)

	// setup the connserver rpc client (leaf)
	client, err := setupConnServerRpcClientWithRouter(router)
	if err != nil {
		return fmt.Errorf("error setting up connserver rpc client: %v", err)
	}
	wshfs.RpcClient = client

	// authenticate with the upstream router using the JWT
	_, err = wshclient.AuthenticateCommand(client, jwtToken, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		return fmt.Errorf("error authenticating with upstream: %v", err)
	}
	log.Printf("authenticated with upstream router")

	// fetch and set JWT public key
	log.Printf("trying to get JWT public key")
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

	// set up the local domain socket listener for local wsh commands
	unixListener, err := MakeRemoteUnixListener()
	if err != nil {
		return fmt.Errorf("cannot create unix listener: %v", err)
	}
	log.Printf("unix listener started")
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouterDomainSocket:runListener", recover())
		}()
		runListener(unixListener, router)
	}()

	// run the sysinfo loop
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouterDomainSocket:RunSysInfoLoop", recover())
		}()
		wshremote.RunSysInfoLoop(client, connServerConnName)
	}()

	log.Printf("running server (router-domainsocket mode), successfully started")
	select {}
}

func serverRunNormal(jwtToken string) error {
	err := setupRpcClient(wshremote.MakeRemoteRpcServerImpl(os.Stdout, nil, nil, false), jwtToken)
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
	var logFile *os.File
	if connServerDev {
		var err error
		logFile, err = os.OpenFile("/tmp/connserver.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to open log file: %v\n", err)
			log.SetFlags(log.LstdFlags | log.Lmicroseconds)
			log.SetPrefix(fmt.Sprintf("[PID:%d] ", os.Getpid()))
		} else {
			defer logFile.Close()
			logWriter := io.MultiWriter(os.Stderr, logFile)
			log.SetOutput(logWriter)
			log.SetFlags(log.LstdFlags | log.Lmicroseconds)
			log.SetPrefix(fmt.Sprintf("[PID:%d] ", os.Getpid()))
		}
	}
	if connServerConnName == "" {
		if logFile != nil {
			fmt.Fprintf(logFile, "--conn parameter is required\n")
		}
		return fmt.Errorf("--conn parameter is required")
	}
	installErr := wshutil.InstallRcFiles()
	if installErr != nil {
		if logFile != nil {
			fmt.Fprintf(logFile, "error installing rc files: %v\n", installErr)
		}
		log.Printf("error installing rc files: %v", installErr)
	}
	sigutil.InstallSIGUSR1Handler()
	if connServerRouter {
		err := serverRunRouter()
		if err != nil && logFile != nil {
			fmt.Fprintf(logFile, "serverRunRouter error: %v\n", err)
		}
		return err
	}
	if connServerRouterDomainSocket {
		jwtToken, err := askForJwtToken()
		if err != nil {
			if logFile != nil {
				fmt.Fprintf(logFile, "askForJwtToken error: %v\n", err)
			}
			return err
		}
		err = serverRunRouterDomainSocket(jwtToken)
		if err != nil && logFile != nil {
			fmt.Fprintf(logFile, "serverRunRouterDomainSocket error: %v\n", err)
		}
		return err
	}
	jwtToken, err := askForJwtToken()
	if err != nil {
		if logFile != nil {
			fmt.Fprintf(logFile, "askForJwtToken error: %v\n", err)
		}
		return err
	}
	err = serverRunNormal(jwtToken)
	if err != nil && logFile != nil {
		fmt.Fprintf(logFile, "serverRunNormal error: %v\n", err)
	}
	return err
}
