// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
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
var wslListener *net.TCPListener

type WslConn struct {
	Lock               *sync.Mutex
	Status             string
	Name               WslName
	Client             *Distro
	SockName           string
	DomainSockListener net.Listener
	ConnController     *WslCmd
	Error              string
	HasWaiter          *atomic.Bool
	LastConnectTime    int64
	ActiveConnNum      int
	Context            context.Context
}

type WslName struct {
	Distro string `json:"distro"`
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

func (conn *WslConn) DeriveConnStatus() wshrpc.ConnStatus {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return wshrpc.ConnStatus{
		Status:        conn.Status,
		Connected:     conn.Status == Status_Connected,
		Connection:    conn.GetName(),
		HasConnected:  (conn.LastConnectTime > 0),
		ActiveConnNum: conn.ActiveConnNum,
		Error:         conn.Error,
	}
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
	}
	if conn.ConnController != nil {
		// not relevant in this case???
		//conn.ConnController.Close()
		conn.ConnController = nil
	}
	if conn.Client != nil {
		// not relevant in this case???
		//conn.Client.Close()
		conn.Client = nil
	}
}

func (conn *WslConn) GetDomainSocketName() string {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.SockName
}

func (conn *WslConn) GetStatus() string {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	return conn.Status
}

func (conn *WslConn) GetName() string {
	// no lock required because opts is immutable
	return "00wsl:" + conn.Name.Distro
}

func EnsureOpenTcpSocket(serverAddr string) (net.Listener, error) {
	/*
		routeId := "conn:" + sockName
		existingRpc := wshutil.DefaultRouter.GetRpc(routeId)
		if existingRpc != nil {
			return fmt.Errorf("route already exists - no need to recreate")
		}
		wslConnWsh := wshutil.MakeWshRpc(nil, nil, wshrpc.RpcContext{Conn: "wsl"}, &wshremote.ServerImpl{})
		//go wshremote.RunSysInfoLoop(localConnWsh, wshrpc.LocalConnName)
		wshutil.DefaultRouter.RegisterRoute(wshutil.MakeConnectionRouteId("wsl"), wslConnWsh)
		return nil
	*/
	globalLock.Lock()
	defer globalLock.Unlock()
	if wslListener != nil {
		return wslListener, nil
	}

	tcpListener, err := net.Listen("tcp", serverAddr)
	if err != nil {
		log.Printf("error creating tcp listener at: %s: %v\n", serverAddr, err)
		return nil, fmt.Errorf("error creating listener at %s: %w", serverAddr, err)
	}
	wslListener = tcpListener.(*net.TCPListener)
	go wshutil.RunWshRpcOverListener(tcpListener)
	return tcpListener, nil
}

func (conn *WslConn) OpenDomainSocketListener() error {
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
	//randStr, err := utilfn.RandomHexString(16) // 64-bits of randomness
	/*
		if err != nil {
			return fmt.Errorf("error generating random string: %w", err)
		}
	*/
	//sockName := "/mnt/c/Users/oneirocosm/.waveterm/wave.sock"
	// todo request listener registration on socket if it doesn't already exist
	sockName := "127.0.0.1:"
	listener, err := EnsureOpenTcpSocket(sockName)
	if err != nil {
		return err
	}
	//sockName := "http://localhost:234123/wsh"
	conn.WithLock(func() {
		conn.SockName = listener.Addr().String()
	})
	//log.Printf("remote domain socket %s %q\n", conn.GetName(), conn.GetDomainSocketName())
	// this is going to be difficult to replicate
	// attempt. do i need to request the socket be open???
	//sockName := filepath.Join(`\\wsl$\`, conn.Name, `tmp`, fmt.Sprintf("waveterm-%s.sock", randStr))
	//sockName := "~/.waveterm/temp.sock"
	//listenName := fmt.Sprintf(`\Users\oneirocosm\waveterm-%s.sock`, randStr)
	//listener, err := net.Listen("unix", listenName)
	/*
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
	*/
	return nil
}

