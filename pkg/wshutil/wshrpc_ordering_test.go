// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type orderTestServer struct {
	mu  sync.Mutex
	got []int
}

func (s *orderTestServer) WshServerImpl() {}

func (s *orderTestServer) ControllerInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
	// Earlier messages take longer, so concurrent handling records them out of order.
	idx, _ := strconv.Atoi(data.InputData64)
	time.Sleep(time.Duration(6-(idx%6)) * time.Millisecond)
	s.mu.Lock()
	s.got = append(s.got, idx)
	s.mu.Unlock()
	return nil
}

func (s *orderTestServer) results() []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]int(nil), s.got...)
}

func TestControllerInputOrdering(t *testing.T) {
	const n = 40
	inputCh := make(chan baseds.RpcInputChType, n*2)
	outputCh := make(chan []byte, n*2)
	srv := &orderTestServer{}
	MakeWshRpcWithChannels(inputCh, outputCh, wshrpc.RpcContext{Conn: "test"}, srv, "ordertest")

	go func() {
		for range outputCh {
		}
	}()

	for i := 0; i < n; i++ {
		payload, err := json.Marshal(wshrpc.CommandBlockInputData{BlockId: "b", InputData64: fmt.Sprintf("%03d", i)})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		msg := RpcMessage{Command: wshrpc.Command_ControllerInput, ReqId: fmt.Sprintf("req-%d", i), Data: json.RawMessage(payload)}
		b, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("marshal msg: %v", err)
		}
		inputCh <- baseds.RpcInputChType{MsgBytes: b}
	}

	deadline := time.Now().Add(10 * time.Second)
	for len(srv.results()) < n && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}

	got := srv.results()
	if len(got) != n {
		t.Fatalf("expected %d handled inputs, got %d", n, len(got))
	}
	for i := range got {
		if got[i] != i {
			t.Fatalf("input order broken at %d: got %v", i, got)
		}
	}
}
