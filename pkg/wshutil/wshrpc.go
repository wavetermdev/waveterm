// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
)

const DefaultTimeoutMs = 5000
const RespChSize = 32
const DefaultOutputChSize = 32

type ResponseDataType = map[string]any
type ResponseFnType = func(ResponseDataType) error
type CommandHandlerFnType = func(context.Context, BlockCommand, ResponseFnType) (ResponseDataType, error)

type RpcMessage interface {
	IsRpcRequest() bool
}

type WshRpc struct {
	Lock      *sync.Mutex
	InputCh   chan RpcMessage
	OutputCh  chan []byte
	OSCEsc    string // either 23198 or 23199
	RpcMap    map[string]*rpcData
	HandlerFn CommandHandlerFnType
}

type RpcRequest struct {
	ReqId     string
	TimeoutMs int
	Command   BlockCommand
}

func (r *RpcRequest) IsRpcRequest() bool {
	return true
}

func (r *RpcRequest) MarshalJSON() ([]byte, error) {
	if r == nil {
		return []byte("null"), nil
	}
	rtn := make(map[string]any)
	utilfn.DoMapStucture(&rtn, r.Command)
	rtn["command"] = r.Command.GetCommand()
	if r.ReqId != "" {
		rtn["reqid"] = r.ReqId
	} else {
		delete(rtn, "reqid")
	}
	if r.TimeoutMs != 0 {
		rtn["timeoutms"] = float64(r.TimeoutMs)
	} else {
		delete(rtn, "timeoutms")
	}
	return json.Marshal(rtn)
}

type RpcResponse struct {
	ResId string         `json:"resid"`
	Error string         `json:"error,omitempty"`
	Cont  bool           `json:"cont,omitempty"`
	Data  map[string]any `json:"data,omitempty"`
}

func (r *RpcResponse) IsRpcRequest() bool {
	return false
}

func (r *RpcResponse) MarshalJSON() ([]byte, error) {
	rtn := make(map[string]any)
	// rest goes first (since other fields will overwrite)
	for k, v := range r.Data {
		rtn[k] = v
	}
	rtn["resid"] = r.ResId
	if r.Error != "" {
		rtn["error"] = r.Error
	} else {
		delete(rtn, "error")
	}
	if r.Cont {
		rtn["cont"] = true
	} else {
		delete(rtn, "cont")
	}
	return json.Marshal(rtn)
}

type rpcData struct {
	ResCh    chan *RpcResponse
	Ctx      context.Context
	CancelFn context.CancelFunc
}

// oscEsc is the OSC escape sequence to use for *sending* messages
// closes outputCh when inputCh is closed/done
func MakeWshRpc(oscEsc string, inputCh chan RpcMessage, commandHandlerFn CommandHandlerFnType) (*WshRpc, chan []byte) {
	if len(oscEsc) != 5 {
		panic("oscEsc must be 5 characters")
	}
	outputCh := make(chan []byte, DefaultOutputChSize)
	rtn := &WshRpc{
		Lock:      &sync.Mutex{},
		InputCh:   inputCh,
		OutputCh:  outputCh,
		OSCEsc:    oscEsc,
		RpcMap:    make(map[string]*rpcData),
		HandlerFn: commandHandlerFn,
	}
	go rtn.runServer()
	return rtn, outputCh
}

func (w *WshRpc) handleRequest(req *RpcRequest) {
	defer func() {
		if r := recover(); r != nil {
			errResp := &RpcResponse{
				ResId: req.ReqId,
				Error: fmt.Sprintf("panic: %v", r),
			}
			barr, err := EncodeWaveOSCMessageEx(w.OSCEsc, errResp)
			if err != nil {
				return
			}
			w.OutputCh <- barr
		}
	}()
	respFn := func(resp ResponseDataType) error {
		if req.ReqId == "" {
			// request is not expecting a response
			return nil
		}
		respMsg := &RpcResponse{
			ResId: req.ReqId,
			Cont:  true,
			Data:  resp,
		}
		barr, err := EncodeWaveOSCMessageEx(w.OSCEsc, respMsg)
		if err != nil {
			return fmt.Errorf("error marshalling response to json: %w", err)
		}
		w.OutputCh <- barr
		return nil
	}
	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = DefaultTimeoutMs
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancelFn()
	respData, err := w.HandlerFn(ctx, req.Command, respFn)
	log.Printf("handler for %q returned resp: %v\n", req.Command.GetCommand(), respData)
	if req.ReqId == "" {
		// no response expected
		if err != nil {
			log.Printf("error handling request (no response): %v\n", err)
		}
		return
	}
	if err != nil {
		errResp := &RpcResponse{
			ResId: req.ReqId,
			Error: err.Error(),
		}
		barr, err := EncodeWaveOSCMessageEx(w.OSCEsc, errResp)
		if err != nil {
			return
		}
		w.OutputCh <- barr
		return
	}
	respMsg := &RpcResponse{
		ResId: req.ReqId,
		Data:  respData,
	}
	barr, err := EncodeWaveOSCMessageEx(w.OSCEsc, respMsg)
	if err != nil {
		respMsg := &RpcResponse{
			ResId: req.ReqId,
			Error: err.Error(),
		}
		barr, _ = EncodeWaveOSCMessageEx(w.OSCEsc, respMsg)
	}
	w.OutputCh <- barr
}

