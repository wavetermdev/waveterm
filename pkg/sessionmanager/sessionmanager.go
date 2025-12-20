// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionmanager

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const ShutdownDelayTime = 5 * time.Second

type SessionManager struct {
	clientId  string
	sessionId string
	lock      sync.Mutex
	routes    map[string]bool
	listener  net.Listener
	cmd       *exec.Cmd
	cmdPty    pty.Pty
	cleanedUp bool
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

func (sm *SessionManager) SetListener(listener net.Listener) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.listener = listener
}

func (sm *SessionManager) SetCmd(cmd *exec.Cmd, cmdPty pty.Pty) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	sm.cmd = cmd
	sm.cmdPty = cmdPty
}

func (sm *SessionManager) GetCmd() (*exec.Cmd, pty.Pty) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	return sm.cmd, sm.cmdPty
}

func (sm *SessionManager) StartProc(cmd string, args []string, env map[string]string, termSize waveobj.TermSize) (int, error) {
	ecmd := exec.Command(cmd, args...)
	if len(env) > 0 {
		ecmd.Env = os.Environ()
		for key, val := range env {
			ecmd.Env = append(ecmd.Env, fmt.Sprintf("%s=%s", key, val))
		}
	}
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = 25
		termSize.Cols = 80
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return 0, fmt.Errorf("invalid term size: %v", termSize)
	}
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	if err != nil {
		return 0, fmt.Errorf("failed to start command: %w", err)
	}
	sm.SetCmd(ecmd, cmdPty)
	return ecmd.Process.Pid, nil
}

func (sm *SessionManager) setupSignalHandlers() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigChan
		log.Printf("received signal: %v\n", sig)

		cmd, _ := sm.GetCmd()
		if cmd != nil && cmd.Process != nil {
			log.Printf("forwarding signal %v to child process\n", sig)
			cmd.Process.Signal(sig)
			time.Sleep(ShutdownDelayTime)
		}

		sm.Cleanup()
		os.Exit(0)
	}()
}

func (sm *SessionManager) Cleanup() {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if sm.cleanedUp {
		return
	}
	sm.cleanedUp = true

	if sm.listener != nil {
		if err := sm.listener.Close(); err != nil {
			log.Printf("error closing listener: %v\n", err)
		}
	}

	socketPath, err := GetSessionSocketPath(sm.clientId, sm.sessionId)
	if err != nil {
		log.Printf("error getting socket path for cleanup: %v\n", err)
		return
	}

	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		log.Printf("error removing socket file: %v\n", err)
	}

	pidPath := strings.TrimSuffix(socketPath, ".sock") + ".pid"
	if err := os.Remove(pidPath); err != nil && !os.IsNotExist(err) {
		log.Printf("error removing pid file: %v\n", err)
	}

	log.Printf("SessionManager cleanup complete for session %s (client %s)\n", sm.sessionId, sm.clientId)
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
	log.SetFlags(log.LstdFlags | log.Ldate | log.Ltime)
	log.SetPrefix(fmt.Sprintf("[%s] ", sessionId))

	pidPath := strings.TrimSuffix(socketPath, ".sock") + ".pid"
	err = os.WriteFile(pidPath, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0600)
	if err != nil {
		return fmt.Errorf("error writing pid file: %v", err)
	}

	listener, err := MakeSessionUnixListener(socketPath)
	if err != nil {
		return err
	}
	sm := GetSessionManager()
	sm.SetListener(listener)

	// No return after this point. We are now a daemon, managed by the pid/signals/rpc
	log.Printf("SessionManager started for session %s (client %s)\n", sessionId, clientId)

	sm.setupSignalHandlers()

	runSessionListener(listener, clientId, sessionId, authToken)

	os.Exit(0)
	return nil // unreachable
}
