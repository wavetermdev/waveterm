// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type MainServerConn struct {
	PeerAuthenticated atomic.Bool
	SelfAuthenticated atomic.Bool
	WshRpc            *wshutil.WshRpc
	Conn              net.Conn
	inputCh           chan baseds.RpcInputChType
	closeOnce         sync.Once
}

func (*MainServerConn) WshServerImpl() {}

func (msc *MainServerConn) Close() {
	msc.closeOnce.Do(func() {
		msc.Conn.Close()
		close(msc.inputCh)
	})
}

type routedDataSender struct {
	wshRpc *wshutil.WshRpc
	route  string
}

func (rds *routedDataSender) SendData(dataPk wshrpc.CommandStreamData) {
	log.Printf("SendData: sending seq=%d, len=%d, eof=%t, error=%s, route=%s",
		dataPk.Seq, len(dataPk.Data64), dataPk.Eof, dataPk.Error, rds.route)
	err := wshclient.StreamDataCommand(rds.wshRpc, dataPk, &wshrpc.RpcOpts{NoResponse: true, Route: rds.route})
	if err != nil {
		log.Printf("SendData: error sending stream data: %v\n", err)
	}
}

func (msc *MainServerConn) authenticateSelfToServer(jobAuthToken string) error {
	jobId, _ := WshCmdJobManager.GetJobAuthInfo()
	authData := wshrpc.CommandAuthenticateJobManagerData{
		JobId:        jobId,
		JobAuthToken: jobAuthToken,
	}
	err := wshclient.AuthenticateJobManagerCommand(msc.WshRpc, authData, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		log.Printf("authenticateSelfToServer: failed to authenticate to server: %v\n", err)
		return fmt.Errorf("failed to authenticate to server: %w", err)
	}
	msc.SelfAuthenticated.Store(true)
	log.Printf("authenticateSelfToServer: successfully authenticated to server\n")
	return nil
}

func (msc *MainServerConn) AuthenticateToJobManagerCommand(ctx context.Context, data wshrpc.CommandAuthenticateToJobData) error {
	jobId, jobAuthToken := WshCmdJobManager.GetJobAuthInfo()

	claims, err := wavejwt.ValidateAndExtract(data.JobAccessToken)
	if err != nil {
		log.Printf("AuthenticateToJobManager: failed to validate token: %v\n", err)
		return fmt.Errorf("failed to validate token: %w", err)
	}
	if !claims.MainServer {
		log.Printf("AuthenticateToJobManager: MainServer claim not set\n")
		return fmt.Errorf("MainServer claim not set")
	}
	if claims.JobId != jobId {
		log.Printf("AuthenticateToJobManager: JobId mismatch: expected %s, got %s\n", jobId, claims.JobId)
		return fmt.Errorf("JobId mismatch")
	}
	msc.PeerAuthenticated.Store(true)
	log.Printf("AuthenticateToJobManager: authentication successful for JobId=%s\n", claims.JobId)

	err = msc.authenticateSelfToServer(jobAuthToken)
	if err != nil {
		msc.PeerAuthenticated.Store(false)
		return err
	}

	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if WshCmdJobManager.attachedClient != nil {
		log.Printf("AuthenticateToJobManager: kicking out existing client\n")
		WshCmdJobManager.attachedClient.Close()
	}
	WshCmdJobManager.attachedClient = msc
	return nil
}

