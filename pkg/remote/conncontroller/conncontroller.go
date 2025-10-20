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
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
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
	NoWshReason        string
	WshVersion         string
	HasWaiter          *atomic.Bool
	LastConnectTime    int64
	ActiveConnNum      int
}

var ConnServerCmdTemplate = strings.TrimSpace(
	strings.Join([]string{
		"%s version 2> /dev/null || (echo -n \"not-installed \"; uname -sm; exit 0);",
		"exec %s connserver",
	}, "\n"))

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
		Connection:    conn.Opts.String(),
		HasConnected:  (conn.LastConnectTime > 0),
		ActiveConnNum: conn.ActiveConnNum,
		Error:         conn.Error,
		WshEnabled:    conn.WshEnabled.Load(),
		WshError:      conn.WshError,
		NoWshReason:   conn.NoWshReason,
		WshVersion:    conn.WshVersion,
	}
}

func (conn *SSHConn) Infof(ctx context.Context, format string, args ...any) {
	log.Print(fmt.Sprintf("[conn:%s] ", conn.GetName()) + fmt.Sprintf(format, args...))
	blocklogger.Infof(ctx, "[conndebug] "+format, args...)
}

func (conn *SSHConn) Debugf(ctx context.Context, format string, args ...any) {
	blocklogger.Debugf(ctx, "[conndebug] "+format, args...)
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

// expects the output of `wsh version` which looks like `wsh v0.10.4` or "not-installed [os] [arch]"
// returns (up-to-date, semver, osArchStr, error)
// if not up to date, or error, version might be ""
func IsWshVersionUpToDate(logCtx context.Context, wshVersionLine string) (bool, string, string, error) {
	wshVersionLine = strings.TrimSpace(wshVersionLine)
	if strings.HasPrefix(wshVersionLine, "not-installed") {
		return false, "not-installed", strings.TrimSpace(strings.TrimPrefix(wshVersionLine, "not-installed")), nil
	}
	parts := strings.Fields(wshVersionLine)
	if len(parts) != 2 {
		return false, "", "", fmt.Errorf("unexpected version format: %s", wshVersionLine)
	}
	clientVersion := parts[1]
	expectedVersion := fmt.Sprintf("v%s", wavebase.WaveVersion)
	if semver.Compare(clientVersion, expectedVersion) < 0 {
		return false, clientVersion, "", nil
	}
	return true, clientVersion, "", nil
}

func (conn *SSHConn) getWshPath() string {
	config, ok := conn.getConnectionConfig()
	if ok && config.ConnWshPath != "" {
		return config.ConnWshPath
	}
	return wavebase.RemoteFullWshBinPath
}

func (conn *SSHConn) GetConfigShellPath() string {
	config, ok := conn.getConnectionConfig()
	if !ok {
		return ""
	}
	return config.ConnShellPath
}

// returns (needsInstall, clientVersion, osArchStr, error)
// if wsh is not installed, the clientVersion will be "not-installed", and it will also return an osArchStr
// if clientVersion is set, then no osArchStr will be returned
func (conn *SSHConn) StartConnServer(ctx context.Context, afterUpdate bool) (bool, string, string, error) {
	conn.Infof(ctx, "running StartConnServer...\n")
	allowed := WithLockRtn(conn, func() bool {
		return conn.Status == Status_Connecting
	})
	if !allowed {
		return false, "", "", fmt.Errorf("cannot start conn server for %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	client := conn.GetClient()
	wshPath := conn.getWshPath()
	rpcCtx := wshrpc.RpcContext{
		ClientType: wshrpc.ClientType_ConnServer,
		Conn:       conn.GetName(),
	}
	sockName := conn.GetDomainSocketName()
	jwtToken, err := wshutil.MakeClientJWTToken(rpcCtx, sockName)
	if err != nil {
		return false, "", "", fmt.Errorf("unable to create jwt token for conn controller: %w", err)
	}
	conn.Infof(ctx, "SSH-NEWSESSION (StartConnServer)\n")
	sshSession, err := client.NewSession()
	if err != nil {
		return false, "", "", fmt.Errorf("unable to create ssh session for conn controller: %w", err)
	}
	pipeRead, pipeWrite := io.Pipe()
	sshSession.Stdout = pipeWrite
	sshSession.Stderr = pipeWrite
	stdinPipe, err := sshSession.StdinPipe()
	if err != nil {
		return false, "", "", fmt.Errorf("unable to get stdin pipe: %w", err)
	}
	cmdStr := fmt.Sprintf(ConnServerCmdTemplate, wshPath, wshPath)
	log.Printf("starting conn controller: %q\n", cmdStr)
	shWrappedCmdStr := fmt.Sprintf("sh -c %s", shellutil.HardQuote(cmdStr))
	blocklogger.Debugf(ctx, "[conndebug] wrapped command:\n%s\n", shWrappedCmdStr)
	err = sshSession.Start(shWrappedCmdStr)
	if err != nil {
		return false, "", "", fmt.Errorf("unable to start conn controller command: %w", err)
	}
	linesChan := utilfn.StreamToLinesChan(pipeRead)
	versionLine, err := utilfn.ReadLineWithTimeout(linesChan, utilfn.TimeoutFromContext(ctx, 30*time.Second))
	if err != nil {
		sshSession.Close()
		return false, "", "", fmt.Errorf("error reading wsh version: %w", err)
	}
	conn.Infof(ctx, "actual connnserverversion: %q\n", versionLine)
	conn.Infof(ctx, "got connserver version: %s\n", strings.TrimSpace(versionLine))
	isUpToDate, clientVersion, osArchStr, err := IsWshVersionUpToDate(ctx, versionLine)
	if err != nil {
		sshSession.Close()
		return false, "", "", fmt.Errorf("error checking wsh version: %w", err)
	}
	if isUpToDate && !afterUpdate && os.Getenv(wavebase.WaveWshForceUpdateVarName) != "" {
		isUpToDate = false
		conn.Infof(ctx, "%s set, forcing wsh update\n", wavebase.WaveWshForceUpdateVarName)
	}
	conn.Infof(ctx, "connserver up-to-date: %v\n", isUpToDate)
	if !isUpToDate {
		sshSession.Close()
		return true, clientVersion, osArchStr, nil
	}
	jwtLine, err := utilfn.ReadLineWithTimeout(linesChan, 3*time.Second)
	if err != nil {
		sshSession.Close()
		return false, clientVersion, "", fmt.Errorf("error reading jwt status line: %w", err)
	}
	conn.Infof(ctx, "got jwt status line: %s\n", jwtLine)
	if strings.TrimSpace(jwtLine) == wavebase.NeedJwtConst {
		// write the jwt
		conn.Infof(ctx, "writing jwt token to connserver\n")
		_, err = fmt.Fprintf(stdinPipe, "%s\n", jwtToken)
		if err != nil {
			sshSession.Close()
			return false, clientVersion, "", fmt.Errorf("failed to write JWT token: %w", err)
		}
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
		var waitErr error
		defer conn.WithLock(func() {
			if conn.ConnController != nil {
				conn.WshEnabled.Store(false)
				conn.NoWshReason = "connserver terminated"
				if waitErr != nil {
					conn.WshError = fmt.Sprintf("connserver terminated unexpectedly with error: %v", waitErr)
				}
			}
			conn.ConnController = nil
		})
		waitErr = sshSession.Wait()
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
		return false, clientVersion, "", fmt.Errorf("timeout waiting for connserver to register")
	}
	time.Sleep(300 * time.Millisecond) // TODO remove this sleep (but we need to wait until connserver is "ready")
	conn.Infof(ctx, "connserver is registered and ready\n")
	return false, clientVersion, "", nil
}

type WshInstallOpts struct {
	Force        bool
	NoUserPrompt bool
}

var queryTextTemplate = strings.TrimSpace(`
Wave requires Wave Shell Extensions to be
installed on %q
to ensure a seamless experience.

Would you like to install them?
`)

func (conn *SSHConn) UpdateWsh(ctx context.Context, clientDisplayName string, remoteInfo *wshrpc.RemoteInfo) error {
	conn.Infof(ctx, "attempting to update wsh for connection %s (os:%s arch:%s version:%s)\n",
		conn.GetName(), remoteInfo.ClientOs, remoteInfo.ClientArch, remoteInfo.ClientVersion)
	client := conn.GetClient()
	if client == nil {
		return fmt.Errorf("cannot update wsh: ssh client is not connected")
	}
	err := remote.CpWshToRemote(ctx, client, remoteInfo.ClientOs, remoteInfo.ClientArch)
	if err != nil {
		return fmt.Errorf("error installing wsh to remote: %w", err)
	}
	conn.Infof(ctx, "successfully updated wsh on %s\n", conn.GetName())
	return nil

}

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

func (conn *SSHConn) InstallWsh(ctx context.Context, osArchStr string) error {
	conn.Infof(ctx, "running installWsh...\n")
	client := conn.GetClient()
	if client == nil {
		conn.Infof(ctx, "ERROR ssh client is not connected, cannot install\n")
		return fmt.Errorf("ssh client is not connected, cannot install")
	}
	var clientOs, clientArch string
	var err error
	if osArchStr != "" {
		clientOs, clientArch, err = remote.GetClientPlatformFromOsArchStr(ctx, osArchStr)
	} else {
		clientOs, clientArch, err = remote.GetClientPlatform(ctx, genconn.MakeSSHShellClient(client))
	}
	if err != nil {
		conn.Infof(ctx, "ERROR detecting client platform: %v\n", err)
	}
	conn.Infof(ctx, "detected remote platform os:%s arch:%s\n", clientOs, clientArch)
	err = remote.CpWshToRemote(ctx, client, clientOs, clientArch)
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
func (conn *SSHConn) Connect(ctx context.Context, connFlags *wconfig.ConnKeywords) error {
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
		conn.Infof(ctx, "cannot connect to %q when status is %q\n", conn.GetName(), conn.GetStatus())
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
			telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
				Event: "conn:connecterror",
				Props: telemetrydata.TEventProps{
					ConnType: "ssh",
				},
			})
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
			telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
				Event: "conn:connect",
				Props: telemetrydata.TEventProps{
					ConnType: "ssh",
				},
			})
		}
	})
	conn.FireConnChangeEvent()
	if err != nil {
		return err
	}

	// logic for saving connection and potential flags (we only save once a connection has been made successfully)
	// at the moment, identity files is the only saved flag
	var identityFiles []string
	existingConnection, ok := conn.getConnectionConfig()
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
	connSettings, ok := conn.getConnectionConfig()
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

