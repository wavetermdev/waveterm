// Copyright 2025, Command Line Inc.
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
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"golang.org/x/crypto/ssh"
	"golang.org/x/mod/semver"
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
	WshEnabled         *atomic.Bool
	Opts               *remote.SSHOpts
	Client             *ssh.Client
	DomainSockName     string // if "", then no domain socket
	DomainSockListener net.Listener
	ConnController     *ssh.Session
	Error              string
	WshError           string
	HasWaiter          *atomic.Bool
	LastConnectTime    int64
	ActiveConnNum      int
}

var ConnServerCmdTemplate = strings.TrimSpace(`
%s version || echo "not-installed"
read jwt_token
WAVETERM_JWT="$jwt_token" %s connserver
`)

func GetAllConnStatus() []wshrpc.ConnStatus {
	globalLock.Lock()
	defer globalLock.Unlock()

	var connStatuses []wshrpc.ConnStatus
	for _, conn := range clientControllerMap {
		connStatuses = append(connStatuses, conn.DeriveConnStatus())
	}
	return connStatuses
}

func GetNumSSHHasConnected() int {
	globalLock.Lock()
	defer globalLock.Unlock()

	var numConnected int
	for _, conn := range clientControllerMap {
		if conn.LastConnectTime > 0 {
			numConnected++
		}
	}
	return numConnected
}

func (conn *SSHConn) DeriveConnStatus() wshrpc.ConnStatus {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return wshrpc.ConnStatus{
		Status:        conn.Status,
		Connected:     conn.Status == Status_Connected,
		WshEnabled:    conn.WshEnabled.Load(),
		Connection:    conn.Opts.String(),
		HasConnected:  (conn.LastConnectTime > 0),
		ActiveConnNum: conn.ActiveConnNum,
		Error:         conn.Error,
		WshError:      conn.WshError,
	}
}

