// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionmanager

import (
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type SessionManager struct {
	clientId  string
	sessionId string
	lock      sync.Mutex
	routes    map[string]bool
}

var globalSessionManager atomic.Pointer[SessionManager]

func GetSessionManager() *SessionManager {
	return globalSessionManager.Load()
}

func initSessionManager(clientId, sessionId string) *SessionManager {
	sm := &SessionManager{
		clientId:  clientId,
		sessionId: sessionId,
		routes:    make(map[string]bool),
	}
	globalSessionManager.Store(sm)
	return sm
}

func (sm *SessionManager) RegisterRoute(routeId string) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.routes[routeId] = true
}

func (sm *SessionManager) UnregisterRoute(routeId string) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	delete(sm.routes, routeId)
}

func GetSessionSocketPath(clientId string, sessionId string) (string, error) {
	homeDir := wavebase.GetHomeDir()
	sessionsDir := filepath.Join(homeDir, ".waveterm", "sessions", clientId)
	err := os.MkdirAll(sessionsDir, 0700)
	if err != nil {
		return "", fmt.Errorf("error creating sessions directory: %v", err)
	}
	return filepath.Join(sessionsDir, sessionId+".sock"), nil
}

func MakeSessionUnixListener(socketPath string) (net.Listener, error) {
	os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", socketPath, err)
	}
	os.Chmod(socketPath, 0700)
	log.Printf("SessionManager [unix-domain] listening on %s\n", socketPath)
	return listener, nil
}

func handleSessionConnection(conn net.Conn, clientId string, sessionId string, authToken string) {
	var routeIdContainer atomic.Pointer[string]
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
		defer func() {
			conn.Close()
			close(proxy.FromRemoteCh)
			close(proxy.ToRemoteCh)
			routeIdPtr := routeIdContainer.Load()
			if routeIdPtr != nil && *routeIdPtr != "" {
				wshutil.DefaultRouter.UnregisterRoute(*routeIdPtr)
				GetSessionManager().UnregisterRoute(*routeIdPtr)
			}
		}()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()

	rpcCtx, err := proxy.HandleAuthentication(authToken)
	if err != nil {
		conn.Close()
		log.Printf("error handling authentication: %v\n", err)
		return
	}
	log.Printf("session connection authenticated: %#v\n", rpcCtx)
	proxy.SetRpcContext(rpcCtx)
	routeId, err := wshutil.MakeRouteIdFromCtx(rpcCtx)
	if err != nil {
		conn.Close()
		log.Printf("error making route id: %v\n", err)
		return
	}
	routeIdContainer.Store(&routeId)
	wshutil.DefaultRouter.RegisterRoute(routeId, proxy, true)
	GetSessionManager().RegisterRoute(routeId)
}

func runSessionListener(listener net.Listener, clientId string, sessionId string, authToken string) {
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
		go handleSessionConnection(conn, clientId, sessionId, authToken)
	}
}

func RunSessionManager(clientId string, sessionId string, authToken string) error {
	initSessionManager(clientId, sessionId)
	registerSessionManagerRoute()

	socketPath, err := GetSessionSocketPath(clientId, sessionId)
	if err != nil {
		return err
	}

	logPath := strings.TrimSuffix(socketPath, ".sock") + ".log"
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("error creating log file: %v", err)
	}
	log.SetOutput(logFile)

	listener, err := MakeSessionUnixListener(socketPath)
	if err != nil {
		return err
	}

	log.Printf("SessionManager started for session %s (client %s)\n", sessionId, clientId)

	runSessionListener(listener, clientId, sessionId, authToken)

	return nil
}