type WshCheckResult struct {
	WshEnabled    bool
	ClientVersion string
	NoWshReason   string
	WshError      error
}

// returns (wsh-enabled, clientVersion, text-reason, wshError)
func (conn *SSHConn) tryEnableWsh(ctx context.Context, clientDisplayName string) WshCheckResult {
	conn.Infof(ctx, "running tryEnableWsh...\n")
	enableWsh, askBeforeInstall := conn.getConnWshSettings()
	conn.Infof(ctx, "wsh settings enable:%v ask:%v\n", enableWsh, askBeforeInstall)
	if !enableWsh {
		return WshCheckResult{NoWshReason: "conn:wshenabled set to false"}
	}
	if askBeforeInstall {
		allowInstall, err := conn.getPermissionToInstallWsh(ctx, clientDisplayName)
		if err != nil {
			log.Printf("error getting permission to install wsh: %v\n", err)
			return WshCheckResult{NoWshReason: "error getting user permission to install", WshError: err}
		}
		if !allowInstall {
			return WshCheckResult{NoWshReason: "user selected not to install wsh extensions"}
		}
	}
	err := conn.OpenDomainSocketListener(ctx)
	if err != nil {
		conn.Infof(ctx, "ERROR opening domain socket listener: %v\n", err)
		err = fmt.Errorf("error opening domain socket listener: %w", err)
		return WshCheckResult{NoWshReason: "error opening domain socket", WshError: err}
	}
	needsInstall, clientVersion, osArchStr, err := conn.StartConnServer(ctx, false)
	if err != nil {
		conn.Infof(ctx, "ERROR starting conn server: %v\n", err)
		err = fmt.Errorf("error starting conn server: %w", err)
		return WshCheckResult{NoWshReason: "error starting connserver", WshError: err}
	}
	if needsInstall {
		conn.Infof(ctx, "connserver needs to be (re)installed\n")
		err = conn.InstallWsh(ctx, osArchStr)
		if err != nil {
			conn.Infof(ctx, "ERROR installing wsh: %v\n", err)
			err = fmt.Errorf("error installing wsh: %w", err)
			return WshCheckResult{NoWshReason: "error installing wsh/connserver", WshError: err}
		}
		needsInstall, clientVersion, _, err = conn.StartConnServer(ctx, true)
		if err != nil {
			conn.Infof(ctx, "ERROR starting conn server (after install): %v\n", err)
			err = fmt.Errorf("error starting conn server (after install): %w", err)
			return WshCheckResult{NoWshReason: "error starting connserver", WshError: err}
		}
		if needsInstall {
			conn.Infof(ctx, "conn server not installed correctly (after install)\n")
			err = fmt.Errorf("conn server not installed correctly (after install)")
			return WshCheckResult{NoWshReason: "connserver not installed properly", WshError: err}
		}
		return WshCheckResult{WshEnabled: true, ClientVersion: clientVersion}
	} else {
		return WshCheckResult{WshEnabled: true, ClientVersion: clientVersion}
	}
}

