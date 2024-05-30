// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshprc

import (
	"context"
	"errors"
	"fmt"
	"log"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// there is a single go-routine that reads from RecvCh
type RpcClient struct {
	CVar               *sync.Cond
	NextSeqNum         *atomic.Int64
	ReqPacketsInFlight map[int64]string // seqnum -> rpcId
	AckList            []int64
	RpcReqs            map[string]*RpcInfo
	SendCh             chan *RpcPacket
	RecvCh             chan *RpcPacket
}

type RpcInfo struct {
	CloseSync          *sync.Once
	RpcId              string
	ReqPacketsInFlight map[int64]bool // seqnum -> bool
	RespCh             chan *RpcPacket
}

func MakeRpcClient(sendCh chan *RpcPacket, recvCh chan *RpcPacket) *RpcClient {
	if cap(sendCh) < MaxInFlightPackets {
		panic(fmt.Errorf("sendCh buffer size must be at least MaxInFlightPackets(%d)", MaxInFlightPackets))
	}
	rtn := &RpcClient{
		CVar:               sync.NewCond(&sync.Mutex{}),
		NextSeqNum:         &atomic.Int64{},
		ReqPacketsInFlight: make(map[int64]string),
		AckList:            nil,
		RpcReqs:            make(map[string]*RpcInfo),
		SendCh:             sendCh,
		RecvCh:             recvCh,
	}
	go rtn.runRecvLoop()
	return rtn
}

func (c *RpcClient) runRecvLoop() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("RpcClient.runRecvLoop() panic: %v", r)
			debug.PrintStack()
		}
	}()
	for pk := range c.RecvCh {
		if pk.RpcType == RpcType_Resp {
			c.handleResp(pk)
			continue
		}
		log.Printf("RpcClient.runRecvLoop() bad packet type: %v", pk)
	}
	log.Printf("RpcClient.runRecvLoop() normal exit")
}

func (c *RpcClient) getRpcInfo(rpcId string) *RpcInfo {
	c.CVar.L.Lock()
	defer c.CVar.L.Unlock()
	return c.RpcReqs[rpcId]
}

func (c *RpcClient) handleResp(pk *RpcPacket) {
	c.handleAcks(pk.Acks)
	if pk.RpcId == "" {
		c.ackResp(pk.SeqNum)
		log.Printf("RpcClient.handleResp() missing rpcId: %v", pk)
		return
	}
	rpcInfo := c.getRpcInfo(pk.RpcId)
	if rpcInfo == nil {
		c.ackResp(pk.SeqNum)
		log.Printf("RpcClient.handleResp() unknown rpcId: %v", pk)
		return
	}
	select {
	case rpcInfo.RespCh <- pk:
	default:
		log.Printf("RpcClient.handleResp() respCh full, dropping packet")
	}
	if pk.RespDone {
		c.removeReqInfo(pk.RpcId, false)
	}
}

func (c *RpcClient) grabAcks() []int64 {
	c.CVar.L.Lock()
	defer c.CVar.L.Unlock()
	acks := c.AckList
	c.AckList = nil
	return acks
}

func (c *RpcClient) ackResp(seqNum int64) {
	if seqNum == 0 {
		return
	}
	c.CVar.L.Lock()
	defer c.CVar.L.Unlock()
	c.AckList = append(c.AckList, seqNum)
}

func (c *RpcClient) waitForReq(ctx context.Context, req *RpcPacket) (*RpcInfo, error) {
	c.CVar.L.Lock()
	defer c.CVar.L.Unlock()
	// issue with ctx timeout sync -- we need the cvar to be signaled fairly regularly so we can check ctx.Err()
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if len(c.RpcReqs) >= MaxOpenRpcs {
			c.CVar.Wait()
			continue
		}
		if len(c.ReqPacketsInFlight) >= MaxOpenRpcs {
			c.CVar.Wait()
			continue
		}
		if rpcInfo, ok := c.RpcReqs[req.RpcId]; ok {
			if len(rpcInfo.ReqPacketsInFlight) >= MaxUnackedPerRpc {
				c.CVar.Wait()
				continue
			}
		}
		break
	}
	select {
	case c.SendCh <- req:
	default:
		return nil, errors.New("SendCh Full")
	}
	c.ReqPacketsInFlight[req.SeqNum] = req.RpcId
	rpcInfo := c.RpcReqs[req.RpcId]
	if rpcInfo == nil {
		rpcInfo = &RpcInfo{
			CloseSync:          &sync.Once{},
			RpcId:              req.RpcId,
			ReqPacketsInFlight: make(map[int64]bool),
			RespCh:             make(chan *RpcPacket, MaxUnackedPerRpc),
		}
		rpcInfo.ReqPacketsInFlight[req.SeqNum] = true
		c.RpcReqs[req.RpcId] = rpcInfo
	}
	return rpcInfo, nil
}

