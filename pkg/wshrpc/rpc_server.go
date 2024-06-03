// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshprc

import (
	"context"
	"fmt"
	"log"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"
)

type SimpleCommandHandlerFn func(context.Context, *RpcServer, string, any) (any, error)
type StreamCommandHandlerFn func(context.Context, *RpcServer, string, any) error

type RpcServer struct {
	CVar                  *sync.Cond
	NextSeqNum            *atomic.Int64
	RespPacketsInFlight   map[int64]string // seqnum -> rpcId
	AckList               []int64
	RpcReqs               map[string]*RpcInfo
	SendCh                chan *RpcPacket
	RecvCh                chan *RpcPacket
	SimpleCommandHandlers map[string]SimpleCommandHandlerFn
	StreamCommandHandlers map[string]StreamCommandHandlerFn
}

func MakeRpcServer(sendCh chan *RpcPacket, recvCh chan *RpcPacket) *RpcServer {
	if cap(sendCh) < MaxInFlightPackets {
		panic(fmt.Errorf("sendCh buffer size must be at least MaxInFlightPackets(%d)", MaxInFlightPackets))
	}
	rtn := &RpcServer{
		CVar:                sync.NewCond(&sync.Mutex{}),
		NextSeqNum:          &atomic.Int64{},
		RespPacketsInFlight: make(map[int64]string),
		AckList:             nil,
		RpcReqs:             make(map[string]*RpcInfo),
		SendCh:              sendCh,
		RecvCh:              recvCh,
	}
	go rtn.runRecvLoop()
	return rtn
}

func (s *RpcServer) RegisterSimpleCommandHandler(command string, handler SimpleCommandHandlerFn) {
	s.CVar.L.Lock()
	defer s.CVar.L.Unlock()
	s.SimpleCommandHandlers[command] = handler
}

func (s *RpcServer) RegisterStreamCommandHandler(command string, handler StreamCommandHandlerFn) {
	s.CVar.L.Lock()
	defer s.CVar.L.Unlock()
	s.StreamCommandHandlers[command] = handler
}

func (s *RpcServer) runRecvLoop() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("RpcServer.runRecvLoop() panic: %v", r)
			debug.PrintStack()
		}
	}()
	for pk := range s.RecvCh {
		s.handleAcks(pk.Acks)
		if pk.RpcType == RpcType_Req {
			if pk.ReqDone {
				s.handleSimpleReq(pk)
			} else {
				s.handleStreamReq(pk)
			}
			continue
		}
		log.Printf("RpcClient.runRecvLoop() bad packet type: %v", pk)
	}
	log.Printf("RpcServer.runRecvLoop() normal exit")
}

func (s *RpcServer) ackResp(seqNum int64) {
	if seqNum == 0 {
		return
	}
	s.CVar.L.Lock()
	defer s.CVar.L.Unlock()
	s.AckList = append(s.AckList, seqNum)
}

func makeContextFromTimeout(timeout *TimeoutInfo) (context.Context, context.CancelFunc) {
	if timeout == nil {
		return context.Background(), func() {}
	}
	return context.WithDeadline(context.Background(), time.UnixMilli(timeout.Deadline))
}

func (s *RpcServer) SendResponse(ctx context.Context, pk *RpcPacket) error {
	return s.waitForSend(ctx, pk)
}