func (conn *SSHConn) Infof(ctx context.Context, format string, args ...any) {
	log.Print(fmt.Sprintf("[conn:%s] ", conn.GetName()) + fmt.Sprintf(format, args...))
	blocklogger.Infof(ctx, "[conndebug] "+format, args...)
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
		conn.DomainSockName = ""
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
	return conn.DomainSockName
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

func (conn *SSHConn) OpenDomainSocketListener(ctx context.Context) error {
	conn.Infof(ctx, "running OpenDomainSocketListener...\n")
	allowed := WithLockRtn(conn, func() bool {
		return conn.Status == Status_Connecting
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
	conn.Infof(ctx, "generated domain socket name %s\n", sockName)
	listener, err := client.ListenUnix(sockName)
	if err != nil {
		return fmt.Errorf("unable to request connection domain socket: %v", err)
	}
	conn.WithLock(func() {
		conn.DomainSockName = sockName
		conn.DomainSockListener = listener
	})
	conn.Infof(ctx, "successfully connected domain socket\n")
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:OpenDomainSocketListener", recover())
		}()
		defer conn.WithLock(func() {
			conn.DomainSockListener = nil
			conn.DomainSockName = ""
		})
		wshutil.RunWshRpcOverListener(listener)
	}()
	return nil
}

// expects the output of `wsh version` which looks like `wsh v0.10.4` or "not-installed"
func isWshVersionUpToDate(wshVersionLine string) (bool, error) {
	wshVersionLine = strings.TrimSpace(wshVersionLine)
	if wshVersionLine == "not-installed" {
		return false, nil
	}
	parts := strings.Fields(wshVersionLine)
	if len(parts) != 2 {
		return false, fmt.Errorf("unexpected version format: %s", wshVersionLine)
	}
	clientVersion := parts[1]
	expectedVersion := fmt.Sprintf("v%s", wavebase.WaveVersion)
	if semver.Compare(clientVersion, expectedVersion) < 0 {
		return false, nil
	}
	return true, nil
}

// returns (needsInstall, error)
func (conn *SSHConn) StartConnServer(ctx context.Context) (bool, error) {
	conn.Infof(ctx, "running StartConnServer...\n")
	allowed := WithLockRtn(conn, func() bool {
		return conn.Status == Status_Connecting
	})
	if !allowed {
		return false, fmt.Errorf("cannot start conn server for %q when status is %q", conn.GetName(), conn.GetStatus())
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
		return false, fmt.Errorf("unable to create jwt token for conn controller: %w", err)
	}
	sshSession, err := client.NewSession()
	if err != nil {
		return false, fmt.Errorf("unable to create ssh session for conn controller: %w", err)
	}
	pipeRead, pipeWrite := io.Pipe()
	sshSession.Stdout = pipeWrite
	sshSession.Stderr = pipeWrite
	stdinPipe, err := sshSession.StdinPipe()
	if err != nil {
		return false, fmt.Errorf("unable to get stdin pipe: %w", err)
	}
	cmdStr := fmt.Sprintf(ConnServerCmdTemplate, wshPath, wshPath)
	log.Printf("starting conn controller: %s\n", cmdStr)
	shWrappedCmdStr := fmt.Sprintf("sh -c %s", genconn.HardQuote(cmdStr))
	err = sshSession.Start(shWrappedCmdStr)
	if err != nil {
		return false, fmt.Errorf("unable to start conn controller command: %w", err)
	}
	linesChan := wshutil.StreamToLinesChan(pipeRead)
	versionLine, err := wshutil.ReadLineWithTimeout(linesChan, 2*time.Second)
	if err != nil {
		sshSession.Close()
		return false, fmt.Errorf("error reading wsh version: %w", err)
	}
	conn.Infof(ctx, "got connserver version: %s\n", strings.TrimSpace(versionLine))
	isUpToDate, err := isWshVersionUpToDate(versionLine)
	if err != nil {
		sshSession.Close()
		return false, fmt.Errorf("error checking wsh version: %w", err)
	}
	conn.Infof(ctx, "connserver update to date: %v\n", isUpToDate)
	if !isUpToDate {
		sshSession.Close()
		return true, nil
	}
	// write the jwt
	conn.Infof(ctx, "writing jwt token to connserver\n")
	_, err = fmt.Fprintf(stdinPipe, "%s\n", jwtToken)
	if err != nil {
		sshSession.Close()
		return false, fmt.Errorf("failed to write JWT token: %w", err)
	}
	conn.WithLock(func() {
		conn.ConnController = sshSession
	})
	// service the I/O
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:sshSession.Wait", recover())
		}()
		// wait for termination, clear the controller
		defer conn.WithLock(func() {
			conn.ConnController = nil
		})
		waitErr := sshSession.Wait()
		log.Printf("conn controller (%q) terminated: %v", conn.GetName(), waitErr)
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:sshSession-output", recover())
		}()
		for output := range linesChan {
			if output.Error != nil {
				log.Printf("[conncontroller:%s:output] error: %v\n", conn.GetName(), output.Error)
				continue
			}
			line := output.Line
			if !strings.HasSuffix(line, "\n") {
				line += "\n"
			}
			log.Printf("[conncontroller:%s:output] %s", conn.GetName(), line)
		}
	}()
	conn.Infof(ctx, "connserver started, waiting for route to be registered\n")
	regCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	err = wshutil.DefaultRouter.WaitForRegister(regCtx, wshutil.MakeConnectionRouteId(rpcCtx.Conn))
	if err != nil {
		return false, fmt.Errorf("timeout waiting for connserver to register")
	}
	time.Sleep(300 * time.Millisecond) // TODO remove this sleep (but we need to wait until connserver is "ready")
	conn.Infof(ctx, "connserver is registered and ready\n")
	return false, nil
}

type WshInstallOpts struct {
	Force        bool
	NoUserPrompt bool
}

type WshInstallSkipError struct{}

func (wise *WshInstallSkipError) Error() string {
	return "skipping wsh installation"
}

var queryTextTemplate = strings.TrimSpace(`
Wave requires Wave Shell Extensions to be
installed on %q
to ensure a seamless experience.

Would you like to install them?
`)

