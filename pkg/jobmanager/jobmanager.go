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
	"sync"
	"sync/atomic"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var WshCmdJobManager JobManager

type JobManager struct {
	ClientId              string
	JobId                 string
	Cmd                   *JobCmd
	JwtPublicKey          []byte
	JobAuthToken          string
	StreamManager         *StreamManager
	lock                  sync.Mutex
	attachedClient        *JobServerImpl
	connectedStreamClient *JobServerImpl
}

type JobServerImpl struct {
	PeerAuthenticated atomic.Bool
	SelfAuthenticated atomic.Bool
	WshRpc            *wshutil.WshRpc
	Conn              net.Conn
	inputCh           chan baseds.RpcInputChType
	closeOnce         sync.Once
}

func (*JobServerImpl) WshServerImpl() {}

func (impl *JobServerImpl) Close() {
	impl.closeOnce.Do(func() {
		impl.Conn.Close()
		close(impl.inputCh)
	})
}

type routedDataSender struct {
	wshRpc *wshutil.WshRpc
	route  string
}

func (rds *routedDataSender) SendData(dataPk wshrpc.CommandStreamData) {
	err := wshclient.StreamDataCommand(rds.wshRpc, dataPk, &wshrpc.RpcOpts{NoResponse: true, Route: rds.route})
	if err != nil {
		log.Printf("SendData: error sending stream data: %v\n", err)
	}
}

func (jm *JobManager) GetJobAuthInfo() (string, string) {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	return jm.JobId, jm.JobAuthToken
}

func (jm *JobManager) IsJobStarted() bool {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	return jm.Cmd != nil
}

func (impl *JobServerImpl) authenticateSelfToServer(jobAuthToken string) error {
	jobId, _ := WshCmdJobManager.GetJobAuthInfo()
	authData := wshrpc.CommandAuthenticateJobManagerData{
		JobId:        jobId,
		JobAuthToken: jobAuthToken,
	}
	err := wshclient.AuthenticateJobManagerCommand(impl.WshRpc, authData, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		log.Printf("authenticateSelfToServer: failed to authenticate to server: %v\n", err)
		return fmt.Errorf("failed to authenticate to server: %w", err)
	}
	impl.SelfAuthenticated.Store(true)
	log.Printf("authenticateSelfToServer: successfully authenticated to server\n")
	return nil
}

func (impl *JobServerImpl) AuthenticateToJobManagerCommand(ctx context.Context, data wshrpc.CommandAuthenticateToJobData) error {
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
	impl.PeerAuthenticated.Store(true)
	log.Printf("AuthenticateToJobManager: authentication successful for JobId=%s\n", claims.JobId)

	if jobAuthToken != "" {
		err = impl.authenticateSelfToServer(jobAuthToken)
		if err != nil {
			impl.PeerAuthenticated.Store(false)
			return err
		}
	}

	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if WshCmdJobManager.attachedClient != nil {
		log.Printf("AuthenticateToJobManager: kicking out existing client\n")
		WshCmdJobManager.attachedClient.Close()
	}
	WshCmdJobManager.attachedClient = impl
	return nil
}

func (jm *JobManager) connectToStreamHelper_withlock(jobServerImpl *JobServerImpl, streamMeta wshrpc.StreamMeta, seq int64) (int64, error) {
	rwndSize := int(streamMeta.RWnd)
	if rwndSize < 0 {
		return 0, fmt.Errorf("invalid rwnd size: %d", rwndSize)
	}

	if jm.connectedStreamClient != nil {
		log.Printf("connectToStreamHelper: disconnecting existing client\n")
		jm.StreamManager.ClientDisconnected()
		jm.connectedStreamClient = nil
	}
	dataSender := &routedDataSender{
		wshRpc: jobServerImpl.WshRpc,
		route:  streamMeta.ReaderRouteId,
	}
	serverSeq, err := jm.StreamManager.ClientConnected(
		streamMeta.Id,
		dataSender,
		rwndSize,
		seq,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to connect client: %w", err)
	}
	jm.connectedStreamClient = jobServerImpl
	return serverSeq, nil
}

func (jm *JobManager) disconnectFromStreamHelper(jobServerImpl *JobServerImpl) {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	if jm.connectedStreamClient == nil || jm.connectedStreamClient != jobServerImpl {
		return
	}
	jm.StreamManager.ClientDisconnected()
	jm.connectedStreamClient = nil
}

