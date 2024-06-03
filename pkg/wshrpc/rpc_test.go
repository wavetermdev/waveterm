// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshprc

import (
	"context"
	"fmt"
	"log"
	"sync"
	"testing"
	"time"
)

func TestSimple(t *testing.T) {
	sendCh := make(chan *RpcPacket, MaxInFlightPackets)
	recvCh := make(chan *RpcPacket, MaxInFlightPackets)
	client := MakeRpcClient(sendCh, recvCh)
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		resp, err := client.SimpleReq(ctx, "test", "hello")
		if err != nil {
			t.Errorf("SimpleReq() failed: %v", err)
			return
		}
		if resp != "world" {
			t.Errorf("SimpleReq() failed: expected 'world', got '%s'", resp)
		}
	}()
	go func() {
		defer wg.Done()
		req := <-sendCh
		if req.Command != "test" {
			t.Errorf("expected 'test', got '%s'", req.Command)
		}
		if req.Data != "hello" {
			t.Errorf("expected 'hello', got '%s'", req.Data)
		}
		resp := &RpcPacket{
			Command:  "test",
			RpcId:    req.RpcId,
			RpcType:  RpcType_Resp,
			SeqNum:   1,
			RespDone: true,
			Acks:     []int64{req.SeqNum},
			Data:     "world",
		}
		recvCh <- resp
	}()
	wg.Wait()
}

func makeRpcResp(req *RpcPacket, data any, seqNum int64, done bool) *RpcPacket {
	return &RpcPacket{
		Command:  req.Command,
		RpcId:    req.RpcId,
		RpcType:  RpcType_Resp,
		SeqNum:   seqNum,
		RespDone: done,
		Data:     data,
	}
}

func TestStream(t *testing.T) {
	sendCh := make(chan *RpcPacket, MaxInFlightPackets)
	recvCh := make(chan *RpcPacket, MaxInFlightPackets)
	client := MakeRpcClient(sendCh, recvCh)
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		respCh, err := client.StreamReq(ctx, "test", "hello", 1000)
		if err != nil {
			t.Errorf("StreamReq() failed: %v", err)
			return
		}
		var output []string
		for resp := range respCh {
			if resp.Error != "" {
				t.Errorf("StreamReq() failed: %v", resp.Error)
				return
			}
			output = append(output, resp.Data.(string))
		}
		if len(output) != 3 {
			t.Errorf("expected 3 responses, got %d (%v)", len(output), output)
			return
		}
		if output[0] != "one" || output[1] != "two" || output[2] != "three" {
			t.Errorf("expected 'one', 'two', 'three', got %v", output)
			return
		}
	}()
	go func() {
		defer wg.Done()
		req := <-sendCh
		if req.Command != "test" {
			t.Errorf("expected 'test', got '%s'", req.Command)
		}
		if req.Data != "hello" {
			t.Errorf("expected 'hello', got '%s'", req.Data)
		}
		resp := makeRpcResp(req, "one", 1, false)
		recvCh <- resp
		resp = makeRpcResp(req, "two", 2, false)
		recvCh <- resp
		resp = makeRpcResp(req, "three", 3, true)
		recvCh <- resp
	}()
	wg.Wait()
}

func TestSimpleClientServer(t *testing.T) {
	sendCh := make(chan *RpcPacket, MaxInFlightPackets)
	recvCh := make(chan *RpcPacket, MaxInFlightPackets)
	client := MakeRpcClient(sendCh, recvCh)
	server := MakeRpcServer(recvCh, sendCh)
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	server.RegisterSimpleCommandHandler("test", func(ctx context.Context, s *RpcServer, cmd string, data any) (any, error) {
		if data != "hello" {
			return nil, fmt.Errorf("expected 'hello', got '%s'", data)
		}
		return "world", nil
	})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		resp, err := client.SimpleReq(ctx, "test", "hello")
		if err != nil {
			t.Errorf("SimpleReq() failed: %v", err)
			return
		}
		if resp != "world" {
			t.Errorf("SimpleReq() failed: expected 'world', got '%s'", resp)
		}
	}()
	wg.Wait()

}

func TestStreamClientServer(t *testing.T) {
	sendCh := make(chan *RpcPacket, MaxInFlightPackets)
	recvCh := make(chan *RpcPacket, MaxInFlightPackets)
	client := MakeRpcClient(sendCh, recvCh)
	server := MakeRpcServer(recvCh, sendCh)
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	server.RegisterStreamCommandHandler("test", func(ctx context.Context, s *RpcServer, req *RpcPacket) error {
		pk1 := s.makeRespPk(req, "one", false)
		pk2 := s.makeRespPk(req, "two", false)
		pk3 := s.makeRespPk(req, "three", true)
		s.SendResponse(ctx, pk1)
		s.SendResponse(ctx, pk2)
		s.SendResponse(ctx, pk3)
		return nil
	})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		respCh, err := client.StreamReq(ctx, "test", "hello", 2*time.Second)
		if err != nil {
			t.Errorf("StreamReq() failed: %v", err)
			return
		}
		var result []string
		for respPk := range respCh {
			if respPk.Error != "" {
				t.Errorf("StreamReq() failed: %v", respPk.Error)
				return
			}
			log.Printf("got response: %#v", respPk)
			result = append(result, respPk.Data.(string))
		}
		if len(result) != 3 {
			t.Errorf("expected 3 responses, got %d", len(result))
			return
		}
		if result[0] != "one" || result[1] != "two" || result[2] != "three" {
			t.Errorf("expected 'one', 'two', 'three', got %v", result)
			return
		}
	}()
	wg.Wait()

}