func (msc *MainServerConn) StartJobCommand(ctx context.Context, data wshrpc.CommandStartJobData) (*wshrpc.CommandStartJobRtnData, error) {
	log.Printf("StartJobCommand: received command=%s args=%v", data.Cmd, data.Args)
	if !msc.PeerAuthenticated.Load() {
		log.Printf("StartJobCommand: not authenticated")
		return nil, fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.IsJobStarted() {
		log.Printf("StartJobCommand: job already started")
		return nil, fmt.Errorf("job already started")
	}

	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if WshCmdJobManager.Cmd != nil {
		log.Printf("StartJobCommand: job already started (double check)")
		return nil, fmt.Errorf("job already started")
	}

	cmdDef := CmdDef{
		Cmd:      data.Cmd,
		Args:     data.Args,
		Env:      data.Env,
		TermSize: data.TermSize,
	}
	log.Printf("StartJobCommand: creating job cmd for jobid=%s", WshCmdJobManager.JobId)
	jobCmd, err := MakeJobCmd(WshCmdJobManager.JobId, cmdDef)
	if err != nil {
		log.Printf("StartJobCommand: failed to make job cmd: %v", err)
		return nil, fmt.Errorf("failed to start job: %w", err)
	}
	WshCmdJobManager.Cmd = jobCmd
	log.Printf("StartJobCommand: job cmd created successfully")

	if data.StreamMeta != nil {
		serverSeq, err := WshCmdJobManager.connectToStreamHelper_withlock(msc, *data.StreamMeta, 0)
		if err != nil {
			return nil, fmt.Errorf("failed to connect stream: %w", err)
		}
		err = msc.WshRpc.StreamBroker.AttachStreamWriter(data.StreamMeta, WshCmdJobManager.StreamManager)
		if err != nil {
			return nil, fmt.Errorf("failed to attach stream writer: %w", err)
		}
		log.Printf("StartJob: connected stream streamid=%s serverSeq=%d\n", data.StreamMeta.Id, serverSeq)
	}

	_, cmdPty := jobCmd.GetCmd()
	if cmdPty != nil {
		log.Printf("StartJobCommand: attaching pty reader to stream manager")
		err = WshCmdJobManager.StreamManager.AttachReader(cmdPty)
		if err != nil {
			log.Printf("StartJobCommand: failed to attach reader: %v", err)
			return nil, fmt.Errorf("failed to attach reader to stream manager: %w", err)
		}
		log.Printf("StartJobCommand: pty reader attached successfully")
	} else {
		log.Printf("StartJobCommand: no pty to attach")
	}

	cmd, _ := jobCmd.GetCmd()
	if cmd == nil || cmd.Process == nil {
		log.Printf("StartJobCommand: cmd or process is nil")
		return nil, fmt.Errorf("cmd or process is nil")
	}
	cmdPgid, err := getProcessGroupId(cmd.Process.Pid)
	if err != nil {
		log.Printf("StartJobCommand: failed to get pgid: %v", err)
		return nil, fmt.Errorf("failed to get process group id: %w", err)
	}

	jobManagerPid := os.Getpid()
	proc, err := process.NewProcess(int32(jobManagerPid))
	if err != nil {
		log.Printf("StartJobCommand: failed to get job manager process: %v", err)
		return nil, fmt.Errorf("failed to get job manager process: %w", err)
	}
	jobManagerStartTs, err := proc.CreateTime()
	if err != nil {
		log.Printf("StartJobCommand: failed to get job manager start time: %v", err)
		return nil, fmt.Errorf("failed to get job manager start time: %w", err)
	}

	log.Printf("StartJobCommand: job started successfully cmdPid=%d cmdPgid=%d jobManagerPid=%d jobManagerStartTs=%d", cmd.Process.Pid, cmdPgid, jobManagerPid, jobManagerStartTs)
	return &wshrpc.CommandStartJobRtnData{
		CmdPgid:           cmdPgid,
		JobManagerPid:     jobManagerPid,
		JobManagerStartTs: jobManagerStartTs,
	}, nil
}

func (msc *MainServerConn) JobPrepareConnectCommand(ctx context.Context, data wshrpc.CommandJobPrepareConnectData) (*wshrpc.CommandJobConnectRtnData, error) {
	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if !msc.PeerAuthenticated.Load() {
		return nil, fmt.Errorf("peer not authenticated")
	}
	if !msc.SelfAuthenticated.Load() {
		return nil, fmt.Errorf("not authenticated to server")
	}
	if WshCmdJobManager.Cmd == nil {
		return nil, fmt.Errorf("job not started")
	}

	corkedStreamMeta := data.StreamMeta
	corkedStreamMeta.RWnd = 0
	serverSeq, err := WshCmdJobManager.connectToStreamHelper_withlock(msc, corkedStreamMeta, data.Seq)
	if err != nil {
		return nil, err
	}

	WshCmdJobManager.pendingStreamMeta = &data.StreamMeta

	rtnData := &wshrpc.CommandJobConnectRtnData{Seq: serverSeq}
	rtnData.StreamDone, rtnData.StreamError = WshCmdJobManager.StreamManager.GetStreamDoneInfo()
	hasExited, exitData := WshCmdJobManager.Cmd.GetExitInfo()
	if hasExited && exitData != nil {
		rtnData.HasExited = true
		rtnData.ExitCode = exitData.ExitCode
		rtnData.ExitSignal = exitData.ExitSignal
		rtnData.ExitErr = exitData.ExitErr
	}

	log.Printf("JobPrepareConnect: streamid=%s clientSeq=%d serverSeq=%d streamDone=%v streamError=%q hasExited=%v (rwnd=0 cork mode)\n", data.StreamMeta.Id, data.Seq, serverSeq, rtnData.StreamDone, rtnData.StreamError, hasExited)
	return rtnData, nil
}

func (msc *MainServerConn) JobStartStreamCommand(ctx context.Context, data wshrpc.CommandJobStartStreamData) error {
	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if !msc.PeerAuthenticated.Load() {
		return fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.Cmd == nil {
		return fmt.Errorf("job not started")
	}
	if WshCmdJobManager.pendingStreamMeta == nil {
		return fmt.Errorf("no pending stream (call JobPrepareConnect first)")
	}

	err := msc.WshRpc.StreamBroker.AttachStreamWriter(WshCmdJobManager.pendingStreamMeta, WshCmdJobManager.StreamManager)
	if err != nil {
		return fmt.Errorf("failed to attach stream writer: %w", err)
	}

	err = WshCmdJobManager.StreamManager.SetRwndSize(int(WshCmdJobManager.pendingStreamMeta.RWnd))
	if err != nil {
		return fmt.Errorf("failed to set rwnd size: %w", err)
	}

	log.Printf("JobStartStream: streamid=%s rwnd=%d streaming started\n", WshCmdJobManager.pendingStreamMeta.Id, WshCmdJobManager.pendingStreamMeta.RWnd)
	WshCmdJobManager.pendingStreamMeta = nil
	return nil
}

func (msc *MainServerConn) JobTerminateCommand(ctx context.Context, data wshrpc.CommandJobTerminateData) error {
	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if !msc.PeerAuthenticated.Load() {
		return fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.Cmd == nil {
		return fmt.Errorf("job not started")
	}
	log.Printf("JobTerminate called\n")
	WshCmdJobManager.Cmd.TerminateByClosingPtyMaster()
	return nil
}

func (msc *MainServerConn) JobManagerExitCommand(ctx context.Context) error {
	if !msc.PeerAuthenticated.Load() {
		return fmt.Errorf("not authenticated")
	}
	log.Printf("JobManagerExit called, terminating job manager\n")
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}