// returns (allowed, error)
func (conn *SSHConn) getPermissionToInstallWsh(ctx context.Context, clientDisplayName string) (bool, error) {
	conn.Infof(ctx, "running getPermissionToInstallWsh...\n")
	queryText := fmt.Sprintf(queryTextTemplate, clientDisplayName)
	title := "Install Wave Shell Extensions"
	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Title:        title,
		Markdown:     true,
		CheckBoxMsg:  "Automatically install for all connections",
		OkLabel:      "Install wsh",
		CancelLabel:  "No wsh",
	}
	conn.Infof(ctx, "requesting user confirmation...\n")
	response, err := userinput.GetUserInput(ctx, request)
	if err != nil {
		conn.Infof(ctx, "error getting user input: %v\n", err)
		return false, err
	}
	conn.Infof(ctx, "user response to allowing wsh: %v\n", response.Confirm)
	meta := make(map[string]any)
	meta["conn:wshenabled"] = response.Confirm
	conn.Infof(ctx, "writing conn:wshenabled=%v to connections.json\n", response.Confirm)
	err = wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
	if err != nil {
		log.Printf("warning: error writing to connections file: %v", err)
	}
	if !response.Confirm {
		return false, nil
	}
	if response.CheckboxStat {
		conn.Infof(ctx, "writing conn:askbeforewshinstall=false to settings.json\n")
		meta := waveobj.MetaMapType{
			wconfig.ConfigKey_ConnAskBeforeWshInstall: false,
		}
		setConfigErr := wconfig.SetBaseConfigValue(meta)
		if setConfigErr != nil {
			// this is not a critical error, just log and continue
			log.Printf("warning: error writing to base config file: %v", err)
		}
	}
	return true, nil
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
	expectedVersion := fmt.Sprintf("v%s", wavebase.WaveVersion)
	clientVersion, err := remote.GetWshVersion(client)
	if err == nil && !opts.Force && semver.Compare(clientVersion, expectedVersion) >= 0 {
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
			CheckBoxMsg:  "Automatically install for all connections",
			OkLabel:      "Install wsh",
			CancelLabel:  "No wsh",
		}
		response, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			return err
		}
		if !response.Confirm {
			meta := make(map[string]any)
			meta["conn:wshenabled"] = false
			err = wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
			if err != nil {
				log.Printf("warning: error writing to connections file: %v", err)
			}
			return &WshInstallSkipError{}
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
	err = conn.installWsh(ctx)
	if err != nil {
		return err
	}
	return nil
}

func (conn *SSHConn) installWsh(ctx context.Context) error {
	conn.Infof(ctx, "running installWsh...\n")
	clientOs, clientArch, err := remote.GetClientPlatform(ctx, genconn.MakeSSHShellClient(conn.GetClient()))
	if err != nil {
		conn.Infof(ctx, "ERROR detecting client platform: %v\n", err)
		return err
	}
	conn.Infof(ctx, "detected remote platform os:%s arch:%s\n", clientOs, clientArch)
	err = remote.CpWshToRemote(ctx, conn.GetClient(), clientOs, clientArch)
	if err != nil {
		conn.Infof(ctx, "ERROR copying wsh binary to remote: %v\n", err)
		return fmt.Errorf("error copying wsh binary to remote: %w", err)
	}
	conn.Infof(ctx, "successfully installed wsh\n")
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
	return conn.Connect(ctx, &wshrpc.ConnKeywords{})
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
func (conn *SSHConn) Connect(ctx context.Context, connFlags *wshrpc.ConnKeywords) error {
	blocklogger.Infof(ctx, "\n")
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
		conn.Infof(ctx, "cannot connect to when status is %q\n", conn.GetStatus())
		return fmt.Errorf("cannot connect to %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	conn.Infof(ctx, "trying to connect to %q...\n", conn.GetName())
	conn.FireConnChangeEvent()
	err := conn.connectInternal(ctx, connFlags)
	conn.WithLock(func() {
		if err != nil {
			conn.Infof(ctx, "ERROR %v\n\n", err)
			conn.Status = Status_Error
			conn.Error = err.Error()
			conn.close_nolock()
			telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{
				Conn: map[string]int{"ssh:connecterror": 1},
			}, "ssh-connconnect")
		} else {
			conn.Infof(ctx, "successfully connected (wsh:%v)\n\n", conn.WshEnabled.Load())
			conn.Status = Status_Connected
			conn.LastConnectTime = time.Now().UnixMilli()
			if conn.ActiveConnNum == 0 {
				conn.ActiveConnNum = int(activeConnCounter.Add(1))
			}
			telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{
				Conn: map[string]int{"ssh:connect": 1},
			}, "ssh-connconnect")
		}
	})
	conn.FireConnChangeEvent()
	if err != nil {
		return err
	}

	// logic for saving connection and potential flags (we only save once a connection has been made successfully)
	// at the moment, identity files is the only saved flag
	var identityFiles []string
	existingConfig := wconfig.GetWatcher().GetFullConfig()
	existingConnection, ok := existingConfig.Connections[conn.GetName()]
	if ok {
		identityFiles = existingConnection.SshIdentityFile
	}
	if err != nil {
		// i do not consider this a critical failure
		log.Printf("config read error: unable to save connection %s: %v", conn.GetName(), err)
	}

	meta := make(map[string]any)
	if connFlags.SshIdentityFile != nil {
		for _, identityFile := range connFlags.SshIdentityFile {
			if utilfn.ContainsStr(identityFiles, identityFile) {
				continue
			}
			identityFiles = append(identityFiles, connFlags.SshIdentityFile...)
		}
		meta["ssh:identityfile"] = identityFiles
	}
	err = wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
	if err != nil {
		// i do not consider this a critical failure
		log.Printf("config write error: unable to save connection %s: %v", conn.GetName(), err)
	}
	return nil
}