func (conn *WslConn) StartConnServer() error {
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
	wshPath := GetWshPath(conn.Context, client)
	rpcCtx := wshrpc.RpcContext{
		ClientType: wshrpc.ClientType_ConnServer,
		Conn:       conn.GetName(),
	}
	sockName := conn.GetDomainSocketName()
	jwtToken, err := wshutil.MakeClientJWTToken(rpcCtx, sockName)
	if err != nil {
		return fmt.Errorf("unable to create jwt token for conn controller: %w", err)
	}
	/*
		sshSession, err := client.NewSession()
		if err != nil {
			return fmt.Errorf("unable to create ssh session for conn controller: %w", err)
		}
		pipeRead, pipeWrite := io.Pipe()
		sshSession.Stdout = pipeWrite
		sshSession.Stderr = pipeWrite
	*/
	shellPath, err := DetectShell(conn.Context, client)
	if err != nil {
		return err
	}
	var cmdStr string
	if IsPowershell(shellPath) {
		cmdStr = fmt.Sprintf("$env:%s=\"%s\"; %s connserver", wshutil.WaveJwtTokenVarName, jwtToken, wshPath)
	} else {
		cmdStr = fmt.Sprintf("%s=\"%s\" %s connserver", wshutil.WaveJwtTokenVarName, jwtToken, wshPath)
	}
	log.Printf("starting conn controller: %s\n", cmdStr)
	// keeping this dead code around so i remember to
	// revert it if my pr is accepted
	/*
		cmd := client.Command(ctx, cmdStr)
		pipeRead, pipeWrite := io.Pipe()
		cmd.Stdout = pipeWrite
		cmd.Stderr = pipeWrite
	*/
	cmd := client.WslCommand(conn.Context, cmdStr)
	pipeRead, pipeWrite := io.Pipe()
	cmd.SetStdout(pipeWrite)
	cmd.SetStderr(pipeWrite)
	err = cmd.Start()
	if err != nil {
		return fmt.Errorf("unable to start conn controller: %w", err)
	}
	conn.WithLock(func() {
		conn.ConnController = cmd
	})
	// service the I/O
	go func() {
		// wait for termination, clear the controller
		defer conn.WithLock(func() {
			conn.ConnController = nil
		})
		waitErr := cmd.Wait()
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

func (conn *WslConn) CheckAndInstallWsh(ctx context.Context, clientDisplayName string, opts *WshInstallOpts) error {
	if opts == nil {
		opts = &WshInstallOpts{}
	}
	client := conn.GetClient()
	if client == nil {
		return fmt.Errorf("client is nil")
	}
	// check that correct wsh extensions are installed
	expectedVersion := fmt.Sprintf("wsh v%s", wavebase.WaveVersion)
	clientVersion, err := GetWshVersion(ctx, client)
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
		queryText = fmt.Sprintf("Wave requires the Wave Shell Extensions  \n"+
			"installed on `%s`  \n"+
			"to be updated from %s to %s.  \n\n"+
			"Would you like to update?", clientDisplayName, clientVersion, expectedVersion)
		title = "Update Wave Shell Extensions"
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
	}
	log.Printf("attempting to install wsh to `%s`", clientDisplayName)
	clientOs, err := GetClientOs(ctx, client)
	if err != nil {
		return err
	}
	clientArch, err := GetClientArch(ctx, client)
	if err != nil {
		return err
	}
	// attempt to install extension
	wshLocalPath := shellutil.GetWshBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	err = CpHostToRemote(ctx, client, wshLocalPath, "~/.waveterm/bin/wsh")
	if err != nil {
		return err
	}
	log.Printf("successfully installed wsh on %s\n", conn.GetName())
	return nil
}

func (conn *WslConn) GetClient() *Distro {
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

func (conn *WslConn) WithLock(fn func()) {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	fn()
}

func (conn *WslConn) connectInternal(ctx context.Context) error {
	client, err := GetDistro(ctx, conn.Name)
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
	installErr := conn.CheckAndInstallWsh(ctx, conn.GetName(), nil)
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

func (conn *WslConn) waitForDisconnect() {
	defer conn.FireConnChangeEvent()
	defer conn.HasWaiter.Store(false)
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

func getConnInternal(name string) *WslConn {
	globalLock.Lock()
	defer globalLock.Unlock()
	connName := WslName{Distro: name}
	rtn := clientControllerMap[name]
	if rtn == nil {
		rtn = &WslConn{Lock: &sync.Mutex{}, Status: Status_Init, Name: connName, HasWaiter: &atomic.Bool{}, Context: context.Context(context.Background())}
		clientControllerMap[name] = rtn
	}
	return rtn
}

func GetWslConn(ctx context.Context, name string, shouldConnect bool) *WslConn {
	conn := getConnInternal(name)
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
	conn := GetWslConn(ctx, connName, false)
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
