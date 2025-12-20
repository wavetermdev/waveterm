// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var sessionManagerCmd = &cobra.Command{
	Use:    "sessionmanager",
	Hidden: true,
	Short:  "run a session manager server on a domain socket",
	Args:   cobra.NoArgs,
	RunE:   sessionManagerRun,
}

var sessionId string

func init() {
	sessionManagerCmd.Flags().StringVar(&sessionId, "id", "", "session id (uuid)")
	sessionManagerCmd.MarkFlagRequired("id")
	rootCmd.AddCommand(sessionManagerCmd)
}

func getSessionSocketPath(clientId string, sessionId string) (string, error) {
	homeDir := wavebase.GetHomeDir()
	sessionsDir := filepath.Join(homeDir, ".waveterm", "sessions", clientId)
	err := os.MkdirAll(sessionsDir, 0700)
	if err != nil {
		return "", fmt.Errorf("error creating sessions directory: %v", err)
	}
	return filepath.Join(sessionsDir, sessionId+".sock"), nil
}

func makeSessionUnixListener(socketPath string) (net.Listener, error) {
	os.Remove(socketPath) // ignore error
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", socketPath, err)
	}
	os.Chmod(socketPath, 0700)
	log.Printf("SessionManager [unix-domain] listening on %s\n", socketPath)
	return listener, nil
}

func handleSessionConnection(conn net.Conn) {
	defer func() {
		panichandler.PanicHandler("handleSessionConnection", recover())
		conn.Close()
	}()

	proxy := wshutil.MakeRpcProxy()
	
	go func() {
		defer func() {
			panichandler.PanicHandler("handleSessionConnection:AdaptOutputChToStream", recover())
		}()
		writeErr := wshutil.AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("error writing to session socket: %v\n", writeErr)
		}
	}()
	
	go func() {
		defer func() {
			panichandler.PanicHandler("handleSessionConnection:AdaptStreamToMsgCh", recover())
		}()
		defer conn.Close()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()

	// TODO: Implement actual wshrpc server handling
	// For now, just keep the connection open
	select {}
}

func runSessionListener(listener net.Listener) {
	defer func() {
		log.Printf("session listener closed, exiting\n")
		wshutil.DoShutdown("", 0, true)
	}()
	
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("error accepting connection: %v\n", err)
			continue
		}
		go handleSessionConnection(conn)
	}
}

func sessionManagerRun(cmd *cobra.Command, args []string) error {
	// Validate session ID is a valid UUID
	_, err := uuid.Parse(sessionId)
	if err != nil {
		return fmt.Errorf("invalid session id (must be uuid): %v", err)
	}

	// Get client ID from environment
	clientId := os.Getenv("WAVETERM_CLIENTID")
	if clientId == "" {
		return fmt.Errorf("WAVETERM_CLIENTID environment variable not set")
	}

	// Validate client ID is a valid UUID
	_, err = uuid.Parse(clientId)
	if err != nil {
		return fmt.Errorf("invalid WAVETERM_CLIENTID (must be uuid): %v", err)
	}

	// Create socket path
	socketPath, err := getSessionSocketPath(clientId, sessionId)
	if err != nil {
		return err
	}

	// Create unix domain socket listener
	listener, err := makeSessionUnixListener(socketPath)
	if err != nil {
		return err
	}

	log.Printf("SessionManager started for session %s (client %s)\n", sessionId, clientId)

	// Run the listener
	runSessionListener(listener)

	return nil
}
