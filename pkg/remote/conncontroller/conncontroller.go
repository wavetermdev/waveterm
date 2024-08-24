// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kevinburke/ssh_config"
	"github.com/wavetermdev/thenextwave/pkg/remote"
	"github.com/wavetermdev/thenextwave/pkg/userinput"
	"github.com/wavetermdev/thenextwave/pkg/util/shellutil"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wps"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"golang.org/x/crypto/ssh"
)

const (
	Status_Init         = "init"
	Status_Connecting   = "connecting"
	Status_Connected    = "connected"
	Status_Disconnected = "disconnected"
	Status_Error        = "error"
)

var globalLock = &sync.Mutex{}
var clientControllerMap = make(map[remote.SSHOpts]*SSHConn)

type SSHConn struct {
	Lock               *sync.Mutex
	Status             string
	Opts               *remote.SSHOpts
	Client             *ssh.Client
	SockName           string
	DomainSockListener net.Listener
	ConnController     *ssh.Session
	Error              string
	HasWaiter          *atomic.Bool
}

func GetAllConnStatus() []wshrpc.ConnStatus {
	globalLock.Lock()
	defer globalLock.Unlock()

	var connStatuses []wshrpc.ConnStatus
	for _, conn := range clientControllerMap {
		connStatuses = append(connStatuses, conn.DeriveConnStatus())
	}
	return connStatuses
}

func (conn *SSHConn) DeriveConnStatus() wshrpc.ConnStatus {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return wshrpc.ConnStatus{
		Status:     conn.Status,
		Connection: conn.Opts.String(),
		Connected:  conn.Client != nil,
		Error:      conn.Error,
	}
}

func (conn *SSHConn) FireConnChangeEvent() {
	status := conn.DeriveConnStatus()
	event := wshrpc.WaveEvent{
		Event: wshrpc.Event_ConnChange,
		Scopes: []string{
			fmt.Sprintf("connection:%s", conn.GetName()),
		},
		Data: status,
	}
	log.Printf("sending event: %+#v", event)
	wps.Broker.Publish(event)
}

func (conn *SSHConn) Close() error {
	defer conn.FireConnChangeEvent()
	conn.WithLock(func() {
		if conn.Status == Status_Connected || conn.Status == Status_Connecting {
			// if status is init, disconnected, or error don't change it
			conn.Status = Status_Disconnected
		}
		conn.close_nolock()
	})
	// we must wait for the waiter to complete
	startTime := time.Now()
	for conn.HasWaiter.Load() {
		time.Sleep(10 * time.Millisecond)
		if time.Since(startTime) > 2*time.Second {
			return fmt.Errorf("timeout waiting for waiter to complete")
		}
	}
	return nil
}

func (conn *SSHConn) close_nolock() {
	// does not set status (that should happen at another level)
	if conn.DomainSockListener != nil {
		conn.DomainSockListener.Close()
		conn.DomainSockListener = nil
	}
	if conn.ConnController != nil {
		conn.ConnController.Close()
		conn.ConnController = nil
	}
	if conn.Client != nil {
		conn.Client.Close()
		conn.Client = nil
	}
}

func (conn *SSHConn) GetDomainSocketName() string {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.SockName
}

func (conn *SSHConn) GetStatus() string {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.Status
}

func (conn *SSHConn) GetName() string {
	// no lock required because opts is immutable
	return conn.Opts.String()
}

