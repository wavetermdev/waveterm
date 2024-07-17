// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

const DefaultTimeoutMs = 5000
const RespChSize = 32
const DefaultMessageChSize = 32

const (
	RpcType_Call             = "call"             // single response (regular rpc)
	RpcType_ResponseStream   = "responsestream"   // stream of responses (streaming rpc)
	RpcType_StreamingRequest = "streamingrequest" // streaming request
	RpcType_Complex          = "complex"          // streaming request/response
)

type ResponseFnType = func(any) error
type CommandHandlerFnType = func(*RpcResponseHandler)

type wshRpcContextKey struct{}

func withWshRpcContext(ctx context.Context, wshRpc *WshRpc) context.Context {
	return context.WithValue(ctx, wshRpcContextKey{}, wshRpc)
}

func GetWshRpcFromContext(ctx context.Context) *WshRpc {
	rtn := ctx.Value(wshRpcContextKey{})
	if rtn == nil {
		return nil
	}
	return rtn.(*WshRpc)
}

type RpcMessage struct {
	Command  string `json:"command,omitempty"`
	ReqId    string `json:"reqid,omitempty"`
	ResId    string `json:"resid,omitempty"`
	Timeout  int    `json:"timeout,omitempty"`
	Cont     bool   `json:"cont,omitempty"`
	Error    string `json:"error,omitempty"`
	DataType string `json:"datatype,omitempty"`
	Data     any    `json:"data,omitempty"`
}

func (r *RpcMessage) IsRpcRequest() bool {
	return r.Command != "" || r.ReqId != ""
}

func (r *RpcMessage) Validate() error {
	if r.Command != "" {
		if r.ResId != "" {
			return fmt.Errorf("command packets may not have resid set")
		}
		if r.Error != "" {
			return fmt.Errorf("command packets may not have error set")
		}
		if r.DataType != "" {
			return fmt.Errorf("command packets may not have datatype set")
		}
		return nil
	}
	if r.ReqId != "" {
		if r.ResId == "" {
			return fmt.Errorf("request packets must have resid set")
		}
		if r.Timeout != 0 {
			return fmt.Errorf("non-command request packets may not have timeout set")
		}
		return nil
	}
	if r.ResId != "" {
		if r.Command != "" {
			return fmt.Errorf("response packets may not have command set")
		}
		if r.ReqId == "" {
			return fmt.Errorf("response packets must have reqid set")
		}
		if r.Timeout != 0 {
			return fmt.Errorf("response packets may not have timeout set")
		}
		return nil
	}
	return fmt.Errorf("invalid packet: must have command, reqid, or resid set")
}

type RpcContext struct {
	BlockId  string `json:"blockid,omitempty"`
	TabId    string `json:"tabid,omitempty"`
	WindowId string `json:"windowid,omitempty"`
}

type WshRpc struct {
	Lock       *sync.Mutex
	InputCh    chan []byte
	OutputCh   chan []byte
	RpcContext *atomic.Pointer[RpcContext]
	RpcMap     map[string]*rpcData
	HandlerFn  CommandHandlerFnType
}

type rpcData struct {
	ResCh chan *RpcMessage
	Ctx   context.Context
}

// oscEsc is the OSC escape sequence to use for *sending* messages
// closes outputCh when inputCh is closed/done
func MakeWshRpc(inputCh chan []byte, outputCh chan []byte, rpcCtx RpcContext, commandHandlerFn CommandHandlerFnType) *WshRpc {
	rtn := &WshRpc{
		Lock:       &sync.Mutex{},
		InputCh:    inputCh,
		OutputCh:   outputCh,
		RpcMap:     make(map[string]*rpcData),
		RpcContext: &atomic.Pointer[RpcContext]{},
		HandlerFn:  commandHandlerFn,
	}
	rtn.RpcContext.Store(&rpcCtx)
	go rtn.runServer()
	return rtn
}

func (w *WshRpc) GetRpcContext() RpcContext {
	rtnPtr := w.RpcContext.Load()
	return *rtnPtr
}

func (w *WshRpc) SetRpcContext(ctx RpcContext) {
	w.RpcContext.Store(&ctx)
}

func (w *WshRpc) handleRequest(req *RpcMessage) {
	var respHandler *RpcResponseHandler
	defer func() {
		if r := recover(); r != nil {
			log.Printf("panic in handleRequest: %v\n", r)
			debug.PrintStack()
			if respHandler != nil {
				respHandler.SendResponseError(fmt.Errorf("panic: %v", r))
			}
		}
	}()
	timeoutMs := req.Timeout
	if timeoutMs <= 0 {
		timeoutMs = DefaultTimeoutMs
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	ctx = withWshRpcContext(ctx, w)
	defer cancelFn()
	respHandler = &RpcResponseHandler{
		w:           w,
		ctx:         ctx,
		reqId:       req.ReqId,
		command:     req.Command,
		commandData: req.Data,
		done:        &atomic.Bool{},
		rpcCtx:      w.GetRpcContext(),
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("panic in handleRequest: %v\n", r)
			debug.PrintStack()
			respHandler.SendResponseError(fmt.Errorf("panic: %v", r))
		}
		respHandler.finalize()
	}()
	if w.HandlerFn != nil {
		w.HandlerFn(respHandler)
	}
}

