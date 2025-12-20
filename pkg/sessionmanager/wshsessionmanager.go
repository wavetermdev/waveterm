// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionmanager

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var (
	sessionManagerClient_Once      sync.Once
	sessionManagerClient_Singleton *wshutil.WshRpc
)

const (
	DefaultInputChSize  = 32
	DefaultOutputChSize = 32
)

type ServerImpl struct {
	LogWriter io.Writer
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

func (impl *ServerImpl) SessionManagerStartProcCommand(ctx context.Context, data wshrpc.CommandSessionManagerStartProcData) (*wshrpc.CommandSessionManagerStartProcRtnData, error) {
	impl.Log("[startproc] cmd=%q args=%v\n", data.Cmd, data.Args)
	
	sm := GetSessionManager()
	if sm == nil {
		return &wshrpc.CommandSessionManagerStartProcRtnData{
			Success: false,
			Message: "session manager not initialized",
		}, nil
	}
	
	cmd := exec.Command(data.Cmd, data.Args...)
	if len(data.Env) > 0 {
		cmd.Env = os.Environ()
		for key, val := range data.Env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, val))
		}
	}
	
	err := cmd.Start()
	if err != nil {
		return &wshrpc.CommandSessionManagerStartProcRtnData{
			Success: false,
			Message: fmt.Sprintf("failed to start command: %v", err),
		}, nil
	}
	
	sm.SetCmd(cmd)
	impl.Log("[startproc] started process pid=%d\n", cmd.Process.Pid)
	
	return &wshrpc.CommandSessionManagerStartProcRtnData{
		Success: true,
		Message: fmt.Sprintf("process started with pid %d", cmd.Process.Pid),
	}, nil
}

func GetSessionManagerRpcClient() *wshutil.WshRpc {
	sessionManagerClient_Once.Do(func() {
		inputCh := make(chan []byte, DefaultInputChSize)
		outputCh := make(chan []byte, DefaultOutputChSize)
		sessionManagerClient_Singleton = wshutil.MakeWshRpc(
			inputCh,
			outputCh,
			wshrpc.RpcContext{},
			&ServerImpl{},
			"sessionmanager-client",
		)
	})
	return sessionManagerClient_Singleton
}

func registerSessionManagerRoute() {
	rpc := GetSessionManagerRpcClient()
	wshutil.DefaultRouter.RegisterRoute(wshutil.DefaultRoute, rpc, true)
}