func (w *WshRpc) runServer() {
	defer close(w.OutputCh)
	for msg := range w.InputCh {
		if msg.IsRpcRequest() {
			if w.HandlerFn == nil {
				continue
			}
			req := msg.(*RpcRequest)
			w.handleRequest(req)
		} else {
			resp := msg.(*RpcResponse)
			respCh := w.getResponseCh(resp.ResId)
			if respCh == nil {
				continue
			}
			respCh <- resp
			if !resp.Cont {
				w.unregisterRpc(resp.ResId, nil)
			}
		}
	}
}

func (w *WshRpc) getResponseCh(resId string) chan *RpcResponse {
	if resId == "" {
		return nil
	}
	w.Lock.Lock()
	defer w.Lock.Unlock()
	rd := w.RpcMap[resId]
	if rd == nil {
		return nil
	}
	return rd.ResCh
}

func (w *WshRpc) SetHandler(handler CommandHandlerFnType) {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	w.HandlerFn = handler
}

// no response
func (w *WshRpc) SendCommand(cmd BlockCommand) error {
	barr, err := EncodeWaveOSCMessageEx(w.OSCEsc, &RpcRequest{Command: cmd})
	if err != nil {
		return fmt.Errorf("error marshalling request to json: %w", err)
	}
	w.OutputCh <- barr
	return nil
}

func (w *WshRpc) registerRpc(reqId string, timeoutMs int) chan *RpcResponse {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	if timeoutMs <= 0 {
		timeoutMs = DefaultTimeoutMs
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	rpcCh := make(chan *RpcResponse, RespChSize)
	w.RpcMap[reqId] = &rpcData{
		ResCh:    rpcCh,
		Ctx:      ctx,
		CancelFn: cancelFn,
	}
	go func() {
		<-ctx.Done()
		w.unregisterRpc(reqId, fmt.Errorf("EC-TIME: timeout waiting for response"))
	}()
	return rpcCh
}

func (w *WshRpc) unregisterRpc(reqId string, err error) {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	rd := w.RpcMap[reqId]
	if rd != nil {
		if err != nil {
			errResp := &RpcResponse{
				ResId: reqId,
				Error: err.Error(),
			}
			rd.ResCh <- errResp
		}
		close(rd.ResCh)
		rd.CancelFn()
	}
	delete(w.RpcMap, reqId)
}

// single response
func (w *WshRpc) SendRpcRequest(cmd BlockCommand, timeoutMs int) (map[string]any, error) {
	if timeoutMs < 0 {
		return nil, fmt.Errorf("timeout must be >= 0")
	}
	req := &RpcRequest{
		Command:   cmd,
		ReqId:     uuid.New().String(),
		TimeoutMs: timeoutMs,
	}
	barr, err := EncodeWaveOSCMessageEx(w.OSCEsc, req)
	if err != nil {
		return nil, fmt.Errorf("error marshalling request to ANSI esc: %w", err)
	}
	rpcCh := w.registerRpc(req.ReqId, timeoutMs)
	defer w.unregisterRpc(req.ReqId, nil)
	w.OutputCh <- barr
	resp := <-rpcCh
	if resp.Error != "" {
		return nil, errors.New(resp.Error)
	}
	return resp.Data, nil
}

// streaming response
func (w *WshRpc) SendRpcRequestEx(cmd BlockCommand, timeoutMs int) (chan *RpcResponse, error) {
	if timeoutMs < 0 {
		return nil, fmt.Errorf("timeout must be >= 0")
	}
	req := &RpcRequest{
		Command:   cmd,
		ReqId:     uuid.New().String(),
		TimeoutMs: timeoutMs,
	}
	barr, err := EncodeWaveOSCMessageEx(w.OSCEsc, req)
	if err != nil {
		return nil, fmt.Errorf("error marshalling request to json: %w", err)
	}
	rpcCh := w.registerRpc(req.ReqId, timeoutMs)
	w.OutputCh <- barr
	return rpcCh, nil
}
