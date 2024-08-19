// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/remote"
	"github.com/wavetermdev/thenextwave/pkg/userinput"
	"github.com/wavetermdev/thenextwave/pkg/util/shellutil"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"golang.org/x/crypto/ssh"
)

var globalLock = &sync.Mutex{}
var clientControllerMap = make(map[remote.SSHOpts]*SSHConn)

type SSHConn struct {
	Lock               *sync.Mutex
	Opts               *remote.SSHOpts
	Client             *ssh.Client
	SockName           string
	DomainSockListener net.Listener
	ConnController     *ssh.Session
}

func (conn *SSHConn) Close() error {
	if conn.DomainSockListener != nil {
		conn.DomainSockListener.Close()
		conn.DomainSockListener = nil
	}
	if conn.ConnController != nil {
		conn.ConnController.Close()
		conn.ConnController = nil
	}
	err := conn.Client.Close()
	conn.Client = nil
	return err
}

func (conn *SSHConn) OpenDomainSocketListener() error {
	if conn.DomainSockListener != nil {
		return nil
	}
	randStr, err := utilfn.RandomHexString(16) // 64-bits of randomness
	if err != nil {
		return fmt.Errorf("error generating random string: %w", err)
	}
	sockName := fmt.Sprintf("/tmp/waveterm-%s.sock", randStr)
	log.Printf("remote domain socket %s %q\n", conn.Opts.String(), sockName)
	listener, err := conn.Client.ListenUnix(sockName)
	if err != nil {
		return fmt.Errorf("unable to request connection domain socket: %v", err)
	}
	conn.SockName = sockName
	conn.DomainSockListener = listener
	go func() {
		defer func() {
			conn.Lock.Lock()
			defer conn.Lock.Unlock()
			conn.DomainSockListener = nil
		}()
		wshutil.RunWshRpcOverListener(listener)
	}()
	return nil
}

func (conn *SSHConn) StartConnServer() error {
	conn.Lock.Lock()
	defer conn.Lock.Unlock()
	if conn.ConnController != nil {
		return nil
	}
	wshPath := remote.GetWshPath(conn.Client)
	rpcCtx := wshrpc.RpcContext{
		Conn: conn.Opts.String(),
	}
	jwtToken, err := wshutil.MakeClientJWTToken(rpcCtx, conn.SockName)
	if err != nil {
		return fmt.Errorf("unable to create jwt token for conn controller: %w", err)
	}
	sshSession, err := conn.Client.NewSession()
	if err != nil {
		return fmt.Errorf("unable to create ssh session for conn controller: %w", err)
	}
	pipeRead, pipeWrite := io.Pipe()
	sshSession.Stdout = pipeWrite
	sshSession.Stderr = pipeWrite
	conn.ConnController = sshSession
	cmdStr := fmt.Sprintf("%s=\"%s\" %s connserver", wshutil.WaveJwtTokenVarName, jwtToken, wshPath)
	log.Printf("starting conn controller: %s\n", cmdStr)
	err = sshSession.Start(cmdStr)
	if err != nil {
		return fmt.Errorf("unable to start conn controller: %w", err)
	}
	// service the I/O
	go func() {
		// wait for termination, clear the controller
		waitErr := sshSession.Wait()
		log.Printf("conn controller (%q) terminated: %v", conn.Opts.String(), waitErr)
		conn.Lock.Lock()
		defer conn.Lock.Unlock()
		conn.ConnController = nil
	}()
	go func() {
		readErr := wshutil.StreamToLines(pipeRead, func(line []byte) {
			lineStr := string(line)
			if !strings.HasSuffix(lineStr, "\n") {
				lineStr += "\n"
			}
			log.Printf("[conncontroller:%s:output] %s", conn.Opts.String(), lineStr)
		})
		if readErr != nil && readErr != io.EOF {
			log.Printf("[conncontroller:%s] error reading output: %v\n", conn.Opts.String(), readErr)
		}
	}()
	return nil
}

func (conn *SSHConn) checkAndInstallWsh(ctx context.Context) error {
	client := conn.Client
	// check that correct wsh extensions are installed
	expectedVersion := fmt.Sprintf("wsh v%s", wavebase.WaveVersion)
	clientVersion, err := remote.GetWshVersion(client)
	if err == nil && clientVersion == expectedVersion {
		return nil
	}
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
	log.Printf("successfully installed wsh on %s\n", conn.Opts.String())
	return nil
}

func GetConn(ctx context.Context, opts *remote.SSHOpts) (*SSHConn, error) {
	globalLock.Lock()
	defer globalLock.Unlock()

	// attempt to retrieve if already opened
	conn, ok := clientControllerMap[*opts]
	if ok {
		return conn, nil
	}

	client, err := remote.ConnectToClient(ctx, opts) //todo specify or remove opts
	if err != nil {
		return nil, err
	}
	conn = &SSHConn{Lock: &sync.Mutex{}, Opts: opts, Client: client}
	err = conn.OpenDomainSocketListener()
	if err != nil {
		conn.Close()
		return nil, err
	}

	installErr := conn.checkAndInstallWsh(ctx)
	if installErr != nil {
		conn.Close()
		return nil, fmt.Errorf("conncontroller %s wsh install error: %v", conn.Opts.String(), installErr)
	}

	csErr := conn.StartConnServer()
	if csErr != nil {
		conn.Close()
		return nil, fmt.Errorf("conncontroller %s start wsh connserver error: %v", conn.Opts.String(), csErr)
	}

	// save successful connection to map
	clientControllerMap[*opts] = conn

	return conn, nil
}

func DisconnectClient(opts *remote.SSHOpts) error {
	globalLock.Lock()
	defer globalLock.Unlock()

	client, ok := clientControllerMap[*opts]
	if ok {
		return client.Close()
	}
	return fmt.Errorf("client %v not found", opts)
}