func (s *RpcServer) waitForSend(ctx context.Context, pk *RpcPacket) error {
	s.CVar.L.Lock()
	defer s.CVar.L.Unlock()
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if len(s.RespPacketsInFlight) >= MaxInFlightPackets {
			s.CVar.Wait()
			continue
		}
		rpcInfo := s.RpcReqs[pk.RpcId]
		if rpcInfo != nil {
			if len(rpcInfo.PacketsInFlight) >= MaxUnackedPerRpc {
				s.CVar.Wait()
				continue
			}
		}
		break
	}
	s.RespPacketsInFlight[pk.SeqNum] = pk.RpcId
	pk.Acks = s.grabAcks_nolock()
	s.SendCh <- pk
	rpcInfo := s.RpcReqs[pk.RpcId]
	if !pk.RespDone && rpcInfo != nil {
		rpcInfo = &RpcInfo{
			CloseSync:       &sync.Once{},
			RpcId:           pk.RpcId,
			PkCh:            make(chan *RpcPacket, MaxUnackedPerRpc),
			PacketsInFlight: make(map[int64]bool),
		}
		s.RpcReqs[pk.RpcId] = rpcInfo
	}
	if rpcInfo != nil {
		rpcInfo.PacketsInFlight[pk.SeqNum] = true
	}
	if pk.RespDone {
		delete(s.RpcReqs, pk.RpcId)
	}
	return nil
}

func (s *RpcServer) handleAcks(acks []int64) {
	if len(acks) == 0 {
		return
	}
	s.CVar.L.Lock()
	defer s.CVar.L.Unlock()
	for _, ack := range acks {
		rpcId, ok := s.RespPacketsInFlight[ack]
		if !ok {
			continue
		}
		rpcInfo := s.RpcReqs[rpcId]
		if rpcInfo != nil {
			delete(rpcInfo.PacketsInFlight, ack)
		}
		delete(s.RespPacketsInFlight, ack)
	}
	s.CVar.Broadcast()
}

func (s *RpcServer) handleSimpleReq(pk *RpcPacket) {
	s.ackResp(pk.SeqNum)
	handler, ok := s.SimpleCommandHandlers[pk.Command]
	if !ok {
		log.Printf("RpcServer.handleReq() unknown command: %s", pk.Command)
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("RpcServer.handleReq(%q) panic: %v", pk.Command, r)
				debug.PrintStack()
			}
		}()
		ctx, cancelFn := makeContextFromTimeout(pk.Timeout)
		defer cancelFn()
		data, err := handler(ctx, s, pk.Command, pk.Data)
		seqNum := s.NextSeqNum.Add(1)
		respPk := &RpcPacket{
			Command:  pk.Command,
			RpcId:    pk.RpcId,
			RpcType:  RpcType_Resp,
			SeqNum:   seqNum,
			RespDone: true,
		}
		if err != nil {
			respPk.Error = err.Error()
		} else {
			respPk.Data = data
		}
		s.waitForSend(ctx, respPk)
	}()
}

func (s *RpcServer) grabAcks_nolock() []int64 {
	acks := s.AckList
	s.AckList = nil
	return acks
}

func (s *RpcServer) handleStreamReq(pk *RpcPacket) {
	s.ackResp(pk.SeqNum)
	handler, ok := s.StreamCommandHandlers[pk.Command]
	if !ok {
		s.ackResp(pk.SeqNum)
		log.Printf("RpcServer.handleStreamReq() unknown command: %s", pk.Command)
		return
	}
	go func() {
		defer func() {
			r := recover()
			if r == nil {
				return
			}
			log.Printf("RpcServer.handleStreamReq(%q) panic: %v", pk.Command, r)
			debug.PrintStack()
			respPk := &RpcPacket{
				Command:  pk.Command,
				RpcId:    pk.RpcId,
				RpcType:  RpcType_Resp,
				SeqNum:   s.NextSeqNum.Add(1),
				RespDone: true,
				Error:    fmt.Sprintf("panic: %v", r),
			}
			s.waitForSend(context.Background(), respPk)
		}()
		ctx, cancelFn := makeContextFromTimeout(pk.Timeout)
		defer cancelFn()
		err := handler(ctx, s, pk.Command, pk.Data)
		if err != nil {
			respPk := &RpcPacket{
				Command:  pk.Command,
				RpcId:    pk.RpcId,
				RpcType:  RpcType_Resp,
				SeqNum:   s.NextSeqNum.Add(1),
				RespDone: true,
				Error:    err.Error(),
			}
			s.waitForSend(ctx, respPk)
			return
		}
		// check if RespDone has been set, if not, send it here
	}()
}