func (conn *SSHConn) WithLock(fn func()) {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	fn()
}

func WithLockRtn[T any](conn *SSHConn, fn func() T) T {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return fn()
}

// returns (enable-wsh, ask-before-install)
func (conn *SSHConn) getConnWshSettings() (bool, bool) {
	config := wconfig.GetWatcher().GetFullConfig()
	enableWsh := config.Settings.ConnWshEnabled
	askBeforeInstall := wconfig.DefaultBoolPtr(config.Settings.ConnAskBeforeWshInstall, true)
	connSettings, ok := config.Connections[conn.GetName()]
	if ok {
		if connSettings.ConnWshEnabled != nil {
			enableWsh = *connSettings.ConnWshEnabled
		}
		// if the connection object exists, and conn:askbeforewshinstall is not set, the user must have allowed it
		// TODO: in v0.12+ this should be removed.  we'll explicitly write a "false" into the connection object on successful connection
		if connSettings.ConnAskBeforeWshInstall == nil {
			askBeforeInstall = false
		} else {
			askBeforeInstall = *connSettings.ConnAskBeforeWshInstall
		}
	}
	return enableWsh, askBeforeInstall
}

func (conn *SSHConn) tryEnableWsh(ctx context.Context, clientDisplayName string) (bool, error) {
	conn.Infof(ctx, "running tryEnableWsh...\n")
	enableWsh, askBeforeInstall := conn.getConnWshSettings()
	conn.Infof(ctx, "wsh settings enable:%v ask:%v\n", enableWsh, askBeforeInstall)
	if !enableWsh {
		return false, nil
	}
	if askBeforeInstall {
		allowInstall, err := conn.getPermissionToInstallWsh(ctx, clientDisplayName)
		if err != nil {
			log.Printf("error getting permission to install wsh: %v\n", err)
			return false, err
		}
		if !allowInstall {
			return false, nil
		}
	}
	// TODO make sure installed
	err := conn.OpenDomainSocketListener(ctx)
	if err != nil {
		conn.Infof(ctx, "ERROR opening domain socket listener: %v\n", err)
		return false, fmt.Errorf("error opening domain socket listener: %w", err)
	}
	needsInstall, err := conn.StartConnServer(ctx)
	if err != nil {
		conn.Infof(ctx, "ERROR starting conn server: %v\n", err)
		return false, fmt.Errorf("error starting conn server: %w", err)
	}
	if needsInstall {
		conn.Infof(ctx, "connserver needs to be (re)installed\n")
		err = conn.installWsh(ctx)
		if err != nil {
			conn.Infof(ctx, "ERROR installing wsh: %v\n", err)
			return false, fmt.Errorf("error installing wsh: %w", err)
		}
		needsInstall, err = conn.StartConnServer(ctx)
		if err != nil {
			conn.Infof(ctx, "ERROR starting conn server (after install): %v\n", err)
			return false, fmt.Errorf("error starting conn server (after install): %w", err)
		}
		if needsInstall {
			conn.Infof(ctx, "conn server not installed correctly (after install)\n")
			return false, fmt.Errorf("conn server not installed correctly (after install)")
		}
	}
	return true, nil
}

