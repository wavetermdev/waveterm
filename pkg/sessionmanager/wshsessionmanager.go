// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionmanager

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var (
	sessionManagerClient_Once      sync.Once
	sessionManagerClient_Singleton *wshutil.WshRpc
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

	termSize := waveobj.TermSize{Rows: 25, Cols: 80}
	if data.TermSize != nil {
		termSize = *data.TermSize
	}

	pid, err := sm.StartProc(data.Cmd, data.Args, data.Env, termSize)
	if err != nil {
		return nil, err
	}

	impl.Log("[startproc] started process pid=%d\n", pid)

	return &wshrpc.CommandSessionManagerStartProcRtnData{
		Success: true,
		Message: fmt.Sprintf("process started with pid %d", pid),
	}, nil
}

func (impl *ServerImpl) SessionManagerStopProcCommand(ctx context.Context) error {
	impl.Log("[stopproc] stopping process\n")

	sm := GetSessionManager()
	cmd, cmdPty := sm.GetCmd()
	if cmd != nil && cmd.Process != nil {
		err := cmd.Process.Kill()
		if err != nil {
			impl.Log("[stopproc] error killing process: %v\n", err)
		} else {
			impl.Log("[stopproc] process killed\n")
		}
	}
	if cmdPty != nil {
		cmdPty.Close()
	}
	sm.SetCmd(nil, nil)

	impl.Log("[stopproc] shutting down in %v\n", ShutdownDelayTime)

	go func() {
		time.Sleep(ShutdownDelayTime)
		sm.Cleanup()
		os.Exit(0)
	}()

	return nil
}

func (impl *ServerImpl) SessionManagerInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
	sm := GetSessionManager()
	if sm == nil {
		return fmt.Errorf("session manager not initialized")
	}
	return sm.HandleInput(data)
}

func GetSessionManagerRpcClient() *wshutil.WshRpc {
	sessionManagerClient_Once.Do(func() {
		sessionManagerClient_Singleton = wshutil.MakeWshRpc(
			wshrpc.RpcContext{},
			&ServerImpl{},
			"sessionmanager-client",
		)
	})
	return sessionManagerClient_Singleton
}

func registerSessionManagerRoute() {
	rpc := GetSessionManagerRpcClient()
	_, err := wshutil.DefaultRouter.RegisterTrustedLeaf(rpc, wshutil.DefaultRoute)
	if err != nil {
		log.Printf("error registering session manager route: %v\n", err)
	}
}
