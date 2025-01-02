// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const DefaultTimeoutMs = 5000
const RespChSize = 32
const DefaultMessageChSize = 32

type ResponseFnType = func(any) error

// returns true if handler is complete, false for an async handler
type CommandHandlerFnType = func(*RpcResponseHandler) bool

type ServerImpl interface {
	WshServerImpl()
}

type AbstractRpcClient interface {
	SendRpcMessage(msg []byte)
	RecvRpcMessage() ([]byte, bool) // blocking
}

type WshRpc struct {
	Lock               *sync.Mutex
	clientId           string
	InputCh            chan []byte
	OutputCh           chan []byte
	RpcContext         *atomic.Pointer[wshrpc.RpcContext]
	AuthToken          string
	RpcMap             map[string]*rpcData
	ServerImpl         ServerImpl
	EventListener      *EventListener
	ResponseHandlerMap map[string]*RpcResponseHandler // reqId => handler
	Debug              bool
	DebugName          string
}

type wshRpcContextKey struct{}
type wshRpcRespHandlerContextKey struct{}

func withWshRpcContext(ctx context.Context, wshRpc *WshRpc) context.Context {
	return context.WithValue(ctx, wshRpcContextKey{}, wshRpc)
}

func withRespHandler(ctx context.Context, handler *RpcResponseHandler) context.Context {
	return context.WithValue(ctx, wshRpcRespHandlerContextKey{}, handler)
}

func GetWshRpcFromContext(ctx context.Context) *WshRpc {
	rtn := ctx.Value(wshRpcContextKey{})
	if rtn == nil {
		return nil
	}
	return rtn.(*WshRpc)
}

func GetRpcSourceFromContext(ctx context.Context) string {
	rtn := ctx.Value(wshRpcRespHandlerContextKey{})
	if rtn == nil {
		return ""
	}
	return rtn.(*RpcResponseHandler).GetSource()
}

func GetIsCanceledFromContext(ctx context.Context) bool {
	rtn := ctx.Value(wshRpcRespHandlerContextKey{})
	if rtn == nil {
		return false
	}
	return rtn.(*RpcResponseHandler).IsCanceled()
}

func GetRpcResponseHandlerFromContext(ctx context.Context) *RpcResponseHandler {
	rtn := ctx.Value(wshRpcRespHandlerContextKey{})
	if rtn == nil {
		return nil
	}
	return rtn.(*RpcResponseHandler)
}

func (w *WshRpc) SendRpcMessage(msg []byte) {
	w.InputCh <- msg
}

func (w *WshRpc) RecvRpcMessage() ([]byte, bool) {
	msg, more := <-w.OutputCh
	return msg, more
}

type RpcMessage struct {
	Command   string `json:"command,omitempty"`
	ReqId     string `json:"reqid,omitempty"`
	ResId     string `json:"resid,omitempty"`
	Timeout   int    `json:"timeout,omitempty"`
	Route     string `json:"route,omitempty"`     // to route/forward requests to alternate servers
	AuthToken string `json:"authtoken,omitempty"` // needed for routing unauthenticated requests (WshRpcMultiProxy)
	Source    string `json:"source,omitempty"`    // source route id
	Cont      bool   `json:"cont,omitempty"`      // flag if additional requests/responses are forthcoming
	Cancel    bool   `json:"cancel,omitempty"`    // used to cancel a streaming request or response (sent from the side that is not streaming)
	Error     string `json:"error,omitempty"`
	DataType  string `json:"datatype,omitempty"`
	Data      any    `json:"data,omitempty"`
}

func (r *RpcMessage) IsRpcRequest() bool {
	return r.Command != "" || r.ReqId != ""
}

