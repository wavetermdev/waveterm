// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/packetparser"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
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
	var routeIdContainer atomic.Pointer[string]
	proxy := wshutil.MakeRpcProxy()
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
			routeIdPtr := routeIdContainer.Load()
			if routeIdPtr != nil && *routeIdPtr != "" {
				router.UnregisterRoute(*routeIdPtr)
				disposeMsg := &wshutil.RpcMessage{
					Command: wshrpc.Command_Dispose,
					Data: wshrpc.CommandDisposeData{
						RouteId: *routeIdPtr,
					},
					Source:    *routeIdPtr,
					AuthToken: proxy.GetAuthToken(),
				}
				disposeBytes, _ := json.Marshal(disposeMsg)
				router.InjectMessage(disposeBytes, *routeIdPtr)
			}
		}()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()
	routeId, err := proxy.HandleClientProxyAuth(router)
	if err != nil {
		log.Printf("error handling client proxy auth: %v\n", err)
		conn.Close()
		return
	}
	router.RegisterRoute(routeId, proxy, false)
	routeIdContainer.Store(&routeId)
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
	jwtToken := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwtToken == "" {
		return nil, fmt.Errorf("no jwt token found for connserver")
	}
	rpcCtx, err := wshutil.ExtractUnverifiedRpcContext(jwtToken)
	if err != nil {
		return nil, fmt.Errorf("error extracting rpc context from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	authRtn, err := router.HandleProxyAuth(jwtToken)
	if err != nil {
		return nil, fmt.Errorf("error handling proxy auth: %v", err)
	}
	inputCh := make(chan []byte, wshutil.DefaultInputChSize)
	outputCh := make(chan []byte, wshutil.DefaultOutputChSize)
	connServerClient := wshutil.MakeWshRpc(inputCh, outputCh, *rpcCtx, &wshremote.ServerImpl{LogWriter: os.Stdout})
	connServerClient.SetAuthToken(authRtn.AuthToken)
	router.RegisterRoute(authRtn.RouteId, connServerClient, false)
	wshclient.RouteAnnounceCommand(connServerClient, nil)
	return connServerClient, nil
}

func serverRunRouter() error {
	router := wshutil.NewWshRouter()
	termProxy := wshutil.MakeRpcProxy()
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
	router.SetUpstreamClient(termProxy)
	// now set up the domain socket
	unixListener, err := MakeRemoteUnixListener()
	if err != nil {
		return fmt.Errorf("cannot create unix listener: %v", err)
	}
	client, err := setupConnServerRpcClientWithRouter(router)
	if err != nil {
		return fmt.Errorf("error setting up connserver rpc client: %v", err)
	}
	go runListener(unixListener, router)
	// run the sysinfo loop
	wshremote.RunSysInfoLoop(client, client.GetRpcContext().Conn)
	select {}
}

func checkForUpdate() error {
	remoteInfo := wshutil.GetInfo()
	needsRestartRaw, err := RpcClient.SendRpcRequest(wshrpc.Command_ConnUpdateWsh, remoteInfo, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("could not update: %w", err)
	}
	needsRestart, ok := needsRestartRaw.(bool)
	if !ok {
		return fmt.Errorf("wrong return type from update")
	}
	if needsRestart {
		// run the restart command here
		// how to get the correct path?
		return syscall.Exec("~/.waveterm/bin/wsh", []string{"wsh", "connserver", "--single"}, []string{})
	}
	return nil
}

func serverRunSingle() error {
	err := setupRpcClient(&wshremote.ServerImpl{LogWriter: os.Stdout})
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

func serverRunNormal() error {
	err := setupRpcClient(&wshremote.ServerImpl{LogWriter: os.Stdout})
	if err != nil {
		return err
	}
	WriteStdout("running wsh connserver (%s)\n", RpcContext.Conn)
	go wshremote.RunSysInfoLoop(RpcClient, RpcContext.Conn)
	select {} // run forever
}

func serverRun(cmd *cobra.Command, args []string) error {
	if singleServerRouter {
		return serverRunSingle()
	} else if connServerRouter {
		return serverRunRouter()
	} else {
		return serverRunNormal()
	}
}
