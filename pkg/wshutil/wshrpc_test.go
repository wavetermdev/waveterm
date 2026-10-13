// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestSendOnClosedOutputReturnsError(t *testing.T) {
	outputCh := make(chan []byte)
	w := MakeWshRpcWithChannels(nil, outputCh, wshrpc.RpcContext{}, nil, "test")
	// same state a sender sees when the connection closes while it is blocked on OutputCh
	close(outputCh)

	err := w.SendCommand("test", nil, nil)
	if err == nil {
		t.Error("Expected an error when sending on a closed connection")
	}
	_, err = w.SendRpcRequest("test", nil, nil)
	if err == nil {
		t.Error("Expected an error when sending on a closed connection")
	}
}
