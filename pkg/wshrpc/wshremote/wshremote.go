// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobmanager"
	"github.com/wavetermdev/waveterm/pkg/suggestion"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// this is the connserver interface.
// it runs on remote servers, and one instance also runs on localhost

type ServerImpl struct {
	LogWriter io.Writer
	Router    *wshutil.WshRouter
	RpcClient *wshutil.WshRpc
	IsLocal   bool
}

func (*ServerImpl) WshServerImpl() {}

func (impl *ServerImpl) Log(format string, args ...interface{}) {
	if impl.LogWriter != nil {
		fmt.Fprintf(impl.LogWriter, format, args...)
	} else {
		log.Printf(format, args...)
	}
}

func (impl *ServerImpl) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	impl.Log("[message] %q\n", data.Message)
	return nil
}

func (impl *ServerImpl) StreamTestCommand(ctx context.Context) chan wshrpc.RespOrErrorUnion[int] {
	ch := make(chan wshrpc.RespOrErrorUnion[int], 16)
	go func() {
		defer close(ch)
		idx := 0
		for {
			ch <- wshrpc.RespOrErrorUnion[int]{Response: idx}
			idx++
			if idx == 1000 {
				break
			}
		}
	}()
	return ch
}

func (*ServerImpl) RemoteGetInfoCommand(ctx context.Context) (wshrpc.RemoteInfo, error) {
	return wshutil.GetInfo(), nil
}

func (*ServerImpl) RemoteInstallRcFilesCommand(ctx context.Context) error {
	return wshutil.InstallRcFiles()
}

func (*ServerImpl) FetchSuggestionsCommand(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	return suggestion.FetchSuggestions(ctx, data)
}

func (*ServerImpl) DisposeSuggestionsCommand(ctx context.Context, widgetId string) error {
	suggestion.DisposeSuggestions(ctx, widgetId)
	return nil
}

func (impl *ServerImpl) getWshPath() (string, error) {
	if impl.IsLocal {
		return filepath.Join(wavebase.GetWaveDataDir(), "bin", "wsh"), nil
	}
	wshPath, err := wavebase.ExpandHomeDir("~/.waveterm/bin/wsh")
	if err != nil {
		return "", fmt.Errorf("cannot expand wsh path: %w", err)
	}
	return wshPath, nil
}

// returns jobRouteId, cleanupFunc, error
func (impl *ServerImpl) connectToJobManager(ctx context.Context, jobId string, mainServerJwtToken string) (string, func(), error) {
	socketPath := jobmanager.GetJobSocketPath(jobId)
	log.Printf("connectToJobManager: connecting to socket: %s\n", socketPath)
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		log.Printf("connectToJobManager: error connecting to socket: %v\n", err)
		return "", nil, fmt.Errorf("cannot connect to job manager socket: %w", err)
	}
	log.Printf("connectToJobManager: connected to socket\n")

	proxy := wshutil.MakeRpcProxy("jobmanager")
	go func() {
		writeErr := wshutil.AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("connectToJobManager: error writing to job manager socket: %v\n", writeErr)
		}
	}()
	go func() {
		defer func() {
			conn.Close()
			close(proxy.FromRemoteCh)
		}()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()

	linkId := impl.Router.RegisterUntrustedLink(proxy)
	cleanup := func() {
		conn.Close()
		impl.Router.UnregisterLink(linkId)
	}

	routeId := wshutil.MakeLinkRouteId(linkId)
	authData := wshrpc.CommandAuthenticateToJobData{
		JobAccessToken: mainServerJwtToken,
	}
	err = wshclient.AuthenticateToJobManagerCommand(impl.RpcClient, authData, &wshrpc.RpcOpts{Route: routeId})
	if err != nil {
		cleanup()
		return "", nil, fmt.Errorf("authentication to job manager failed: %w", err)
	}

	jobRouteId := wshutil.MakeJobRouteId(jobId)
	waitCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	err = impl.Router.WaitForRegister(waitCtx, jobRouteId)
	if err != nil {
		cleanup()
		return "", nil, fmt.Errorf("timeout waiting for job route to register: %w", err)
	}

	log.Printf("connectToJobManager: successfully connected and authenticated\n")
	return jobRouteId, cleanup, nil
}

