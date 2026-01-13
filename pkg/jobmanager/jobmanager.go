// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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
	attachedClient        *MainServerConn
	connectedStreamClient *MainServerConn
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

func (jm *JobManager) connectToStreamHelper_withlock(mainServerConn *MainServerConn, streamMeta wshrpc.StreamMeta, seq int64) (int64, error) {
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
		wshRpc: mainServerConn.WshRpc,
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
	jm.connectedStreamClient = mainServerConn
	return serverSeq, nil
}

func (jm *JobManager) disconnectFromStreamHelper(mainServerConn *MainServerConn) {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	if jm.connectedStreamClient == nil || jm.connectedStreamClient != mainServerConn {
		return
	}
	jm.StreamManager.ClientDisconnected()
	jm.connectedStreamClient = nil
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

	serverImpl := &MainServerConn{
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
