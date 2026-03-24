// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// WriterBridge - used by the writer broker
// Sends data to the pipe, receives acks from the pipe
type WriterBridge struct {
	pipe *DeliveryPipe
}

func (b *WriterBridge) StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	b.pipe.EnqueueData(data)
	return nil
}

func (b *WriterBridge) StreamDataAckCommand(ack wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	return fmt.Errorf("writer bridge should not send acks")
}

// ReaderBridge - used by the reader broker
// Sends acks to the pipe, receives data from the pipe
type ReaderBridge struct {
	pipe *DeliveryPipe
}

func (b *ReaderBridge) StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	return fmt.Errorf("reader bridge should not send data")
}

func (b *ReaderBridge) StreamDataAckCommand(ack wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	b.pipe.EnqueueAck(ack)
	return nil
}
