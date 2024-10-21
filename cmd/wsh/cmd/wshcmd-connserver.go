// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sync/atomic"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshremote"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"golang.org/x/crypto/ssh/terminal"
)

var serverCmd = &cobra.Command{
	Use:    "connserver",
	Hidden: true,
	Short:  "remote server to power wave blocks",
	Args:   cobra.NoArgs,
	RunE:   serverRun,
}

var connServerRouter bool

func init() {
	serverCmd.Flags().BoolVar(&connServerRouter, "router", false, "run in local router mode")
	rootCmd.AddCommand(serverCmd)
}

func MakeRemoteUnixListener() (net.Listener, error) {
	serverAddr := wavebase.GetRemoteDomainSocketName()
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
	upstreamClient := router.GetUpstreamClient().(*wshutil.WshRpc)
	go func() {
		writeErr := wshutil.AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("error writing to domain socket: %v\n", writeErr)
		}
	}()
	go func() {
		// when input is closed, close the connection
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
				upstreamClient.SendRpcMessage(disposeBytes)
			}
		}()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()
	routeId, err := proxy.HandleClientProxyAuth(upstreamClient)
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

func serverRunRouter() error {
	isTerminal := terminal.IsTerminal(int(os.Stdout.Fd()))
	if isTerminal {
		wshutil.SetTermRawMode()
	}
	termClient, reader := wshutil.SetupTerminalRpcClient(&wshremote.ServerImpl{LogWriter: os.Stdout})
	go func() {
		// just ignore and drain the reader
		var errorCode int
		defer wshutil.DoShutdown("", errorCode, true)
		for {
			buf := make([]byte, 4096)
			_, err := reader.Read(buf)
			if err == io.EOF {
				break
			}
			if err != nil {
				errorCode = 1
				break
			}
		}
	}()
	router := wshutil.NewWshRouter()
	router.SetUpstreamClient(termClient)
	// now set up the domain socket
	unixListener, err := MakeRemoteUnixListener()
	if err != nil {
		return fmt.Errorf("cannot create unix listener: %v", err)
	}
	runListener(unixListener, router)

	select {}
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
	if connServerRouter {
		return serverRunRouter()
	} else {
		return serverRunNormal()
	}
}