func (impl *JobServerImpl) StartJobCommand(ctx context.Context, data wshrpc.CommandStartJobData) (*wshrpc.CommandStartJobRtnData, error) {
	if !impl.PeerAuthenticated.Load() {
		return nil, fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.IsJobStarted() {
		return nil, fmt.Errorf("job already started")
	}

	err := impl.authenticateSelfToServer(data.JobAuthToken)
	if err != nil {
		return nil, err
	}

	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if WshCmdJobManager.Cmd != nil {
		// we must re-check this with the lock for proper sync
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

	if data.StreamMeta != nil {
		serverSeq, err := WshCmdJobManager.connectToStreamHelper_withlock(impl, *data.StreamMeta, 0)
		if err != nil {
			return nil, fmt.Errorf("failed to connect stream: %w", err)
		}
		log.Printf("StartJob: connected stream streamid=%s serverSeq=%d\n", data.StreamMeta.Id, serverSeq)
	}

	_, cmdPty := jobCmd.GetCmd()
	if cmdPty != nil {
		err = WshCmdJobManager.StreamManager.AttachReader(cmdPty)
		if err != nil {
			return nil, fmt.Errorf("failed to attach reader to stream manager: %w", err)
		}
	}

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

func (impl *JobServerImpl) JobConnectCommand(ctx context.Context, data wshrpc.CommandJobConnectData) (*wshrpc.CommandJobConnectRtnData, error) {
	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if !impl.PeerAuthenticated.Load() {
		return nil, fmt.Errorf("peer not authenticated")
	}
	if !impl.SelfAuthenticated.Load() {
		return nil, fmt.Errorf("not authenticated to server")
	}
	if WshCmdJobManager.Cmd == nil {
		return nil, fmt.Errorf("job not started")
	}

	serverSeq, err := WshCmdJobManager.connectToStreamHelper_withlock(impl, data.StreamMeta, data.Seq)
	if err != nil {
		return nil, err
	}

	log.Printf("JobConnect: streamid=%s clientSeq=%d serverSeq=%d\n", data.StreamMeta.Id, data.Seq, serverSeq)
	return &wshrpc.CommandJobConnectRtnData{Seq: serverSeq}, nil
}

func (impl *JobServerImpl) StreamDataAckCommand(ctx context.Context, data wshrpc.CommandStreamAckData) error {
	// bad acks do NOT get error packets created (to avoid infinite loops).
	// they should be silently ignored
	if !impl.PeerAuthenticated.Load() {
		return nil
	}
	if !impl.SelfAuthenticated.Load() {
		return nil
	}
	// this is safe without locking because streamids are unique, and StreamManager will ignore an ack
	// when not connected or when the streamid does not match
	WshCmdJobManager.StreamManager.RecvAck(data)
	return nil
}

func (impl *JobServerImpl) JobTerminateCommand(ctx context.Context, data wshrpc.CommandJobTerminateData) error {
	WshCmdJobManager.lock.Lock()
	defer WshCmdJobManager.lock.Unlock()

	if !impl.PeerAuthenticated.Load() {
		return fmt.Errorf("not authenticated")
	}
	if WshCmdJobManager.Cmd == nil {
		return fmt.Errorf("job not started")
	}
	log.Printf("JobTerminate called\n")
	WshCmdJobManager.Cmd.Terminate()
	return nil
}

func SetupJobManager(clientId string, jobId string, publicKeyBytes []byte) error {
	WshCmdJobManager.ClientId = clientId
	WshCmdJobManager.JobId = jobId
	WshCmdJobManager.JwtPublicKey = publicKeyBytes
	WshCmdJobManager.StreamManager = MakeStreamManager()
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

	serverImpl := &JobServerImpl{
		Conn:    conn,
		inputCh: inputCh,
	}
	rpcCtx := wshrpc.RpcContext{}
	wshRpc := wshutil.MakeWshRpcWithChannels(inputCh, outputCh, rpcCtx, serverImpl, "job-domain")
	serverImpl.WshRpc = wshRpc
	defer WshCmdJobManager.disconnectFromStreamHelper(serverImpl)

	go func() {
		defer func() {
			panichandler.PanicHandler("handleJobDomainSocketClient:AdaptOutputChToStream", recover())
		}()
		defer serverImpl.Close()
		writeErr := wshutil.AdaptOutputChToStream(outputCh, conn)
		if writeErr != nil {
			log.Printf("error writing to domain socket: %v\n", writeErr)
		}
	}()

	go func() {
		defer func() {
			panichandler.PanicHandler("handleJobDomainSocketClient:AdaptStreamToMsgCh", recover())
		}()
		defer serverImpl.Close()
		wshutil.AdaptStreamToMsgCh(conn, inputCh)
	}()

	_ = wshRpc
}