func (r *RpcMessage) Validate() error {
	if r.ReqId != "" && r.ResId != "" {
		return fmt.Errorf("request packets may not have both reqid and resid set")
	}
	if r.Cancel {
		if r.Command != "" {
			return fmt.Errorf("cancel packets may not have command set")
		}
		if r.ReqId == "" && r.ResId == "" {
			return fmt.Errorf("cancel packets must have reqid or resid set")
		}
		if r.Data != nil {
			return fmt.Errorf("cancel packets may not have data set")
		}
		return nil
	}
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

type rpcData struct {
	ResCh chan *RpcMessage
	Ctx   context.Context
}

func validateServerImpl(serverImpl ServerImpl) {
	if serverImpl == nil {
		return
	}
	serverType := reflect.TypeOf(serverImpl)
	if serverType.Kind() != reflect.Pointer && serverType.Elem().Kind() != reflect.Struct {
		panic(fmt.Sprintf("serverImpl must be a pointer to struct, got %v", serverType))
	}
}

// closes outputCh when inputCh is closed/done
func MakeWshRpc(inputCh chan []byte, outputCh chan []byte, rpcCtx wshrpc.RpcContext, serverImpl ServerImpl) *WshRpc {
	if inputCh == nil {
		inputCh = make(chan []byte, DefaultInputChSize)
	}
	if outputCh == nil {
		outputCh = make(chan []byte, DefaultOutputChSize)
	}
	validateServerImpl(serverImpl)
	rtn := &WshRpc{
		Lock:               &sync.Mutex{},
		clientId:           uuid.New().String(),
		InputCh:            inputCh,
		OutputCh:           outputCh,
		RpcMap:             make(map[string]*rpcData),
		RpcContext:         &atomic.Pointer[wshrpc.RpcContext]{},
		EventListener:      MakeEventListener(),
		ServerImpl:         serverImpl,
		ResponseHandlerMap: make(map[string]*RpcResponseHandler),
	}
	rtn.RpcContext.Store(&rpcCtx)
	go rtn.runServer()
	return rtn
}

func (w *WshRpc) ClientId() string {
	return w.clientId
}

func (w *WshRpc) GetRpcContext() wshrpc.RpcContext {
	rtnPtr := w.RpcContext.Load()
	return *rtnPtr
}

func (w *WshRpc) SetRpcContext(ctx wshrpc.RpcContext) {
	w.RpcContext.Store(&ctx)
}

func (w *WshRpc) SetAuthToken(token string) {
	w.AuthToken = token
}

func (w *WshRpc) GetAuthToken() string {
	return w.AuthToken
}

func (w *WshRpc) registerResponseHandler(reqId string, handler *RpcResponseHandler) {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	w.ResponseHandlerMap[reqId] = handler
}

func (w *WshRpc) unregisterResponseHandler(reqId string) {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	delete(w.ResponseHandlerMap, reqId)
}

func (w *WshRpc) cancelRequest(reqId string) {
	if reqId == "" {
		return
	}
	w.Lock.Lock()
	defer w.Lock.Unlock()
	handler := w.ResponseHandlerMap[reqId]
	if handler != nil {
		handler.canceled.Store(true)
	}

}

func (w *WshRpc) handleRequest(req *RpcMessage) {
	// events first
	if req.Command == wshrpc.Command_EventRecv {
		if req.Data == nil {
			// invalid
			return
		}
		var waveEvent wps.WaveEvent
		err := utilfn.ReUnmarshal(&waveEvent, req.Data)
		if err != nil {
			// invalid
			return
		}
		w.EventListener.RecvEvent(&waveEvent)
		return
	}

	var respHandler *RpcResponseHandler
	timeoutMs := req.Timeout
	if timeoutMs <= 0 {
		timeoutMs = DefaultTimeoutMs
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	ctx = withWshRpcContext(ctx, w)
	respHandler = &RpcResponseHandler{
		w:               w,
		ctx:             ctx,
		reqId:           req.ReqId,
		command:         req.Command,
		commandData:     req.Data,
		source:          req.Source,
		done:            &atomic.Bool{},
		canceled:        &atomic.Bool{},
		contextCancelFn: &atomic.Pointer[context.CancelFunc]{},
		rpcCtx:          w.GetRpcContext(),
	}
	respHandler.contextCancelFn.Store(&cancelFn)
	respHandler.ctx = withRespHandler(ctx, respHandler)
	w.registerResponseHandler(req.ReqId, respHandler)
	isAsync := false
	defer func() {
		panicErr := panichandler.PanicHandler("handleRequest", recover())
		if panicErr != nil {
			respHandler.SendResponseError(panicErr)
		}
		if isAsync {
			go func() {
				defer func() {
					panichandler.PanicHandler("handleRequest:finalize", recover())
				}()
				<-ctx.Done()
				respHandler.Finalize()
			}()
		} else {
			cancelFn()
			respHandler.Finalize()
		}
	}()
	handlerFn := serverImplAdapter(w.ServerImpl)
	isAsync = !handlerFn(respHandler)
}

func (w *WshRpc) runServer() {
	defer close(w.OutputCh)
	for msgBytes := range w.InputCh {
		if w.Debug {
			log.Printf("[%s] received message: %s\n", w.DebugName, string(msgBytes))
		}
		var msg RpcMessage
		err := json.Unmarshal(msgBytes, &msg)
		if err != nil {
			log.Printf("wshrpc received bad message: %v\n", err)
			continue
		}
		if msg.Cancel {
			if msg.ReqId != "" {
				w.cancelRequest(msg.ReqId)
			}
			continue
		}
		if msg.IsRpcRequest() {
			go func() {
				defer func() {
					panichandler.PanicHandler("handleRequest:goroutine", recover())
				}()
				w.handleRequest(&msg)
			}()
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

func (w *WshRpc) SetServerImpl(serverImpl ServerImpl) {
	validateServerImpl(serverImpl)
	w.Lock.Lock()
	defer w.Lock.Unlock()
	w.ServerImpl = serverImpl
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
		defer func() {
			panichandler.PanicHandler("registerRpc:timeout", recover())
		}()
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
func (w *WshRpc) SendCommand(command string, data any, opts *wshrpc.RpcOpts) error {
	var optsCopy wshrpc.RpcOpts
	if opts != nil {
		optsCopy = *opts
	}
	optsCopy.NoResponse = true
	optsCopy.Timeout = 0
	handler, err := w.SendComplexRequest(command, data, &optsCopy)
	if err != nil {
		return err
	}
	handler.finalize()
	return nil
}

// single response
func (w *WshRpc) SendRpcRequest(command string, data any, opts *wshrpc.RpcOpts) (any, error) {
	var optsCopy wshrpc.RpcOpts
	if opts != nil {
		optsCopy = *opts
	}
	optsCopy.NoResponse = false
	handler, err := w.SendComplexRequest(command, data, &optsCopy)
	if err != nil {
		return nil, err
	}
	defer handler.finalize()
	return handler.NextResponse()
}

type RpcRequestHandler struct {
	w           *WshRpc
	ctx         context.Context
	ctxCancelFn *atomic.Pointer[context.CancelFunc]
	reqId       string
	respCh      chan *RpcMessage
	cachedResp  *RpcMessage
}

func (handler *RpcRequestHandler) Context() context.Context {
	return handler.ctx
}

func (handler *RpcRequestHandler) SendCancel() {
	defer func() {
		panichandler.PanicHandler("SendCancel", recover())
	}()
	msg := &RpcMessage{
		Cancel:    true,
		ReqId:     handler.reqId,
		AuthToken: handler.w.GetAuthToken(),
	}
	barr, _ := json.Marshal(msg) // will never fail
	handler.w.OutputCh <- barr
	handler.finalize()
}

func (handler *RpcRequestHandler) ResponseDone() bool {
	if handler.cachedResp != nil {
		return false
	}
	select {
	case msg, more := <-handler.respCh:
		if !more {
			return true
		}
		handler.cachedResp = msg
		return false
	default:
		return false
	}
}

func (handler *RpcRequestHandler) NextResponse() (any, error) {
	var resp *RpcMessage
	if handler.cachedResp != nil {
		resp = handler.cachedResp
		handler.cachedResp = nil
	} else {
		resp = <-handler.respCh
	}
	if resp == nil {
		return nil, errors.New("response channel closed")
	}
	if resp.Error != "" {
		return nil, errors.New(resp.Error)
	}
	return resp.Data, nil
}

func (handler *RpcRequestHandler) finalize() {
	cancelFnPtr := handler.ctxCancelFn.Load()
	if cancelFnPtr != nil && *cancelFnPtr != nil {
		(*cancelFnPtr)()
		handler.ctxCancelFn.Store(nil)
	}
	if handler.reqId != "" {
		handler.w.unregisterRpc(handler.reqId, nil)
	}
}

type RpcResponseHandler struct {
	w               *WshRpc
	ctx             context.Context
	contextCancelFn *atomic.Pointer[context.CancelFunc]
	reqId           string
	source          string
	command         string
	commandData     any
	rpcCtx          wshrpc.RpcContext
	canceled        *atomic.Bool // canceled by requestor
	done            *atomic.Bool
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

func (handler *RpcResponseHandler) GetRpcContext() wshrpc.RpcContext {
	return handler.rpcCtx
}

func (handler *RpcResponseHandler) GetSource() string {
	return handler.source
}

func (handler *RpcResponseHandler) NeedsResponse() bool {
	return handler.reqId != ""
}

func (handler *RpcResponseHandler) SendMessage(msg string) {
	rpcMsg := &RpcMessage{
		Command: wshrpc.Command_Message,
		Data: wshrpc.CommandMessageData{
			Message: msg,
		},
		AuthToken: handler.w.GetAuthToken(),
	}
	msgBytes, _ := json.Marshal(rpcMsg) // will never fail
	handler.w.OutputCh <- msgBytes
}

func (handler *RpcResponseHandler) SendResponse(data any, done bool) error {
	defer func() {
		panichandler.PanicHandler("SendResponse", recover())
	}()
	if handler.reqId == "" {
		return nil // no response expected
	}
	if handler.done.Load() {
		return fmt.Errorf("request already done, cannot send additional response")
	}
	if done {
		defer handler.close()
	}
	msg := &RpcMessage{
		ResId:     handler.reqId,
		Data:      data,
		Cont:      !done,
		AuthToken: handler.w.GetAuthToken(),
	}
	barr, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	handler.w.OutputCh <- barr
	return nil
}

func (handler *RpcResponseHandler) SendResponseError(err error) {
	defer func() {
		panichandler.PanicHandler("SendResponseError", recover())
	}()
	if handler.reqId == "" || handler.done.Load() {
		return
	}
	defer handler.close()
	msg := &RpcMessage{
		ResId:     handler.reqId,
		Error:     err.Error(),
		AuthToken: handler.w.GetAuthToken(),
	}
	barr, _ := json.Marshal(msg) // will never fail
	handler.w.OutputCh <- barr
}

func (handler *RpcResponseHandler) IsCanceled() bool {
	return handler.canceled.Load()
}

func (handler *RpcResponseHandler) close() {
	cancelFn := handler.contextCancelFn.Load()
	if cancelFn != nil && *cancelFn != nil {
		(*cancelFn)()
		handler.contextCancelFn.Store(nil)
	}
	handler.done.Store(true)
}

// if async, caller must call finalize
func (handler *RpcResponseHandler) Finalize() {
	if handler.reqId == "" || handler.done.Load() {
		return
	}
	handler.SendResponse(nil, true)
	handler.close()
	handler.w.unregisterResponseHandler(handler.reqId)
}

func (handler *RpcResponseHandler) IsDone() bool {
	return handler.done.Load()
}

func (w *WshRpc) SendComplexRequest(command string, data any, opts *wshrpc.RpcOpts) (rtnHandler *RpcRequestHandler, rtnErr error) {
	if opts == nil {
		opts = &wshrpc.RpcOpts{}
	}
	timeoutMs := opts.Timeout
	if timeoutMs <= 0 {
		timeoutMs = DefaultTimeoutMs
	}
	defer func() {
		panichandler.PanicHandler("SendComplexRequest", recover())
	}()
	if command == "" {
		return nil, fmt.Errorf("command cannot be empty")
	}
	handler := &RpcRequestHandler{
		w:           w,
		ctxCancelFn: &atomic.Pointer[context.CancelFunc]{},
	}
	var cancelFn context.CancelFunc
	handler.ctx, cancelFn = context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	handler.ctxCancelFn.Store(&cancelFn)
	if !opts.NoResponse {
		handler.reqId = uuid.New().String()
	}
	req := &RpcMessage{
		Command:   command,
		ReqId:     handler.reqId,
		Data:      data,
		Timeout:   timeoutMs,
		Route:     opts.Route,
		AuthToken: w.GetAuthToken(),
	}
	barr, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	handler.respCh = w.registerRpc(handler.ctx, handler.reqId)
	w.OutputCh <- barr
	return handler, nil
}
