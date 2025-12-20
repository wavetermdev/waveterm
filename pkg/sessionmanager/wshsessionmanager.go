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
	"time"

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
		return nil, fmt.Errorf("session manager not initialized")
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
		return nil, fmt.Errorf("failed to start command: %w", err)
	}
	
	sm.SetCmd(cmd)
	impl.Log("[startproc] started process pid=%d\n", cmd.Process.Pid)
	
	return &wshrpc.CommandSessionManagerStartProcRtnData{
		Success: true,
		Message: fmt.Sprintf("process started with pid %d", cmd.Process.Pid),
	}, nil
}

func (impl *ServerImpl) SessionManagerStopProcCommand(ctx context.Context) error {
	impl.Log("[stopproc] stopping process\n")
	
	sm := GetSessionManager()
	cmd := sm.GetCmd()
	if cmd != nil && cmd.Process != nil {
		err := cmd.Process.Kill()
		if err != nil {
			impl.Log("[stopproc] error killing process: %v\n", err)
		} else {
			impl.Log("[stopproc] process killed\n")
		}
	}
	sm.SetCmd(nil)
	
	impl.Log("[stopproc] shutting down in %v\n", ShutdownDelayTime)
	
	go func() {
		time.Sleep(ShutdownDelayTime)
		sm.Cleanup()
		os.Exit(0)
	}()
	
	return nil
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