func (w *WshRpc) runServer() {
	defer close(w.OutputCh)
	for msgBytes := range w.InputCh {
		var msg RpcMessage
		err := json.Unmarshal(msgBytes, &msg)
		if err != nil {
			log.Printf("wshrpc received bad message: %v\n", err)
			continue
		}
		if msg.IsRpcRequest() {
			w.handleRequest(&msg)
		} else {
			respCh := w.getResponseCh(msg.ResId)
			if respCh == nil {
				continue
			}
			respCh <- &msg
			if !msg.Cont {
				w.unregisterRpc(msg.ResId, nil)
			}
		}
	}
}

func (w *WshRpc) getResponseCh(resId string) chan *RpcMessage {
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

func (w *WshRpc) registerRpc(ctx context.Context, reqId string) chan *RpcMessage {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	rpcCh := make(chan *RpcMessage, RespChSize)
	w.RpcMap[reqId] = &rpcData{
		ResCh: rpcCh,
		Ctx:   ctx,
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
	if rd == nil {
		return
	}
	if err != nil {
		errResp := &RpcMessage{
			ResId: reqId,
			Error: err.Error(),
		}
		rd.ResCh <- errResp
	}
	delete(w.RpcMap, reqId)
	close(rd.ResCh)
}

// no response
func (w *WshRpc) SendCommand(command string, data any) error {
	handler, err := w.SendComplexRequest(command, data, false, 0)
	if err != nil {
		return err
	}
	handler.finalize()
	return nil
}

// single response
func (w *WshRpc) SendRpcRequest(command string, data any, timeoutMs int) (any, error) {
	handler, err := w.SendComplexRequest(command, data, true, timeoutMs)
	if err != nil {
		return nil, err
	}
	defer handler.finalize()
	return handler.NextResponse()
}

type RpcRequestHandler struct {
	w        *WshRpc
	ctx      context.Context
	cancelFn func()
	reqId    string
	respCh   chan *RpcMessage
}

func (handler *RpcRequestHandler) Context() context.Context {
	return handler.ctx
}

func (handler *RpcRequestHandler) ResponseDone() bool {
	select {
	case _, more := <-handler.respCh:
		return !more
	default:
		return false
	}
}

func (handler *RpcRequestHandler) NextResponse() (any, error) {
	resp := <-handler.respCh
	if resp.Error != "" {
		return nil, errors.New(resp.Error)
	}
	return resp.Data, nil
}

func (handler *RpcRequestHandler) finalize() {
	if handler.cancelFn != nil {
		handler.cancelFn()
	}
	if handler.reqId != "" {
		handler.w.unregisterRpc(handler.reqId, nil)
	}
}

type RpcResponseHandler struct {
	w           *WshRpc
	ctx         context.Context
	reqId       string
	command     string
	commandData any
	rpcCtx      RpcContext
	done        *atomic.Bool
}

func (handler *RpcResponseHandler) Context() context.Context {
	return handler.ctx
}

func (handler *RpcResponseHandler) GetCommand() string {
	return handler.command
}

func (handler *RpcResponseHandler) GetCommandRawData() any {
	return handler.commandData
}

func (handler *RpcResponseHandler) GetRpcContext() RpcContext {
	return handler.rpcCtx
}

func (handler *RpcResponseHandler) SendResponse(data any, done bool) error {
	if handler.reqId == "" {
		return nil // no response expected
	}
	if handler.done.Load() {
		return fmt.Errorf("request already done, cannot send additional response")
	}
	if done {
		handler.done.Store(true)
	}
	msg := &RpcMessage{
		ResId: handler.reqId,
		Data:  data,
		Cont:  !done,
	}
	barr, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	handler.w.OutputCh <- barr
	return nil
}

func (handler *RpcResponseHandler) SendResponseError(err error) {
	if handler.reqId == "" || handler.done.Load() {
		return
	}
	handler.done.Store(true)
	msg := &RpcMessage{
		ResId: handler.reqId,
		Error: err.Error(),
	}
	barr, _ := json.Marshal(msg) // will never fail
	handler.w.OutputCh <- barr
}

func (handler *RpcResponseHandler) finalize() {
	if handler.reqId == "" || handler.done.Load() {
		return
	}
	handler.done.Store(true)
	handler.SendResponse(nil, true)
}

func (handler *RpcResponseHandler) IsDone() bool {
	return handler.done.Load()
}

func (w *WshRpc) SendComplexRequest(command string, data any, expectsResponse bool, timeoutMs int) (*RpcRequestHandler, error) {
	if command == "" {
		return nil, fmt.Errorf("command cannot be empty")
	}
	handler := &RpcRequestHandler{
		w: w,
	}
	if timeoutMs < 0 {
		handler.ctx = context.Background()
	} else {
		handler.ctx, handler.cancelFn = context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	}
	if expectsResponse {
		handler.reqId = uuid.New().String()
	}
	req := &RpcMessage{
		Command: command,
		ReqId:   handler.reqId,
		Data:    data,
		Timeout: timeoutMs,
	}
	barr, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	handler.respCh = w.registerRpc(handler.ctx, handler.reqId)
	w.OutputCh <- barr
	return handler, nil
}
