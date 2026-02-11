// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"sync/atomic"

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
	// log.Printf("SendData: sending seq=%d, len=%d, eof=%t, error=%s, route=%s",
	// 	dataPk.Seq, len(dataPk.Data64), dataPk.Eof, dataPk.Error, rds.route)
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

	WshCmdJobManager.SetAttachedClient(msc)
	return nil
}

func (msc *MainServerConn) StartJobCommand(ctx context.Context, data wshrpc.CommandStartJobData) (*wshrpc.CommandStartJobRtnData, error) {
	log.Printf("StartJobCommand: received command=%s args=%v", data.Cmd, data.Args)
	if !msc.PeerAuthenticated.Load() {
		log.Printf("StartJobCommand: not authenticated")
		return nil, fmt.Errorf("not authenticated")
	}
	return WshCmdJobManager.StartJob(msc, data)
}

func (msc *MainServerConn) JobPrepareConnectCommand(ctx context.Context, data wshrpc.CommandJobPrepareConnectData) (*wshrpc.CommandJobConnectRtnData, error) {
	if !msc.PeerAuthenticated.Load() {
		return nil, fmt.Errorf("peer not authenticated")
	}
	if !msc.SelfAuthenticated.Load() {
		return nil, fmt.Errorf("not authenticated to server")
	}
	return WshCmdJobManager.PrepareConnect(msc, data)
}

func (msc *MainServerConn) JobStartStreamCommand(ctx context.Context, data wshrpc.CommandJobStartStreamData) error {
	if !msc.PeerAuthenticated.Load() {
		return fmt.Errorf("not authenticated")
	}
	return WshCmdJobManager.StartStream(msc)
}

func (msc *MainServerConn) JobInputCommand(ctx context.Context, data wshrpc.CommandJobInputData) error {
	if !msc.PeerAuthenticated.Load() {
		return fmt.Errorf("not authenticated")
	}
	if !WshCmdJobManager.IsJobStarted() {
		return fmt.Errorf("job not started")
	}

	WshCmdJobManager.InputQueue.QueueItem(data.InputSessionId, data.SeqNum, data)
	return nil
}
