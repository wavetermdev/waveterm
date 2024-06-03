// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshprc

import (
	"context"
)

const (
	MaxOpenRpcs        = 10
	MaxUnackedPerRpc   = 10
	MaxInFlightPackets = MaxOpenRpcs * MaxUnackedPerRpc
)

const (
	RpcType_Req  = "req"
	RpcType_Resp = "resp"
)

const (
	CommandType_Ack     = ":ack"
	CommandType_Ping    = ":ping"
	CommandType_Cancel  = ":cancel"
	CommandType_Timeout = ":timeout"
)

var rpcClientContextKey = struct{}{}

type TimeoutInfo struct {
	Deadline          int64 `json:"deadline,omitempty"`
	ReqPacketTimeout  int64 `json:"reqpackettimeout,omitempty"`  // for streaming requests
	RespPacketTimeout int64 `json:"resppackettimeout,omitempty"` // for streaming responses
}

type RpcPacket struct {
	Command  string       `json:"command"`
	RpcId    string       `json:"rpcid"`
	RpcType  string       `json:"rpctype"`
	SeqNum   int64        `json:"seqnum"`
	ReqDone  bool         `json:"reqdone"`
	RespDone bool         `json:"resdone"`
	Acks     []int64      `json:"acks,omitempty"`    // seqnums acked
	Timeout  *TimeoutInfo `json:"timeout,omitempty"` // for initial request only
	Data     any          `json:"data"`              // json data for command
	Error    string       `json:"error,omitempty"`
}

func GetRpcClient(ctx context.Context) *RpcClient {
	if ctx == nil {
		return nil
	}
	val := ctx.Value(rpcClientContextKey)
	if val == nil {
		return nil
	}
	return val.(*RpcClient)
}