func (impl *ServerImpl) RemoteStartJobCommand(ctx context.Context, data wshrpc.CommandRemoteStartJobData) (*wshrpc.CommandStartJobRtnData, error) {
	log.Printf("RemoteStartJobCommand: starting, jobid=%s, clientid=%s\n", data.JobId, data.ClientId)
	if impl.Router == nil {
		return nil, fmt.Errorf("cannot start remote job: no router available")
	}

	wshPath, err := impl.getWshPath()
	if err != nil {
		return nil, err
	}
	log.Printf("RemoteStartJobCommand: wshPath=%s\n", wshPath)

	readyPipeRead, readyPipeWrite, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("cannot create ready pipe: %w", err)
	}
	defer readyPipeRead.Close()
	defer readyPipeWrite.Close()

	cmd := exec.Command(wshPath, "jobmanager", "--jobid", data.JobId, "--clientid", data.ClientId)
	if data.PublicKeyBase64 != "" {
		cmd.Env = append(os.Environ(), "WAVETERM_PUBLICKEY="+data.PublicKeyBase64)
	}
	cmd.ExtraFiles = []*os.File{readyPipeWrite}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("cannot create stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("cannot create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("cannot create stderr pipe: %w", err)
	}
	log.Printf("RemoteStartJobCommand: created pipes\n")

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("cannot start job manager: %w", err)
	}
	log.Printf("RemoteStartJobCommand: job manager process started\n")

	jobAuthTokenLine := fmt.Sprintf("Wave-JobAccessToken:%s\n", data.JobAuthToken)
	if _, err := stdin.Write([]byte(jobAuthTokenLine)); err != nil {
		cmd.Process.Kill()
		return nil, fmt.Errorf("cannot write job auth token: %w", err)
	}
	stdin.Close()
	log.Printf("RemoteStartJobCommand: wrote auth token to stdin\n")

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("RemoteStartJobCommand: stderr: %s\n", line)
		}
		if err := scanner.Err(); err != nil {
			log.Printf("RemoteStartJobCommand: error reading stderr: %v\n", err)
		} else {
			log.Printf("RemoteStartJobCommand: stderr EOF\n")
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("RemoteStartJobCommand: stdout: %s\n", line)
		}
		if err := scanner.Err(); err != nil {
			log.Printf("RemoteStartJobCommand: error reading stdout: %v\n", err)
		} else {
			log.Printf("RemoteStartJobCommand: stdout EOF\n")
		}
	}()

	startCh := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(readyPipeRead)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("RemoteStartJobCommand: ready pipe line: %s\n", line)
			if strings.Contains(line, "Wave-JobManagerStart") {
				startCh <- nil
				return
			}
		}
		if err := scanner.Err(); err != nil {
			startCh <- fmt.Errorf("error reading ready pipe: %w", err)
		} else {
			log.Printf("RemoteStartJobCommand: ready pipe EOF\n")
			startCh <- fmt.Errorf("job manager exited without start signal")
		}
	}()

	timeoutCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	log.Printf("RemoteStartJobCommand: waiting for start signal\n")
	select {
	case err := <-startCh:
		if err != nil {
			cmd.Process.Kill()
			log.Printf("RemoteStartJobCommand: error from start signal: %v\n", err)
			return nil, err
		}
		log.Printf("RemoteStartJobCommand: received start signal\n")
	case <-timeoutCtx.Done():
		cmd.Process.Kill()
		log.Printf("RemoteStartJobCommand: timeout waiting for start signal\n")
		return nil, fmt.Errorf("timeout waiting for job manager to start")
	}

	go func() {
		cmd.Wait()
	}()

	jobRouteId, cleanup, err := impl.connectToJobManager(ctx, data.JobId, data.MainServerJwtToken)
	if err != nil {
		return nil, err
	}

	startJobData := wshrpc.CommandStartJobData{
		Cmd:        data.Cmd,
		Args:       data.Args,
		Env:        data.Env,
		TermSize:   data.TermSize,
		StreamMeta: data.StreamMeta,
	}
	rtnData, err := wshclient.StartJobCommand(impl.RpcClient, startJobData, &wshrpc.RpcOpts{Route: jobRouteId})
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("failed to start job: %w", err)
	}

	return rtnData, nil
}

func (impl *ServerImpl) RemoteReconnectToJobManagerCommand(ctx context.Context, data wshrpc.CommandRemoteReconnectToJobManagerData) error {
	log.Printf("RemoteReconnectToJobManagerCommand: reconnecting, jobid=%s\n", data.JobId)
	if impl.Router == nil {
		return fmt.Errorf("cannot reconnect to job manager: no router available")
	}

	_, _, err := impl.connectToJobManager(ctx, data.JobId, data.MainServerJwtToken)
	if err != nil {
		return err
	}

	log.Printf("RemoteReconnectToJobManagerCommand: successfully reconnected to job manager\n")
	return nil
}
