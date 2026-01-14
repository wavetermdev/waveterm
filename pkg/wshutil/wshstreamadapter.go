// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WshRpcStreamClientAdapter struct {
	rpc *WshRpc
}

func (a *WshRpcStreamClientAdapter) StreamDataAckCommand(data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	return a.rpc.SendCommand("streamdataack", data, opts)
}

func (a *WshRpcStreamClientAdapter) StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	return a.rpc.SendCommand("streamdata", data, opts)
}

func AdaptWshRpc(rpc *WshRpc) *WshRpcStreamClientAdapter {
	return &WshRpcStreamClientAdapter{rpc: rpc}
}
