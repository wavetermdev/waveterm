// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshclient

import (
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

func sendRpcRequestHelper[T any](w *wshutil.WshRpc, command string, data interface{}, opts *wshrpc.WshRpcCommandOpts) (T, error) {
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