func (conn *SSHConn) OpenDomainSocketListener() error {
	var allowed bool
	conn.WithLock(func() {
		if conn.Status != Status_Connecting {
			allowed = false
		} else {
			allowed = true
		}
	})
	if !allowed {
		return fmt.Errorf("cannot open domain socket for %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	client := conn.GetClient()
	randStr, err := utilfn.RandomHexString(16) // 64-bits of randomness
	if err != nil {
		return fmt.Errorf("error generating random string: %w", err)
	}
	sockName := fmt.Sprintf("/tmp/waveterm-%s.sock", randStr)
	log.Printf("remote domain socket %s %q\n", conn.GetName(), sockName)
	listener, err := client.ListenUnix(sockName)
	if err != nil {
		return fmt.Errorf("unable to request connection domain socket: %v", err)
	}
	conn.WithLock(func() {
		conn.SockName = sockName
		conn.DomainSockListener = listener
	})
	go func() {
		defer conn.WithLock(func() {
			conn.DomainSockListener = nil
			conn.SockName = ""
		})
		wshutil.RunWshRpcOverListener(listener)
	}()
	return nil
}

func (conn *SSHConn) StartConnServer() error {
	var allowed bool
	conn.WithLock(func() {
		if conn.Status != Status_Connecting {
			allowed = false
		} else {
			allowed = true
		}
	})
	if !allowed {
		return fmt.Errorf("cannot start conn server for %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	client := conn.GetClient()
	wshPath := remote.GetWshPath(client)
	rpcCtx := wshrpc.RpcContext{
		ClientType: wshrpc.ClientType_ConnServer,
		Conn:       conn.GetName(),
	}
	sockName := conn.GetDomainSocketName()
	jwtToken, err := wshutil.MakeClientJWTToken(rpcCtx, sockName)
	if err != nil {
		return fmt.Errorf("unable to create jwt token for conn controller: %w", err)
	}
	sshSession, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("unable to create ssh session for conn controller: %w", err)
	}
	pipeRead, pipeWrite := io.Pipe()
	sshSession.Stdout = pipeWrite
	sshSession.Stderr = pipeWrite
	cmdStr := fmt.Sprintf("%s=\"%s\" %s connserver", wshutil.WaveJwtTokenVarName, jwtToken, wshPath)
	log.Printf("starting conn controller: %s\n", cmdStr)
	err = sshSession.Start(cmdStr)
	if err != nil {
		return fmt.Errorf("unable to start conn controller: %w", err)
	}
	conn.WithLock(func() {
		conn.ConnController = sshSession
	})
	// service the I/O
	go func() {
		// wait for termination, clear the controller
		defer conn.WithLock(func() {
			conn.ConnController = nil
		})
		waitErr := sshSession.Wait()
		log.Printf("conn controller (%q) terminated: %v", conn.GetName(), waitErr)
	}()
	go func() {
		readErr := wshutil.StreamToLines(pipeRead, func(line []byte) {
			lineStr := string(line)
			if !strings.HasSuffix(lineStr, "\n") {
				lineStr += "\n"
			}
			log.Printf("[conncontroller:%s:output] %s", conn.GetName(), lineStr)
		})
		if readErr != nil && readErr != io.EOF {
			log.Printf("[conncontroller:%s] error reading output: %v\n", conn.GetName(), readErr)
		}
	}()
	return nil
}

func (conn *SSHConn) checkAndInstallWsh(ctx context.Context) error {
	client := conn.GetClient()
	if client == nil {
		return fmt.Errorf("client is nil")
	}
	// check that correct wsh extensions are installed
	expectedVersion := fmt.Sprintf("wsh v%s", wavebase.WaveVersion)
	clientVersion, err := remote.GetWshVersion(client)
	if err == nil && clientVersion == expectedVersion {
		return nil
	}
	// TODO add some progress to SSHConn about install status
	var queryText string
	var title string
	if err != nil {
		queryText = "Waveterm requires `wsh` shell extensions installed on your client to ensure a seamless experience. Would you like to install them?"
		title = "Install Wsh Shell Extensions"
	} else {
		queryText = fmt.Sprintf("Waveterm requires `wsh` shell extensions installed on your client to be updated from %s to %s. Would you like to update?", clientVersion, expectedVersion)
		title = "Update Wsh Shell Extensions"
	}
	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Title:        title,
		CheckBoxMsg:  "Don't show me this again",
	}
	response, err := userinput.GetUserInput(ctx, request)
	if err != nil || !response.Confirm {
		return err
	}
	log.Printf("attempting to install wsh to `%s@%s`", client.User(), client.RemoteAddr().String())
	clientOs, err := remote.GetClientOs(client)
	if err != nil {
		return err
	}
	clientArch, err := remote.GetClientArch(client)
	if err != nil {
		return err
	}
	// attempt to install extension
	wshLocalPath := shellutil.GetWshBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	err = remote.CpHostToRemote(client, wshLocalPath, "~/.waveterm/bin/wsh")
	if err != nil {
		return err
	}
	log.Printf("successfully installed wsh on %s\n", conn.GetName())
	return nil
}

func (conn *SSHConn) GetClient() *ssh.Client {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.Client
}

func (conn *SSHConn) Reconnect(ctx context.Context) error {
	err := conn.Close()
	if err != nil {
		return err
	}
	return conn.Connect(ctx)
}

// does not return an error since that error is stored inside of SSHConn
func (conn *SSHConn) Connect(ctx context.Context) error {
	var connectAllowed bool
	conn.WithLock(func() {
		if conn.Status == Status_Connecting || conn.Status == Status_Connected {
			connectAllowed = false
		} else {
			conn.Status = Status_Connecting
			conn.Error = ""
			connectAllowed = true
		}
	})
	if !connectAllowed {
		return fmt.Errorf("cannot connect to %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	conn.FireConnChangeEvent()
	err := conn.connectInternal(ctx)
	conn.WithLock(func() {
		if err != nil {
			conn.Status = Status_Error
			conn.Error = err.Error()
			conn.close_nolock()
		} else {
			conn.Status = Status_Connected
		}
	})
	conn.FireConnChangeEvent()
	return err
}

func (conn *SSHConn) WithLock(fn func()) {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	fn()
}

func (conn *SSHConn) connectInternal(ctx context.Context) error {
	client, err := remote.ConnectToClient(ctx, conn.Opts) //todo specify or remove opts
	if err != nil {
		return err
	}
	conn.WithLock(func() {
		conn.Client = client
	})
	err = conn.OpenDomainSocketListener()
	if err != nil {
		return err
	}
	installErr := conn.checkAndInstallWsh(ctx)
	if installErr != nil {
		return fmt.Errorf("conncontroller %s wsh install error: %v", conn.GetName(), installErr)
	}
	csErr := conn.StartConnServer()
	if csErr != nil {
		return fmt.Errorf("conncontroller %s start wsh connserver error: %v", conn.GetName(), csErr)
	}
	conn.HasWaiter.Store(true)
	go conn.waitForDisconnect()
	return nil
}

func (conn *SSHConn) waitForDisconnect() {
	defer conn.FireConnChangeEvent()
	defer conn.HasWaiter.Store(false)
	client := conn.GetClient()
	if client == nil {
		return
	}
	err := client.Wait()
	conn.WithLock(func() {
		if err != nil {
			if conn.Status != Status_Disconnected {
				// don't set the error if our status is disconnected (because this error was caused by an explicit close)
				conn.Status = Status_Error
				conn.Error = err.Error()
			}
		} else {
			// not sure if this is possible, because I think Wait() always returns an error (although that's not in the docs)
			conn.Status = Status_Disconnected
		}
		conn.close_nolock()
	})
}

func getConnInternal(opts *remote.SSHOpts) *SSHConn {
	globalLock.Lock()
	defer globalLock.Unlock()
	rtn := clientControllerMap[*opts]
	if rtn == nil {
		rtn = &SSHConn{Lock: &sync.Mutex{}, Status: Status_Init, Opts: opts, HasWaiter: &atomic.Bool{}}
		clientControllerMap[*opts] = rtn
	}
	return rtn
}

func GetConn(ctx context.Context, opts *remote.SSHOpts, shouldConnect bool) *SSHConn {
	conn := getConnInternal(opts)
	if conn.Client == nil && shouldConnect {
		conn.Connect(ctx)
	}
	return conn
}

func DisconnectClient(opts *remote.SSHOpts) error {
	conn := getConnInternal(opts)
	if conn == nil {
		return fmt.Errorf("client %q not found", opts.String())
	}
	err := conn.Close()
	return err
}

func resolveSshConfigPatterns(configFiles []string) ([]string, error) {
	// using two separate containers to track order and have O(1) lookups
	// since go does not have an ordered map primitive
	var discoveredPatterns []string
	alreadyUsed := make(map[string]bool)
	alreadyUsed[""] = true // this excludes the empty string from potential alias
	var openedFiles []fs.File

	defer func() {
		for _, openedFile := range openedFiles {
			openedFile.Close()
		}
	}()

	var errs []error
	for _, configFile := range configFiles {
		fd, openErr := os.Open(configFile)
		openedFiles = append(openedFiles, fd)
		if fd == nil {
			errs = append(errs, openErr)
			continue
		}

		cfg, _ := ssh_config.Decode(fd)
		for _, host := range cfg.Hosts {
			// for each host, find the first good alias
			for _, hostPattern := range host.Patterns {
				hostPatternStr := hostPattern.String()
				if !strings.Contains(hostPatternStr, "*") || alreadyUsed[hostPatternStr] {
					discoveredPatterns = append(discoveredPatterns, hostPatternStr)
					alreadyUsed[hostPatternStr] = true
					break
				}
			}
		}
	}
	if len(errs) == len(configFiles) {
		errs = append([]error{fmt.Errorf("no ssh config files could be opened:\n")}, errs...)
		return nil, errors.Join(errs...)
	}
	if len(discoveredPatterns) == 0 {
		return nil, fmt.Errorf("no compatible hostnames found in ssh config files")
	}

	return discoveredPatterns, nil
}

func GetConnectionsFromConfig() ([]string, error) {
	home := wavebase.GetHomeDir()
	localConfig := filepath.Join(home, ".ssh", "config")
	systemConfig := filepath.Join("/etc", "ssh", "config")
	sshConfigFiles := []string{localConfig, systemConfig}
	ssh_config.ReloadConfigs()

	return resolveSshConfigPatterns(sshConfigFiles)
}
