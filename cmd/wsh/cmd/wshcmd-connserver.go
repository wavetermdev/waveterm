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
	"syscall"
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
var singleServerRouter bool

func init() {
	serverCmd.Flags().BoolVar(&connServerRouter, "router", false, "run in local router mode")
	serverCmd.Flags().BoolVar(&singleServerRouter, "single", false, "run in local single mode")
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

func setupConnServerRpcClientWithRouter(router *wshutil.WshRouter, jwtToken string) (*wshutil.WshRpc, error) {
	rpcCtx, err := wshutil.ExtractUnverifiedRpcContext(jwtToken)
	if err != nil {
		return nil, fmt.Errorf("error extracting rpc context from JWT token: %v", err)
	}
	authRtn, err := router.HandleProxyAuth(jwtToken)
	if err != nil {
		return nil, fmt.Errorf("error handling proxy auth: %v", err)
	}
	if authRtn.PublicKey != "" {
		pubKeyBytes, err := base64.StdEncoding.DecodeString(authRtn.PublicKey)
		if err != nil {
			return nil, fmt.Errorf("error decoding public key: %v", err)
		}
		if err := wavejwt.SetPublicKey(pubKeyBytes); err != nil {
			return nil, fmt.Errorf("error setting public key: %v", err)
		}
		log.Printf("connserver: set public key from auth response\n")
	}
	inputCh := make(chan []byte, wshutil.DefaultInputChSize)
	outputCh := make(chan []byte, wshutil.DefaultOutputChSize)
	connServerClient := wshutil.MakeWshRpc(inputCh, outputCh, *rpcCtx, &wshremote.ServerImpl{LogWriter: os.Stdout}, authRtn.RouteId)
	connServerClient.SetAuthToken(authRtn.AuthToken)
	router.RegisterUntrustedLink(connServerClient)
	// wshclient.RouteAnnounceCommand(connServerClient, nil)
	return connServerClient, nil
}

func serverRunRouter(jwtToken string) error {
	router := wshutil.NewWshRouter()
	termProxy := wshutil.MakeRpcProxy("connserver-term")
	rawCh := make(chan []byte, wshutil.DefaultOutputChSize)
	go packetparser.Parse(os.Stdin, termProxy.FromRemoteCh, rawCh)
	go func() {
		defer func() {
			panichandler.PanicHandler("serverRunRouter:WritePackets", recover())
		}()
		for msg := range termProxy.ToRemoteCh {
			packetparser.WritePacket(os.Stdout, msg)
		}
	}()
	go func() {
		// just ignore and drain the rawCh (stdin)
		// when stdin is closed, shutdown
		defer wshutil.DoShutdown("", 0, true)
		for range rawCh {
			// ignore
		}
	}()
	go func() {
		for msg := range termProxy.FromRemoteCh {
			// send this to the router
			router.InjectMessage(msg, wshutil.UpstreamRoute)
		}
	}()
	router.RegisterUpstream(termProxy)
	// now set up the domain socket
	unixListener, err := MakeRemoteUnixListener()
	if err != nil {
		return fmt.Errorf("cannot create unix listener: %v", err)
	}
	client, err := setupConnServerRpcClientWithRouter(router, jwtToken)
	if err != nil {
		return fmt.Errorf("error setting up connserver rpc client: %v", err)
	}
	wshfs.RpcClient = client
	go runListener(unixListener, router)
	// run the sysinfo loop
	wshremote.RunSysInfoLoop(client, client.GetRpcContext().Conn)
	select {}
}

func checkForUpdate() error {
	remoteInfo := wshutil.GetInfo()
	needsRestart, err := wshclient.ConnUpdateWshCommand(RpcClient, remoteInfo, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("could not update: %w", err)
	}
	if needsRestart {
		// run the restart command here
		// how to get the correct path?
		return syscall.Exec("~/.waveterm/bin/wsh", []string{"wsh", "connserver", "--single"}, []string{})
	}
	return nil
}

func serverRunSingle(jwtToken string) error {
	err := setupRpcClient(&wshremote.ServerImpl{LogWriter: os.Stdout}, jwtToken)
	if err != nil {
		return err
	}
	WriteStdout("running wsh connserver (%s)\n", RpcContext.Conn)
	err = checkForUpdate()
	if err != nil {
		return err
	}

	go wshremote.RunSysInfoLoop(RpcClient, RpcContext.Conn)
	select {} // run forever
}

func serverRunNormal(jwtToken string) error {
	err := setupRpcClient(&wshremote.ServerImpl{LogWriter: os.Stdout}, jwtToken)
	if err != nil {
		return err
	}
	wshfs.RpcClient = RpcClient
	WriteStdout("running wsh connserver (%s)\n", RpcContext.Conn)
	go wshremote.RunSysInfoLoop(RpcClient, RpcContext.Conn)
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
	installErr := wshutil.InstallRcFiles()
	if installErr != nil {
		log.Printf("error installing rc files: %v", installErr)
	}
	jwtToken, err := askForJwtToken()
	if err != nil {
		return err
	}

	sigutil.InstallSIGUSR1Handler()

	if singleServerRouter {
		return serverRunSingle(jwtToken)
	} else if connServerRouter {
		return serverRunRouter(jwtToken)
	} else {
		return serverRunNormal(jwtToken)
	}
}
