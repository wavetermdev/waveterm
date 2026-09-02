// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WshRpcStreamClientAdapter struct {
	rpc *WshRpc
}

// AckSendTimeoutMs is the fail-fast enqueue timeout for stream ACKs.
// A full OutputCh must not block the broker send worker for DefaultTimeoutMs
// (5s); the broker retries the latest coalesced ACK instead.
const AckSendTimeoutMs = 10

func (a *WshRpcStreamClientAdapter) StreamDataAckCommand(data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	var optsCopy wshrpc.RpcOpts
	if opts != nil {
		optsCopy = *opts
	}
	optsCopy.NoResponse = true
	if optsCopy.Timeout <= 0 {
		optsCopy.Timeout = AckSendTimeoutMs
	}
	handler, err := a.rpc.SendComplexRequest("streamdataack", data, &optsCopy)
	if handler != nil {
		handler.finalize()
	}
	return err
}

func (a *WshRpcStreamClientAdapter) StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	return a.rpc.SendCommand("streamdata", data, opts)
}

func AdaptWshRpc(rpc *WshRpc) *WshRpcStreamClientAdapter {
	return &WshRpcStreamClientAdapter{rpc: rpc}
}
