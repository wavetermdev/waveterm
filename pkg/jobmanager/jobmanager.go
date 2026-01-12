// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var WshCmdJobManager JobManager

type JobManager struct {
	ClientId     string
	JobId        string
	Cmd          *JobCmd
	JwtPublicKey []byte
	JobAuthToken string
}

type JobServerImpl struct {
	Authenticated bool
}

func (JobServerImpl) WshServerImpl() {}

func (impl *JobServerImpl) AuthenticateToJobManagerCommand(ctx context.Context, data wshrpc.CommandAuthenticateToJobData) {
	claims, err := wavejwt.ValidateAndExtract(data.JobAccessToken)
	if err != nil {
		log.Printf("AuthenticateToJobManager: failed to validate token: %v\n", err)
		return
	}
	if !claims.MainServer {
		log.Printf("AuthenticateToJobManager: MainServer claim not set\n")
		return
	}
	if claims.JobId != WshCmdJobManager.JobId {
		log.Printf("AuthenticateToJobManager: JobId mismatch: expected %s, got %s\n", WshCmdJobManager.JobId, claims.JobId)
		return
	}
	impl.Authenticated = true
	log.Printf("AuthenticateToJobManager: authentication successful for JobId=%s\n", claims.JobId)
}

func (impl *JobServerImpl) StartJobCommand(ctx context.Context, data wshrpc.CommandStartJobData) (*wshrpc.CommandStartJobRtnData, error) {
	if !impl.Authenticated {
		return nil, fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.Cmd != nil {
		return nil, fmt.Errorf("job already started")
	}
	WshCmdJobManager.JobAuthToken = data.JobAuthToken
	cmdDef := CmdDef{
		Cmd:      data.Cmd,
		Args:     data.Args,
		Env:      data.Env,
		TermSize: data.TermSize,
	}
	jobCmd, err := MakeJobCmd(WshCmdJobManager.JobId, cmdDef)
	if err != nil {
		return nil, fmt.Errorf("failed to start job: %w", err)
	}
	WshCmdJobManager.Cmd = jobCmd
	cmd, _ := jobCmd.GetCmd()
	if cmd == nil || cmd.Process == nil {
		return nil, fmt.Errorf("cmd or process is nil")
	}
	pgid, err := getProcessGroupId(cmd.Process.Pid)
	if err != nil {
		return nil, fmt.Errorf("failed to get process group id: %w", err)
	}
	return &wshrpc.CommandStartJobRtnData{Pgid: pgid}, nil
}

func (impl *JobServerImpl) JobConnectCommand(ctx context.Context, data wshrpc.CommandJobConnectData) error {
	if !impl.Authenticated {
		return fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.Cmd == nil {
		return fmt.Errorf("job not started")
	}
	log.Printf("JobConnect: streamid=%s seq=%d\n", data.StreamId, data.Seq)
	return nil
}

func (impl *JobServerImpl) JobTerminateCommand(ctx context.Context, data wshrpc.CommandJobTerminateData) error {
	if !impl.Authenticated {
		return fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.Cmd == nil {
		return fmt.Errorf("job not started")
	}
	log.Printf("JobTerminate called\n")
	return nil
}

func SetupJobManager(clientId string, jobId string, publicKeyBytes []byte) error {
	WshCmdJobManager.ClientId = clientId
	WshCmdJobManager.JobId = jobId
	WshCmdJobManager.JwtPublicKey = publicKeyBytes
	err := wavejwt.SetPublicKey(publicKeyBytes)
	if err != nil {
		return fmt.Errorf("failed to set public key: %w", err)
	}
	err = MakeJobDomainSocket(clientId, jobId)
	if err != nil {
		return err
	}
	return nil
}

func MakeJobDomainSocket(clientId string, jobId string) error {
	homeDir := wavebase.GetHomeDir()
	socketDir := filepath.Join(homeDir, ".waveterm", "jobs", clientId)
	err := os.MkdirAll(socketDir, 0700)
	if err != nil {
		return fmt.Errorf("failed to create socket directory: %w", err)
	}

	socketPath := filepath.Join(socketDir, fmt.Sprintf("%s.sock", jobId))

	os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("failed to listen on domain socket: %w", err)
	}

	go func() {
		defer func() {
			panichandler.PanicHandler("MakeJobDomainSocket:accept", recover())
			listener.Close()
			os.Remove(socketPath)
		}()
		for {
			conn, err := listener.Accept()
			if err != nil {
				log.Printf("error accepting connection: %v\n", err)
				return
			}
			go handleJobDomainSocketClient(conn)
		}
	}()

	return nil
}

func handleJobDomainSocketClient(conn net.Conn) {
	inputCh := make(chan baseds.RpcInputChType, wshutil.DefaultInputChSize)
	outputCh := make(chan []byte, wshutil.DefaultOutputChSize)

	serverImpl := &JobServerImpl{}
	rpcCtx := wshrpc.RpcContext{}
	wshRpc := wshutil.MakeWshRpcWithChannels(inputCh, outputCh, rpcCtx, serverImpl, "job-domain")

	go func() {
		defer func() {
			panichandler.PanicHandler("handleJobDomainSocketClient:AdaptOutputChToStream", recover())
		}()
		writeErr := wshutil.AdaptOutputChToStream(outputCh, conn)
		if writeErr != nil {
			log.Printf("error writing to domain socket: %v\n", writeErr)
		}
	}()

	go func() {
		defer func() {
			panichandler.PanicHandler("handleJobDomainSocketClient:AdaptStreamToMsgCh", recover())
		}()
		defer func() {
			conn.Close()
			close(inputCh)
		}()
		wshutil.AdaptStreamToMsgCh(conn, inputCh)
	}()

	_ = wshRpc
}
