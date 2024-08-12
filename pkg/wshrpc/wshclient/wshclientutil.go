// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshclient

import (
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

func sendRpcRequestCallHelper[T any](w *wshutil.WshRpc, command string, data interface{}, opts *wshrpc.WshRpcCommandOpts) (T, error) {
	if opts == nil {
		opts = &wshrpc.WshRpcCommandOpts{}
	}
	var respData T
	if opts.NoResponse {
		err := w.SendCommand(command, data)
		if err != nil {
			return respData, err
		}
		return respData, nil
	}
	resp, err := w.SendRpcRequest(command, data, opts.Timeout)
	if err != nil {
		return respData, err
	}
	err = utilfn.ReUnmarshal(&respData, resp)
	if err != nil {
		return respData, err
	}
	return respData, nil
}

func sendRpcRequestResponseStreamHelper[T any](w *wshutil.WshRpc, command string, data interface{}, opts *wshrpc.WshRpcCommandOpts) chan wshrpc.RespOrErrorUnion[T] {
	if opts == nil {
		opts = &wshrpc.WshRpcCommandOpts{}
	}
	respChan := make(chan wshrpc.RespOrErrorUnion[T])
	reqHandler, err := w.SendComplexRequest(command, data, true, opts.Timeout)
	if err != nil {
		go func() {
			respChan <- wshrpc.RespOrErrorUnion[T]{Error: err}
			close(respChan)
		}()
	} else {
		go func() {
			defer close(respChan)
			for {
				if reqHandler.ResponseDone() {
					break
				}
				resp, err := reqHandler.NextResponse()
				if err != nil {
					respChan <- wshrpc.RespOrErrorUnion[T]{Error: err}
					break
				}
				var respData T
				err = utilfn.ReUnmarshal(&respData, resp)
				if err != nil {
					respChan <- wshrpc.RespOrErrorUnion[T]{Error: err}
					break
				}
				respChan <- wshrpc.RespOrErrorUnion[T]{Response: respData}
			}
		}()
	}
	return respChan
}
