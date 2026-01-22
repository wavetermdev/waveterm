// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"path/filepath"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/suggestion"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type JobManagerConnection struct {
	JobId     string
	Conn      net.Conn
	WshRpc    *wshutil.WshRpc
	CleanupFn func()
}

type ServerImpl struct {
	LogWriter     io.Writer
	Router        *wshutil.WshRouter
	RpcClient     *wshutil.WshRpc
	IsLocal       bool
	JobManagerMap map[string]*JobManagerConnection
	Lock          sync.Mutex
}

func MakeRemoteRpcServerImpl(logWriter io.Writer, router *wshutil.WshRouter, rpcClient *wshutil.WshRpc, isLocal bool) *ServerImpl {
	return &ServerImpl{
		LogWriter:     logWriter,
		Router:        router,
		RpcClient:     rpcClient,
		IsLocal:       isLocal,
		JobManagerMap: make(map[string]*JobManagerConnection),
	}
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
