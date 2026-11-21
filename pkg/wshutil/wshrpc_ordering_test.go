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
	mu       sync.Mutex
	got      []int
	slowGate chan struct{} // closed to release inputs for block "slow"
	fast     chan int
	messages chan string
}

func (s *orderTestServer) WshServerImpl() {}

func (s *orderTestServer) ControllerInputCommand(ctx context.Context, data wshrpc.CommandBlockInputData) error {
	if data.BlockId == "slow" {
		<-s.slowGate
		return nil
	}
	// Earlier messages take longer, so unordered handling would record them reversed.
	idx, _ := strconv.Atoi(data.InputData64)
	time.Sleep(time.Duration(6-(idx%6)) * time.Millisecond)
	s.mu.Lock()
	s.got = append(s.got, idx)
	s.mu.Unlock()
	if s.fast != nil {
		s.fast <- idx
	}
	return nil
}

func (s *orderTestServer) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	s.messages <- data.Message
	return nil
}

func (s *orderTestServer) results() []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]int(nil), s.got...)
}

func makeTestRpc(t *testing.T, srv ServerImpl) (*WshRpc, chan baseds.RpcInputChType) {
	t.Helper()
	inputCh := make(chan baseds.RpcInputChType, 128)
	outputCh := make(chan []byte, 128)
	w := MakeWshRpcWithChannels(inputCh, outputCh, wshrpc.RpcContext{Conn: "test"}, srv, "ordertest")
	go func() {
		for range outputCh {
		}
	}()
	return w, inputCh
}

func sendInput(t *testing.T, inputCh chan baseds.RpcInputChType, blockId string, idx int) {
	t.Helper()
	payload, err := json.Marshal(wshrpc.CommandBlockInputData{BlockId: blockId, InputData64: fmt.Sprintf("%03d", idx)})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	msg := RpcMessage{Command: wshrpc.Command_ControllerInput, ReqId: fmt.Sprintf("req-%s-%d", blockId, idx), Data: json.RawMessage(payload)}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal msg: %v", err)
	}
	inputCh <- baseds.RpcInputChType{MsgBytes: b}
}

func sendMessage(t *testing.T, inputCh chan baseds.RpcInputChType, text string) {
	t.Helper()
	msg := RpcMessage{Command: wshrpc.Command_Message, Data: map[string]any{"message": text}}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal msg: %v", err)
	}
	inputCh <- baseds.RpcInputChType{MsgBytes: b}
}

func TestControllerInputOrdering(t *testing.T) {
	const n = 40
	srv := &orderTestServer{}
	_, inputCh := makeTestRpc(t, srv)

	for i := 0; i < n; i++ {
		sendInput(t, inputCh, "b", i)
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

// A terminal that stops consuming input must not stall other terminals, and must not
// stall protocol demultiplexing in the read loop.
func TestOrderedInputIsPerTerminal(t *testing.T) {
	srv := &orderTestServer{
		slowGate: make(chan struct{}),
		fast:     make(chan int, 8),
		messages: make(chan string, 8),
	}
	_, inputCh := makeTestRpc(t, srv)

	sendInput(t, inputCh, "slow", 0)
	sendInput(t, inputCh, "slow", 1)

	for i := 0; i < 4; i++ {
		sendInput(t, inputCh, "fast", i)
	}
	sendMessage(t, inputCh, "ping")

	// "slow" is blocked inside its handler; "fast" and the message must still flow.
	for i := 0; i < 4; i++ {
		select {
		case <-srv.fast:
		case <-time.After(3 * time.Second):
			t.Fatalf("fast terminal stalled behind slow terminal at %d", i)
		}
	}
	select {
	case msg := <-srv.messages:
		if msg != "ping" {
			t.Fatalf("unexpected message %q", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("read loop stalled while terminal input was blocked")
	}

	close(srv.slowGate)
}