func (c *RpcClient) handleAcks(acks []int64) {
	if len(acks) == 0 {
		return
	}
	c.CVar.L.Lock()
	defer c.CVar.L.Unlock()
	for _, ack := range acks {
		rpcId, ok := c.ReqPacketsInFlight[ack]
		if !ok {
			continue
		}
		rpcInfo := c.RpcReqs[rpcId]
		if rpcInfo != nil {
			delete(rpcInfo.ReqPacketsInFlight, ack)
		}
		delete(c.ReqPacketsInFlight, ack)
	}
	c.CVar.Broadcast()
}

func (c *RpcClient) removeReqInfo(rpcId string, clearSend bool) {
	c.CVar.L.Lock()
	defer c.CVar.L.Unlock()
	rpcInfo := c.RpcReqs[rpcId]
	delete(c.RpcReqs, rpcId)
	if rpcInfo != nil {
		if clearSend {
			// unblock the recv loop if it happens to be waiting
			// because the delete has already happens, it will not be able to send again on the channel
			select {
			case <-rpcInfo.RespCh:
			default:
			}
		}
		rpcInfo.CloseSync.Do(func() {
			close(rpcInfo.RespCh)
		})
	}
}

func (c *RpcClient) SimpleReq(ctx context.Context, command string, data any) (any, error) {
	rpcId := uuid.New().String()
	seqNum := c.NextSeqNum.Add(1)
	var timeoutInfo *TimeoutInfo
	deadline, ok := ctx.Deadline()
	if ok {
		timeoutInfo = &TimeoutInfo{Deadline: deadline.UnixMilli()}
	}
	req := &RpcPacket{
		Command: command,
		RpcId:   rpcId,
		RpcType: RpcType_Req,
		SeqNum:  seqNum,
		ReqDone: true,
		Acks:    c.grabAcks(),
		Timeout: timeoutInfo,
		Data:    data,
	}
	rpcInfo, err := c.waitForReq(ctx, req)
	if err != nil {
		return nil, err
	}
	defer c.removeReqInfo(rpcId, true)
	var rtnPacket *RpcPacket
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case rtnPacket = <-rpcInfo.RespCh:
		// fallthrough
	}
	if rtnPacket.Error != "" {
		return nil, errors.New(rtnPacket.Error)
	}
	return rtnPacket.Data, nil
}

func (c *RpcClient) StreamReq(ctx context.Context, command string, data any, respTimeout time.Duration) (chan *RpcPacket, error) {
	rpcId := uuid.New().String()
	seqNum := c.NextSeqNum.Add(1)
	var timeoutInfo *TimeoutInfo = &TimeoutInfo{RespPacketTimeout: respTimeout.Milliseconds()}
	deadline, ok := ctx.Deadline()
	if ok {
		timeoutInfo.Deadline = deadline.UnixMilli()
	}
	req := &RpcPacket{
		Command: command,
		RpcId:   rpcId,
		RpcType: RpcType_Req,
		SeqNum:  seqNum,
		ReqDone: true,
		Acks:    c.grabAcks(),
		Timeout: timeoutInfo,
		Data:    data,
	}
	rpcInfo, err := c.waitForReq(ctx, req)
	if err != nil {
		return nil, err
	}
	return rpcInfo.RespCh, nil
}

func (c *RpcClient) EndStreamReq(rpcId string) {
	c.removeReqInfo(rpcId, true)
}