func (conn *SSHConn) getConnectionConfig() (wconfig.ConnKeywords, bool) {
	config := wconfig.GetWatcher().GetFullConfig()
	connSettings, ok := config.Connections[conn.GetName()]
	if !ok {
		return wconfig.ConnKeywords{}, false
	}
	return connSettings, true
}

func (conn *SSHConn) persistWshInstalled(ctx context.Context, result WshCheckResult) {
	conn.WshEnabled.Store(result.WshEnabled)
	conn.SetWshError(result.WshError)
	conn.WithLock(func() {
		conn.NoWshReason = result.NoWshReason
		conn.WshVersion = result.ClientVersion
	})
	connConfig, ok := conn.getConnectionConfig()
	if ok && connConfig.ConnWshEnabled != nil {
		return
	}
	meta := make(map[string]any)
	meta["conn:wshenabled"] = result.WshEnabled
	err := wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
	if err != nil {
		conn.Infof(ctx, "WARN could not write conn:wshenabled=%v to connections.json: %v\n", result.WshEnabled, err)
		log.Printf("warning: error writing to connections file: %v", err)
	}
	// doesn't return an error since none of this is required for connection to work
}

// returns (connect-error)
func (conn *SSHConn) connectInternal(ctx context.Context, connFlags *wconfig.ConnKeywords) error {
	conn.Infof(ctx, "connectInternal %s\n", conn.GetName())
	client, _, err := remote.ConnectToClient(ctx, conn.Opts, nil, 0, connFlags)
	if err != nil {
		conn.Infof(ctx, "ERROR ConnectToClient: %s\n", remote.SimpleMessageFromPossibleConnectionError(err))
		log.Printf("error: failed to connect to client %s: %s\n", conn.GetName(), err)
		return err
	}
	conn.WithLock(func() {
		conn.Client = client
	})
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:waitForDisconnect", recover())
		}()
		conn.waitForDisconnect()
	}()
	fmtAddr := knownhosts.Normalize(fmt.Sprintf("%s@%s", client.User(), client.RemoteAddr().String()))
	conn.Infof(ctx, "normalized knownhosts address: %s\n", fmtAddr)
	clientDisplayName := fmt.Sprintf("%s (%s)", conn.GetName(), fmtAddr)
	wshResult := conn.tryEnableWsh(ctx, clientDisplayName)
	if !wshResult.WshEnabled {
		if wshResult.WshError != nil {
			conn.Infof(ctx, "ERROR enabling wsh: %v\n", wshResult.WshError)
			conn.Infof(ctx, "will connect with wsh disabled\n")
		} else {
			conn.Infof(ctx, "wsh not enabled: %s\n", wshResult.NoWshReason)
		}
	}
	conn.persistWshInstalled(ctx, wshResult)
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

func (conn *SSHConn) SetWshError(err error) {
	conn.WithLock(func() {
		if err == nil {
			conn.WshError = ""
		} else {
			conn.WshError = err.Error()
		}
	})
}

func (conn *SSHConn) ClearWshError() {
	conn.WithLock(func() {
		conn.WshError = ""
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

// does NOT connect, can return nil if connection does not exist
func GetConn(opts *remote.SSHOpts) *SSHConn {
	conn := getConnInternal(opts)
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
	conn := GetConn(connOpts)
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
		return conn.Connect(ctx, &wconfig.ConnKeywords{})
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
				if hostPatternStr == "" || strings.Contains(hostPatternStr, "*") || strings.Contains(hostPatternStr, "?") || strings.Contains(hostPatternStr, "!") {
					continue
				}
				normalized := remote.NormalizeConfigPattern(hostPatternStr)
				if !alreadyUsed[normalized] {
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
