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
	"github.com/skeema/knownhosts"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"golang.org/x/crypto/ssh"
)

const (
	Status_Init         = "init"
	Status_Connecting   = "connecting"
	Status_Connected    = "connected"
	Status_Disconnected = "disconnected"
	Status_Error        = "error"
)

const DefaultConnectionTimeout = 60 * time.Second

var globalLock = &sync.Mutex{}
var clientControllerMap = make(map[remote.SSHOpts]*SSHConn)
var activeConnCounter = &atomic.Int32{}

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
	LastConnectTime    int64
	ActiveConnNum      int
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
		Status:        conn.Status,
		Connected:     conn.Status == Status_Connected,
		Connection:    conn.Opts.String(),
		HasConnected:  (conn.LastConnectTime > 0),
		ActiveConnNum: conn.ActiveConnNum,
		Error:         conn.Error,
	}
}

func (conn *SSHConn) FireConnChangeEvent() {
	status := conn.DeriveConnStatus()
	event := wps.WaveEvent{
		Event: wps.Event_ConnChange,
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
	log.Printf("remote domain socket %s %q\n", conn.GetName(), conn.GetDomainSocketName())
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
	shellPath, err := remote.DetectShell(client)
	if err != nil {
		return err
	}
	var cmdStr string
	if remote.IsPowershell(shellPath) {
		cmdStr = fmt.Sprintf("$env:%s=\"%s\"; %s connserver", wshutil.WaveJwtTokenVarName, jwtToken, wshPath)
	} else {
		cmdStr = fmt.Sprintf("%s=\"%s\" %s connserver", wshutil.WaveJwtTokenVarName, jwtToken, wshPath)
	}
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
	regCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	err = wshutil.DefaultRouter.WaitForRegister(regCtx, wshutil.MakeConnectionRouteId(rpcCtx.Conn))
	if err != nil {
		return fmt.Errorf("timeout waiting for connserver to register")
	}
	time.Sleep(300 * time.Millisecond) // TODO remove this sleep (but we need to wait until connserver is "ready")
	return nil
}

type WshInstallOpts struct {
	Force        bool
	NoUserPrompt bool
}

func (conn *SSHConn) CheckAndInstallWsh(ctx context.Context, clientDisplayName string, opts *WshInstallOpts) error {
	if opts == nil {
		opts = &WshInstallOpts{}
	}
	client := conn.GetClient()
	if client == nil {
		return fmt.Errorf("client is nil")
	}
	// check that correct wsh extensions are installed
	expectedVersion := fmt.Sprintf("wsh v%s", wavebase.WaveVersion)
	clientVersion, err := remote.GetWshVersion(client)
	if err == nil && clientVersion == expectedVersion && !opts.Force {
		return nil
	}
	var queryText string
	var title string
	if opts.Force {
		queryText = fmt.Sprintf("ReInstalling Wave Shell Extensions (%s) on `%s`\n", wavebase.WaveVersion, clientDisplayName)
		title = "Install Wave Shell Extensions"
	} else if err != nil {
		queryText = fmt.Sprintf("Wave requires Wave Shell Extensions to be  \n"+
			"installed on `%s`  \n"+
			"to ensure a seamless experience.  \n\n"+
			"Would you like to install them?", clientDisplayName)
		title = "Install Wave Shell Extensions"
	} else {
		// don't ask for upgrading the version
		opts.NoUserPrompt = true
	}
	if !opts.NoUserPrompt {
		request := &userinput.UserInputRequest{
			ResponseType: "confirm",
			QueryText:    queryText,
			Title:        title,
			Markdown:     true,
			CheckBoxMsg:  "Don't show me this again",
		}
		response, err := userinput.GetUserInput(ctx, request)
		if err != nil || !response.Confirm {
			return err
		}
		if response.CheckboxStat {
			meta := waveobj.MetaMapType{
				wconfig.ConfigKey_ConnAskBeforeWshInstall: false,
			}
			err := wconfig.SetBaseConfigValue(meta)
			if err != nil {
				return fmt.Errorf("error setting conn:askbeforewshinstall value: %w", err)
			}
		}
	}
	log.Printf("attempting to install wsh to `%s`", clientDisplayName)
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

func (conn *SSHConn) WaitForConnect(ctx context.Context) error {
	for {
		status := conn.DeriveConnStatus()
		if status.Status == Status_Connected {
			return nil
		}
		if status.Status == Status_Connecting {
			select {
			case <-ctx.Done():
				return fmt.Errorf("context timeout")
			case <-time.After(100 * time.Millisecond):
				continue
			}
		}
		if status.Status == Status_Init || status.Status == Status_Disconnected {
			return fmt.Errorf("disconnected")
		}
		if status.Status == Status_Error {
			return fmt.Errorf("error: %v", status.Error)
		}
		return fmt.Errorf("unknown status: %q", status.Status)
	}
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
	log.Printf("Connect %s\n", conn.GetName())
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
			conn.LastConnectTime = time.Now().UnixMilli()
			if conn.ActiveConnNum == 0 {
				conn.ActiveConnNum = int(activeConnCounter.Add(1))
			}
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
		log.Printf("error: failed to connect to client %s: %v\n", conn.GetName(), err)
		return err
	}
	fmtAddr := knownhosts.Normalize(fmt.Sprintf("%s@%s", client.User(), client.RemoteAddr().String()))
	clientDisplayName := fmt.Sprintf("%s (%s)", conn.GetName(), fmtAddr)
	conn.WithLock(func() {
		conn.Client = client
	})
	err = conn.OpenDomainSocketListener()
	if err != nil {
		log.Printf("error: unable to open domain socket listener for %s: %v\n", conn.GetName(), err)
		return err
	}
	config := wconfig.ReadFullConfig()
	installErr := conn.CheckAndInstallWsh(ctx, clientDisplayName, &WshInstallOpts{NoUserPrompt: !config.Settings.ConnAskBeforeWshInstall})
	if installErr != nil {
		log.Printf("error: unable to install wsh shell extensions for %s: %v\n", conn.GetName(), err)
		return fmt.Errorf("conncontroller %s wsh install error: %v", conn.GetName(), installErr)
	}
	csErr := conn.StartConnServer()
	if csErr != nil {
		log.Printf("error: unable to start conn server for %s: %v\n", conn.GetName(), csErr)
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
		// disconnects happen for a variety of reasons (like network, etc. and are typically transient)
		// so we just set the status to "disconnected" here (not error)
		// don't overwrite any existing error (or error status)
		if err != nil && conn.Error == "" {
			conn.Error = err.Error()
		}
		if conn.Status != Status_Error {
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

// Convenience function for ensuring a connection is established
func EnsureConnection(ctx context.Context, connName string) error {
	if connName == "" {
		return nil
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := GetConn(ctx, connOpts, false)
	if conn == nil {
		return fmt.Errorf("connection not found: %s", connName)
	}
	connStatus := conn.DeriveConnStatus()
	switch connStatus.Status {
	case Status_Connected:
		return nil
	case Status_Connecting:
		return conn.WaitForConnect(ctx)
	case Status_Init, Status_Disconnected:
		return conn.Connect(ctx)
	case Status_Error:
		return fmt.Errorf("connection error: %s", connStatus.Error)
	default:
		return fmt.Errorf("unknown connection status %q", connStatus.Status)
	}
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
				normalized := remote.NormalizeConfigPattern(hostPatternStr)
				if (!strings.Contains(hostPatternStr, "*") && !strings.Contains(hostPatternStr, "?") && !strings.Contains(hostPatternStr, "!")) || alreadyUsed[normalized] {
					discoveredPatterns = append(discoveredPatterns, normalized)
					alreadyUsed[normalized] = true
					break
				}
			}
		}
	}
	if len(errs) == len(configFiles) {
		errs = append([]error{fmt.Errorf("no ssh config files could be opened: ")}, errs...)
		return nil, errors.Join(errs...)
	}
	if len(discoveredPatterns) == 0 {
		return nil, fmt.Errorf("no compatible hostnames found in ssh config files")
	}

	return discoveredPatterns, nil
}

func GetConnectionsList() ([]string, error) {
	existing := GetAllConnStatus()
	var currentlyRunning []string
	var hasConnected []string

	// populate all lists
	for _, stat := range existing {
		if stat.Connected {
			currentlyRunning = append(currentlyRunning, stat.Connection)
		}

		if stat.HasConnected {
			hasConnected = append(hasConnected, stat.Connection)
		}
	}
	fromConfig, err := GetConnectionsFromConfig()
	if err != nil {
		return nil, err
	}

	// sort into one final list and remove duplicates
	alreadyUsed := make(map[string]struct{})
	var connList []string

	for _, subList := range [][]string{currentlyRunning, hasConnected, fromConfig} {
		for _, pattern := range subList {
			if _, used := alreadyUsed[pattern]; !used {
				connList = append(connList, pattern)
				alreadyUsed[pattern] = struct{}{}
			}
		}
	}

	return connList, nil
}

func GetConnectionsFromConfig() ([]string, error) {
	home := wavebase.GetHomeDir()
	localConfig := filepath.Join(home, ".ssh", "config")
	systemConfig := filepath.Join("/etc", "ssh", "config")
	sshConfigFiles := []string{localConfig, systemConfig}
	ssh_config.ReloadConfigs()

	return resolveSshConfigPatterns(sshConfigFiles)
}