func (conn *SSHConn) persistWshInstalled(ctx context.Context, wshEnabled bool) {
	conn.WshEnabled.Store(wshEnabled)
	config := wconfig.GetWatcher().GetFullConfig()
	connSettings, ok := config.Connections[conn.GetName()]
	if ok && connSettings.ConnWshEnabled != nil {
		return
	}
	meta := make(map[string]any)
	meta["conn:wshenabled"] = wshEnabled
	err := wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
	if err != nil {
		conn.Infof(ctx, "WARN could not write conn:wshenabled=%v to connections.json: %v\n", wshEnabled, err)
		log.Printf("warning: error writing to connections file: %v", err)
	}
	// doesn't return an error since none of this is required for connection to work
}

func (conn *SSHConn) connectInternal(ctx context.Context, connFlags *wshrpc.ConnKeywords) error {
	conn.Infof(ctx, "connectInternal %s\n", conn.GetName())
	client, _, err := remote.ConnectToClient(ctx, conn.Opts, nil, 0, connFlags)
	if err != nil {
		log.Printf("error: failed to connect to client %s: %s\n", conn.GetName(), err)
		return err
	}
	conn.WithLock(func() {
		conn.Client = client
	})
	go conn.waitForDisconnect()
	fmtAddr := knownhosts.Normalize(fmt.Sprintf("%s@%s", client.User(), client.RemoteAddr().String()))
	conn.Infof(ctx, "normalized knownhosts address: %s\n", fmtAddr)
	clientDisplayName := fmt.Sprintf("%s (%s)", conn.GetName(), fmtAddr)
	wshInstalled, enableErr := conn.tryEnableWsh(ctx, clientDisplayName)
	if enableErr != nil {
		conn.Infof(ctx, "ERROR enabling wsh: %v\n", enableErr)
		conn.Infof(ctx, "will connect with wsh disabled\n")
	}
	conn.persistWshInstalled(ctx, wshInstalled)
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
		rtn = &SSHConn{Lock: &sync.Mutex{}, Status: Status_Init, WshEnabled: &atomic.Bool{}, Opts: opts, HasWaiter: &atomic.Bool{}}
		clientControllerMap[*opts] = rtn
	}
	return rtn
}

func GetConn(ctx context.Context, opts *remote.SSHOpts, shouldConnect bool, connFlags *wshrpc.ConnKeywords) *SSHConn {
	conn := getConnInternal(opts)
	if conn.Client == nil && shouldConnect {
		conn.Connect(ctx, connFlags)
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
	conn := GetConn(ctx, connOpts, false, &wshrpc.ConnKeywords{})
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
		return conn.Connect(ctx, &wshrpc.ConnKeywords{})
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

		cfg, _ := ssh_config.Decode(fd, true)
		for _, host := range cfg.Hosts {
			// for each host, find the first good alias
			for _, hostPattern := range host.Patterns {
				hostPatternStr := hostPattern.String()
				normalized := remote.NormalizeConfigPattern(hostPatternStr)
				if !strings.Contains(hostPatternStr, "*") && !strings.Contains(hostPatternStr, "?") && !strings.Contains(hostPatternStr, "!") && !alreadyUsed[normalized] {
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

	fromInternal := GetConnectionsFromInternalConfig()

	fromConfig, err := GetConnectionsFromConfig()
	if err != nil {
		// this is not a fatal error. do not return
		log.Printf("warning: no connections from ssh config found: %v", err)
	}

	// sort into one final list and remove duplicates
	alreadyUsed := make(map[string]struct{})
	var connList []string

	for _, subList := range [][]string{currentlyRunning, hasConnected, fromInternal, fromConfig} {
		for _, pattern := range subList {
			if _, used := alreadyUsed[pattern]; !used {
				connList = append(connList, pattern)
				alreadyUsed[pattern] = struct{}{}
			}
		}
	}

	return connList, nil
}

func GetConnectionsFromInternalConfig() []string {
	var internalNames []string
	config := wconfig.GetWatcher().GetFullConfig()
	for internalName := range config.Connections {
		if strings.HasPrefix(internalName, "wsl://") {
			// don't add wsl conns to this list
			continue
		}
		internalNames = append(internalNames, internalName)
	}
	return internalNames
}

func GetConnectionsFromConfig() ([]string, error) {
	home := wavebase.GetHomeDir()
	localConfig := filepath.Join(home, ".ssh", "config")
	systemConfig := filepath.Join("/etc", "ssh", "config")
	sshConfigFiles := []string{localConfig, systemConfig}
	remote.WaveSshConfigUserSettings().ReloadConfigs()

	return resolveSshConfigPatterns(sshConfigFiles)
}
