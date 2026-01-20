// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/jobmanager"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func isProcessRunning(pid int, pidStartTs int64) (*process.Process, error) {
	if pid <= 0 {
		return nil, nil
	}
	proc, err := process.NewProcess(int32(pid))
	if err != nil {
		return nil, nil
	}
	createTime, err := proc.CreateTime()
	if err != nil {
		return nil, err
	}
	if createTime != pidStartTs {
		return nil, nil
	}
	return proc, nil
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
	linkId := impl.Router.RegisterUntrustedLink(proxy)

	go func() {
		writeErr := wshutil.AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("connectToJobManager: error writing to job manager socket: %v\n", writeErr)
		}
	}()
	go func() {
		defer func() {
			conn.Close()
			impl.Router.UnregisterLink(linkId)
			close(proxy.FromRemoteCh)
			impl.removeJobManagerConnection(jobId)
		}()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()

	cleanup := func() {
		conn.Close()
		impl.Router.UnregisterLink(linkId)
		impl.removeJobManagerConnection(jobId)
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

	jobConn := &JobManagerConnection{
		JobId:     jobId,
		Conn:      conn,
		CleanupFn: cleanup,
	}
	impl.addJobManagerConnection(jobConn)

	log.Printf("connectToJobManager: successfully connected and authenticated\n")
	return jobRouteId, cleanup, nil
}

func (impl *ServerImpl) addJobManagerConnection(conn *JobManagerConnection) {
	impl.Lock.Lock()
	defer impl.Lock.Unlock()
	impl.JobManagerMap[conn.JobId] = conn
	log.Printf("addJobManagerConnection: added job manager connection for jobid=%s\n", conn.JobId)
}

func (impl *ServerImpl) removeJobManagerConnection(jobId string) {
	impl.Lock.Lock()
	defer impl.Lock.Unlock()
	if _, exists := impl.JobManagerMap[jobId]; exists {
		delete(impl.JobManagerMap, jobId)
		log.Printf("removeJobManagerConnection: removed job manager connection for jobid=%s\n", jobId)
	}
}

func (impl *ServerImpl) getJobManagerConnection(jobId string) *JobManagerConnection {
	impl.Lock.Lock()
	defer impl.Lock.Unlock()
	return impl.JobManagerMap[jobId]
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

func (impl *ServerImpl) RemoteReconnectToJobManagerCommand(ctx context.Context, data wshrpc.CommandRemoteReconnectToJobManagerData) (*wshrpc.CommandRemoteReconnectToJobManagerRtnData, error) {
	log.Printf("RemoteReconnectToJobManagerCommand: reconnecting, jobid=%s\n", data.JobId)
	if impl.Router == nil {
		return &wshrpc.CommandRemoteReconnectToJobManagerRtnData{
			Success: false,
			Error:   "cannot reconnect to job manager: no router available",
		}, nil
	}

	proc, err := isProcessRunning(data.JobManagerPid, data.JobManagerStartTs)
	if err != nil {
		return &wshrpc.CommandRemoteReconnectToJobManagerRtnData{
			Success: false,
			Error:   fmt.Sprintf("error checking job manager process: %v", err),
		}, nil
	}
	if proc == nil {
		return &wshrpc.CommandRemoteReconnectToJobManagerRtnData{
			Success:          false,
			JobManagerExited: true,
			Error:            fmt.Sprintf("job manager process (pid=%d) is not running", data.JobManagerPid),
		}, nil
	}

	existingConn := impl.getJobManagerConnection(data.JobId)
	if existingConn != nil {
		log.Printf("RemoteReconnectToJobManagerCommand: closing existing connection for jobid=%s\n", data.JobId)
		if existingConn.CleanupFn != nil {
			existingConn.CleanupFn()
		}
	}

	_, _, err = impl.connectToJobManager(ctx, data.JobId, data.MainServerJwtToken)
	if err != nil {
		return &wshrpc.CommandRemoteReconnectToJobManagerRtnData{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	log.Printf("RemoteReconnectToJobManagerCommand: successfully reconnected to job manager\n")
	return &wshrpc.CommandRemoteReconnectToJobManagerRtnData{
		Success: true,
	}, nil
}

func (impl *ServerImpl) RemoteDisconnectFromJobManagerCommand(ctx context.Context, data wshrpc.CommandRemoteDisconnectFromJobManagerData) error {
	log.Printf("RemoteDisconnectFromJobManagerCommand: disconnecting, jobid=%s\n", data.JobId)
	conn := impl.getJobManagerConnection(data.JobId)
	if conn == nil {
		log.Printf("RemoteDisconnectFromJobManagerCommand: no connection found for jobid=%s\n", data.JobId)
		return nil
	}

	if conn.CleanupFn != nil {
		conn.CleanupFn()
		log.Printf("RemoteDisconnectFromJobManagerCommand: cleanup completed for jobid=%s\n", data.JobId)
	}

	return nil
}

func (impl *ServerImpl) RemoteTerminateJobManagerCommand(ctx context.Context, data wshrpc.CommandRemoteTerminateJobManagerData) error {
	log.Printf("RemoteTerminateJobManagerCommand: terminating job manager, jobid=%s, pid=%d\n", data.JobId, data.JobManagerPid)

	proc, err := isProcessRunning(data.JobManagerPid, data.JobManagerStartTs)
	if err != nil {
		return fmt.Errorf("error checking job manager process: %w", err)
	}
	if proc == nil {
		log.Printf("RemoteTerminateJobManagerCommand: job manager process not running, jobid=%s\n", data.JobId)
		return nil
	}

	err = proc.SendSignal(syscall.SIGHUP)
	if err != nil {
		return fmt.Errorf("failed to send SIGHUP to job manager: %w", err)
	}

	log.Printf("RemoteTerminateJobManagerCommand: sent SIGHUP to job manager process, jobid=%s, pid=%d\n", data.JobId, data.JobManagerPid)
	return nil
}
