// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wslconn

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
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
	"github.com/wavetermdev/waveterm/pkg/wsl"
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
var clientControllerMap = make(map[string]*WslConn)
var activeConnCounter = &atomic.Int32{}

type WslConn struct {
	Lock               *sync.Mutex
	Status             string
	WshEnabled         *atomic.Bool
	Name               wsl.WslName
	Client             *wsl.Distro
	DomainSockName     string // if "", then no domain socket
	DomainSockListener net.Listener
	ConnController     *wsl.WslCmd
	Error              string
	WshError           string
	NoWshReason        string
	WshVersion         string
	HasWaiter          *atomic.Bool
	LastConnectTime    int64
	ActiveConnNum      int
	cancelFn           func()
}

var ConnServerCmdTemplate = strings.TrimSpace(
	strings.Join([]string{
		"%s version 2> /dev/null || (echo -n \"not-installed \"; uname -sm);",
		"exec %s connserver --router --conn %s %s",
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

func GetNumWSLHasConnected() int {
	globalLock.Lock()
	defer globalLock.Unlock()

	var connectedCount int
	for _, conn := range clientControllerMap {
		if conn.LastConnectTime > 0 {
			connectedCount++
		}
	}
	return connectedCount
}

func (conn *WslConn) DeriveConnStatus() wshrpc.ConnStatus {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return wshrpc.ConnStatus{
		Status:        conn.Status,
		Connected:     conn.Status == Status_Connected,
		WshEnabled:    conn.WshEnabled.Load(),
		Connection:    conn.GetName(),
		HasConnected:  (conn.LastConnectTime > 0),
		ActiveConnNum: conn.ActiveConnNum,
		Error:         conn.Error,
		WshError:      conn.WshError,
		NoWshReason:   conn.NoWshReason,
		WshVersion:    conn.WshVersion,
	}
}

func (conn *WslConn) Infof(ctx context.Context, format string, args ...any) {
	log.Print(fmt.Sprintf("[conn:%s] ", conn.GetName()) + fmt.Sprintf(format, args...))
	blocklogger.Infof(ctx, "[conndebug] "+format, args...)
}

func (conn *WslConn) Debugf(ctx context.Context, format string, args ...any) {
	blocklogger.Infof(ctx, "[conndebug] "+format, args...)
}

func (conn *WslConn) FireConnChangeEvent() {
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

func (conn *WslConn) Close() error {
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

func (conn *WslConn) close_nolock() {
	// does not set status (that should happen at another level)
	if conn.DomainSockListener != nil {
		conn.DomainSockListener.Close()
		conn.DomainSockListener = nil
		conn.DomainSockName = ""
	}
	if conn.ConnController != nil {
		conn.cancelFn() // this suspends the conn controller
		conn.ConnController = nil
	}
	if conn.Client != nil {
		// conn.Client.Close() is not relevant here
		// we do not want to completely close the wsl in case
		// other applications are using it
		conn.Client = nil
	}
}

func (conn *WslConn) GetDomainSocketName() string {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.DomainSockName
}

func (conn *WslConn) GetStatus() string {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.Status
}

func (conn *WslConn) GetName() string {
	// no lock required because opts is immutable
	return "wsl://" + conn.Name.Distro
}

/**
 * This function is does not set a listener for WslConn
 * It is still required in order to set SockName
**/
func (conn *WslConn) OpenDomainSocketListener(ctx context.Context) error {
	conn.Infof(ctx, "running OpenDomainSocketListener...\n")
	allowed := WithLockRtn(conn, func() bool {
		return conn.Status == Status_Connecting
	})
	if !allowed {
		return fmt.Errorf("cannot open domain socket for %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	/*
		listener, err := client.ListenUnix(sockName)
		if err != nil {
			return fmt.Errorf("unable to request connection domain socket: %v", err)
		}
	*/
	conn.Infof(ctx, "setting domain socket to %s\n", wavebase.RemoteFullDomainSocketPath)
	conn.WithLock(func() {
		conn.DomainSockName = wavebase.RemoteFullDomainSocketPath
		//conn.DomainSockListener = listener
	})
	conn.Infof(ctx, "successfully connected domain socket\n")
	/*
		go func() {
			defer func() {
				panichandler.PanicHandler("wslconn:OpenDomainSocketListener", recover())
			}()
			defer conn.WithLock(func() {
				conn.DomainSockListener = nil
				conn.DomainSockName = ""
			})
			wshutil.RunWshRpcOverListener(listener)
		}()
	*/
	return nil
}

func (conn *WslConn) getWshPath() string {
	config, ok := conn.getConnectionConfig()
	if ok && config.ConnWshPath != "" {
		return config.ConnWshPath
	}
	return wavebase.RemoteFullWshBinPath
}

func (conn *WslConn) GetConfigShellPath() string {
	config, ok := conn.getConnectionConfig()
	if !ok {
		return ""
	}
	return config.ConnShellPath
}

// returns (needsInstall, clientVersion, osArchStr, error)
// if wsh is not installed, the clientVersion will be "not-installed", and it will also return an osArchStr
// if clientVersion is set, then no osArchStr will be returned
func (conn *WslConn) StartConnServer(ctx context.Context, afterUpdate bool) (bool, string, string, error) {
	conn.Infof(ctx, "running StartConnServer...\n")
	allowed := WithLockRtn(conn, func() bool {
		return conn.Status == Status_Connecting
	})
	if !allowed {
		return false, "", "", fmt.Errorf("cannot start conn server for %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	client := conn.GetClient()
	wshPath := conn.getWshPath()
	conn.Infof(ctx, "WSL-NEWSESSION (StartConnServer)\n")
	connServerCtx, cancelFn := context.WithCancel(context.Background())
	conn.WithLock(func() {
		if conn.cancelFn != nil {
			conn.cancelFn()
		}
		conn.cancelFn = cancelFn
	})
	devFlag := ""
	if wavebase.IsDevMode() {
		devFlag = "--dev"
	}
	cmdStr := fmt.Sprintf(ConnServerCmdTemplate, wshPath, wshPath, shellutil.HardQuote(conn.GetName()), devFlag)
	shWrappedCmdStr := fmt.Sprintf("sh -c %s", shellutil.HardQuote(cmdStr))
	cmd := client.WslCommand(connServerCtx, shWrappedCmdStr)
	pipeRead, pipeWrite := io.Pipe()
	inputPipeRead, inputPipeWrite := io.Pipe()
	cmd.SetStdout(pipeWrite)
	cmd.SetStderr(pipeWrite)
	cmd.SetStdin(inputPipeRead)
	log.Printf("starting conn controller: %q\n", cmdStr)
	blocklogger.Debugf(ctx, "[conndebug] wrapped command:\n%s\n", shWrappedCmdStr)
	err := cmd.Start()
	if err != nil {
		return false, "", "", fmt.Errorf("unable to start conn controller cmd: %w", err)
	}
	linesChan := utilfn.StreamToLinesChan(pipeRead)
	versionLine, err := utilfn.ReadLineWithTimeout(linesChan, 30*time.Second)
	if err != nil {
		cancelFn()
		return false, "", "", fmt.Errorf("error reading wsh version: %w", err)
	}
	conn.Infof(ctx, "got connserver version: %s\n", strings.TrimSpace(versionLine))
	isUpToDate, clientVersion, osArchStr, err := conncontroller.IsWshVersionUpToDate(ctx, versionLine)
	if err != nil {
		cancelFn()
		return false, "", "", fmt.Errorf("error checking wsh version: %w", err)
	}
	if isUpToDate && !afterUpdate && os.Getenv(wavebase.WaveWshForceUpdateVarName) != "" {
		isUpToDate = false
		conn.Infof(ctx, "%s set, forcing wsh update\n", wavebase.WaveWshForceUpdateVarName)
	}
	conn.Infof(ctx, "connserver up-to-date: %v\n", isUpToDate)
	if !isUpToDate {
		cancelFn()
		return true, clientVersion, osArchStr, nil
	}
	conn.WithLock(func() {
		conn.ConnController = cmd
	})
	// service the I/O
	go func() {
		defer func() {
			panichandler.PanicHandler("wslconn:cmd.Wait", recover())
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
		waitErr = cmd.Wait()
		log.Printf("conn controller (%q) terminated: %v", conn.GetName(), waitErr)
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("wsl:StartConnServer:handleStdIOClient", recover())
		}()
		logName := fmt.Sprintf("wslconn:%s", conn.GetName())
		wshutil.HandleStdIOClient(logName, linesChan, inputPipeWrite)
	}()
	conn.Infof(ctx, "connserver started, waiting for route to be registered\n")
	regCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	err = wshutil.DefaultRouter.WaitForRegister(regCtx, wshutil.MakeConnectionRouteId(conn.GetName()))
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

func (conn *WslConn) UpdateWsh(ctx context.Context, clientDisplayName string, remoteInfo *wshrpc.RemoteInfo) error {
	conn.Infof(ctx, "attempting to update wsh for connection %s (os:%s arch:%s version:%s)\n",
		conn.GetName(), remoteInfo.ClientOs, remoteInfo.ClientArch, remoteInfo.ClientVersion)
	client := conn.GetClient()
	if client == nil {
		return fmt.Errorf("cannot update wsh: ssh client is not connected")
	}
	err := CpWshToRemote(ctx, client, remoteInfo.ClientOs, remoteInfo.ClientArch)
	if err != nil {
		return fmt.Errorf("error installing wsh to remote: %w", err)
	}
	conn.Infof(ctx, "successfully updated wsh on %s\n", conn.GetName())
	return nil

}

// returns (allowed, error)
func (conn *WslConn) getPermissionToInstallWsh(ctx context.Context, clientDisplayName string) (bool, error) {
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

func (conn *WslConn) InstallWsh(ctx context.Context, osArchStr string) error {
	conn.Infof(ctx, "running installWsh...\n")
	client := conn.GetClient()
	if client == nil {
		conn.Infof(ctx, "ERROR ssh client is not connected, cannot install\n")
		return fmt.Errorf("ssh client is not connected, cannot install")
	}
	var clientOs, clientArch string
	var err error
	if osArchStr != "" {
		clientOs, clientArch, err = GetClientPlatformFromOsArchStr(ctx, osArchStr)
	} else {
		clientOs, clientArch, err = GetClientPlatform(ctx, genconn.MakeWSLShellClient(client))
	}
	if err != nil {
		conn.Infof(ctx, "ERROR detecting client platform: %v\n", err)
	}
	conn.Infof(ctx, "detected remote platform os:%s arch:%s\n", clientOs, clientArch)
	err = CpWshToRemote(ctx, client, clientOs, clientArch)
	if err != nil {
		conn.Infof(ctx, "ERROR copying wsh binary to remote: %v\n", err)
		return fmt.Errorf("error copying wsh binary to remote: %w", err)
	}
	conn.Infof(ctx, "successfully installed wsh\n")
	return nil
}

func (conn *WslConn) GetClient() *wsl.Distro {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.Client
}

func (conn *WslConn) Reconnect(ctx context.Context) error {
	err := conn.Close()
	if err != nil {
		return err
	}
	return conn.Connect(ctx)
}

func (conn *WslConn) WaitForConnect(ctx context.Context) error {
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

// does not return an error since that error is stored inside of WslConn
func (conn *WslConn) Connect(ctx context.Context) error {
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
		conn.Infof(ctx, "cannot connect to %q when status is %q\n", conn.GetName(), conn.GetStatus())
		return fmt.Errorf("cannot connect to %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	conn.FireConnChangeEvent()
	err := conn.connectInternal(ctx)
	conn.WithLock(func() {
		if err != nil {
			conn.Infof(ctx, "ERROR %v\n\n", err)
			conn.Status = Status_Error
			conn.Error = err.Error()
			conn.close_nolock()
			telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{
				Conn: map[string]int{"wsl:connecterror": 1},
			}, "wsl-connconnect")
			telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
				Event: "conn:connecterror",
				Props: telemetrydata.TEventProps{
					ConnType: "wsl",
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
				Conn: map[string]int{"wsl:connect": 1},
			}, "wsl-connconnect")
			telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
				Event: "conn:connect",
				Props: telemetrydata.TEventProps{
					ConnType: "wsl",
				},
			})
		}
	})
	conn.FireConnChangeEvent()
	return err
}

func (conn *WslConn) WithLock(fn func()) {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	fn()
}

func WithLockRtn[T any](conn *WslConn, fn func() T) T {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return fn()
}

// returns (enable-wsh, ask-before-install)
func (conn *WslConn) getConnWshSettings() (bool, bool) {
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
func (conn *WslConn) tryEnableWsh(ctx context.Context, clientDisplayName string) WshCheckResult {
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

func (conn *WslConn) getConnectionConfig() (wconfig.ConnKeywords, bool) {
	config := wconfig.GetWatcher().GetFullConfig()
	connSettings, ok := config.Connections[conn.GetName()]
	if !ok {
		return wconfig.ConnKeywords{}, false
	}
	return connSettings, true
}

func (conn *WslConn) persistWshInstalled(ctx context.Context, result WshCheckResult) {
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

func (conn *WslConn) connectInternal(ctx context.Context) error {
	conn.Infof(ctx, "connectInternal %s\n", conn.GetName())
	client, err := wsl.GetDistro(ctx, conn.Name)
	if err != nil {
		conn.Infof(ctx, "ERROR GetDistro: %s\n", err)
		log.Printf("error: failed to get distro %s: %s\n", conn.GetName(), err)
		return err
	}
	conn.WithLock(func() {
		conn.Client = client
	})
	go func() {
		defer func() {
			panichandler.PanicHandler("wsl-waitForDisconnect", recover())
		}()
		conn.waitForDisconnect()
	}()
	wshResult := conn.tryEnableWsh(ctx, conn.GetName())
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

func (conn *WslConn) waitForDisconnect() {
	log.Printf("wait for disconnect in %+#v", conn)
	defer conn.FireConnChangeEvent()
	defer conn.HasWaiter.Store(false)
	if conn.ConnController == nil {
		return
	}
	err := conn.ConnController.Wait()
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

func (conn *WslConn) SetWshError(err error) {
	conn.WithLock(func() {
		if err == nil {
			conn.WshError = ""
		} else {
			conn.WshError = err.Error()
		}
	})
}

func (conn *WslConn) ClearWshError() {
	conn.WithLock(func() {
		conn.WshError = ""
	})
}

func getConnInternal(name string) *WslConn {
	globalLock.Lock()
	defer globalLock.Unlock()
	connName := wsl.WslName{Distro: name}
	rtn := clientControllerMap[name]
	if rtn == nil {
		rtn = &WslConn{Lock: &sync.Mutex{}, Status: Status_Init, Name: connName, WshEnabled: &atomic.Bool{}, HasWaiter: &atomic.Bool{}, cancelFn: nil}
		clientControllerMap[name] = rtn
	}
	return rtn
}

func GetWslConn(name string) *WslConn {
	conn := getConnInternal(name)
	return conn
}

// Convenience function for ensuring a connection is established
func EnsureConnection(ctx context.Context, connName string) error {
	if connName == "" {
		return nil
	}
	conn := GetWslConn(connName)
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

func DisconnectClient(connName string) error {
	conn := getConnInternal(connName)
	if conn == nil {
		return fmt.Errorf("client %q not found", connName)
	}
	err := conn.Close()
	return err
}
