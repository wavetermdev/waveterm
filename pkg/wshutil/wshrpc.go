// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"reflect"
	"runtime/pprof"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const DefaultTimeoutMs = 5000
const RespChSize = 32
const DefaultMessageChSize = 32
const CtxDoneChSize = 10

var blockingExpMap = ds.MakeExpMap[bool]()

type ResponseFnType = func(any) error

// returns true if handler is complete, false for an async handler
type CommandHandlerFnType = func(*RpcResponseHandler) bool

type ServerImpl interface {
	WshServerImpl()
}

type AbstractRpcClient interface {
	GetPeerInfo() string
	SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string)
	RecvRpcMessage() ([]byte, bool) // blocking
}

type WshRpc struct {
	Lock               *sync.Mutex
	InputCh            chan baseds.RpcInputChType
	OutputCh           chan []byte
	CtxDoneCh          chan string // for context cancellation, value is ResId
	RpcContext         *atomic.Pointer[wshrpc.RpcContext]
	RpcMap             map[string]*rpcData
	ServerImpl         ServerImpl
	EventListener      *EventListener
	ResponseHandlerMap map[string]*RpcResponseHandler // reqId => handler
	Debug              bool
	DebugName          string
	ServerDone         bool
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

func (w *WshRpc) GetPeerInfo() string {
	return w.DebugName
}

func (w *WshRpc) SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string) {
	w.InputCh <- baseds.RpcInputChType{MsgBytes: msg, IngressLinkId: ingressLinkId}
}

func (w *WshRpc) RecvRpcMessage() ([]byte, bool) {
	msg, more := <-w.OutputCh
	return msg, more
}

type RpcMessage struct {
	Command  string `json:"command,omitempty"`
	ReqId    string `json:"reqid,omitempty"`
	ResId    string `json:"resid,omitempty"`
	Timeout  int64  `json:"timeout,omitempty"`
	Route    string `json:"route,omitempty"`  // to route/forward requests to alternate servers
	Source   string `json:"source,omitempty"` // source route id
	Cont     bool   `json:"cont,omitempty"`   // flag if additional requests/responses are forthcoming
	Cancel   bool   `json:"cancel,omitempty"` // used to cancel a streaming request or response (sent from the side that is not streaming)
	Error    string `json:"error,omitempty"`
	DataType string `json:"datatype,omitempty"`
	Data     any    `json:"data,omitempty"`
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
	Command string
	Route   string
	ResCh   chan *RpcMessage
	Handler *RpcRequestHandler
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
func MakeWshRpcWithChannels(inputCh chan baseds.RpcInputChType, outputCh chan []byte, rpcCtx wshrpc.RpcContext, serverImpl ServerImpl, debugName string) *WshRpc {
	if inputCh == nil {
		inputCh = make(chan baseds.RpcInputChType, DefaultInputChSize)
	}
	if outputCh == nil {
		outputCh = make(chan []byte, DefaultOutputChSize)
	}
	validateServerImpl(serverImpl)
	rtn := &WshRpc{
		Lock:               &sync.Mutex{},
		DebugName:          debugName,
		InputCh:            inputCh,
		OutputCh:           outputCh,
		CtxDoneCh:          make(chan string, CtxDoneChSize),
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

func MakeWshRpc(rpcCtx wshrpc.RpcContext, serverImpl ServerImpl, debugName string) *WshRpc {
	return MakeWshRpcWithChannels(nil, nil, rpcCtx, serverImpl, debugName)
}

func (w *WshRpc) GetRpcContext() wshrpc.RpcContext {
	rtnPtr := w.RpcContext.Load()
	return *rtnPtr
}

func (w *WshRpc) SetRpcContext(ctx wshrpc.RpcContext) {
	w.RpcContext.Store(&ctx)
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

func (w *WshRpc) handleRequest(req *RpcMessage, ingressLinkId baseds.LinkId) {
	pprof.Do(context.Background(), pprof.Labels("rpc", req.Command), func(pprofCtx context.Context) {
		w.handleRequestInternal(req, ingressLinkId, pprofCtx)
	})
}

func (w *WshRpc) handleEventRecv(req *RpcMessage) {
	if req.Data == nil {
		return
	}
	var waveEvent wps.WaveEvent
	err := utilfn.ReUnmarshal(&waveEvent, req.Data)
	if err != nil {
		return
	}
	w.EventListener.RecvEvent(&waveEvent)
}

func (w *WshRpc) handleRequestInternal(req *RpcMessage, ingressLinkId baseds.LinkId, pprofCtx context.Context) {
	if req.Command == wshrpc.Command_EventRecv {
		w.handleEventRecv(req)
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
		ingressLinkId:   ingressLinkId,
		done:            &atomic.Bool{},
		canceled:        &atomic.Bool{},
		contextCancelFn: &atomic.Pointer[context.CancelFunc]{},
		rpcCtx:          w.GetRpcContext(),
	}
	respHandler.contextCancelFn.Store(&cancelFn)
	respHandler.ctx = withRespHandler(ctx, respHandler)
	if req.ReqId != "" {
		w.registerResponseHandler(req.ReqId, respHandler)
	}
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
	defer func() {
		panichandler.PanicHandler("wshrpc.runServer", recover())
		close(w.OutputCh)
		w.setServerDone()
	}()
outer:
	for {
		var inputVal baseds.RpcInputChType
		var inputChMore bool
		var resIdTimeout string

		select {
		case inputVal, inputChMore = <-w.InputCh:
			if !inputChMore {
				break outer
			}
			if w.Debug {
				log.Printf("[%s] received message: %s\n", w.DebugName, string(inputVal.MsgBytes))
			}
		case resIdTimeout = <-w.CtxDoneCh:
			if w.Debug {
				log.Printf("[%s] received request timeout: %s\n", w.DebugName, resIdTimeout)
			}
			w.unregisterRpc(resIdTimeout, fmt.Errorf("EC-TIME: timeout waiting for response"))
			continue
		}

		var msg RpcMessage
		err := json.Unmarshal(inputVal.MsgBytes, &msg)
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
			ingressLinkId := inputVal.IngressLinkId
			go func() {
				defer func() {
					panichandler.PanicHandler("handleRequest:goroutine", recover())
				}()
				w.handleRequest(&msg, ingressLinkId)
			}()
		} else {
			w.sendRespWithBlockMessage(msg)
			if !msg.Cont {
				w.unregisterRpc(msg.ResId, nil)
			}
		}
	}
}

func (w *WshRpc) getResponseCh(resId string) (chan *RpcMessage, *rpcData) {
	if resId == "" {
		return nil, nil
	}
	w.Lock.Lock()
	defer w.Lock.Unlock()
	rd := w.RpcMap[resId]
	if rd == nil {
		return nil, nil
	}
	return rd.ResCh, rd
}

func (w *WshRpc) SetServerImpl(serverImpl ServerImpl) {
	validateServerImpl(serverImpl)
	w.Lock.Lock()
	defer w.Lock.Unlock()
	w.ServerImpl = serverImpl
}

func (w *WshRpc) registerRpc(handler *RpcRequestHandler, command string, route string, reqId string) chan *RpcMessage {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	rpcCh := make(chan *RpcMessage, RespChSize)
	w.RpcMap[reqId] = &rpcData{
		Handler: handler,
		Command: command,
		Route:   route,
		ResCh:   rpcCh,
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("registerRpc:timeout", recover())
		}()
		<-handler.ctx.Done()
		w.retrySendTimeout(reqId)
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
		// non-blocking send since we're about to close anyway
		// likely the channel isn't being actively read
		// this also prevents us from blocking the main loop (and holding the lock)
		select {
		case rd.ResCh <- errResp:
		default:
		}
	}
	delete(w.RpcMap, reqId)
	close(rd.ResCh)
	rd.Handler.callContextCancelFn()
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

func (handler *RpcRequestHandler) SendCancel(ctx context.Context) error {
	defer func() {
		panichandler.PanicHandler("SendCancel", recover())
	}()
	msg := &RpcMessage{
		Cancel: true,
		ReqId:  handler.reqId,
	}
	barr, _ := json.Marshal(msg) // will never fail
	select {
	case handler.w.OutputCh <- barr:
		handler.finalize()
		return nil
	case <-ctx.Done():
		handler.finalize()
		return fmt.Errorf("timeout sending cancel")
	}
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
	handler.callContextCancelFn()
	if handler.reqId != "" {
		handler.w.unregisterRpc(handler.reqId, nil)
	}
}

func (handler *RpcRequestHandler) callContextCancelFn() {
	cancelFnPtr := handler.ctxCancelFn.Swap(nil)
	if cancelFnPtr != nil && *cancelFnPtr != nil {
		(*cancelFnPtr)()
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
	ingressLinkId   baseds.LinkId
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

func (handler *RpcResponseHandler) GetIngressLinkId() baseds.LinkId {
	return handler.ingressLinkId
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
		Route: handler.source, // send back to source
	}
	msgBytes, _ := json.Marshal(rpcMsg) // will never fail
	select {
	case handler.w.OutputCh <- msgBytes:
	case <-handler.ctx.Done():
	}
}

func (handler *RpcResponseHandler) SendResponse(data any, done bool) error {
	defer func() {
		panichandler.PanicHandler("SendResponse", recover())
	}()
	if handler.done.Load() {
		return fmt.Errorf("request already done, cannot send additional response")
	}
	if done {
		defer handler.close()
	}
	if handler.reqId == "" {
		return nil
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
	select {
	case handler.w.OutputCh <- barr:
		return nil
	case <-handler.ctx.Done():
		return fmt.Errorf("timeout sending response")
	}
}

func (handler *RpcResponseHandler) SendResponseError(err error) {
	defer func() {
		panichandler.PanicHandler("SendResponseError", recover())
	}()
	if handler.done.Load() {
		return
	}
	defer handler.close()
	if handler.reqId == "" {
		return
	}
	msg := &RpcMessage{
		ResId: handler.reqId,
		Error: err.Error(),
	}
	barr, _ := json.Marshal(msg) // will never fail
	select {
	case handler.w.OutputCh <- barr:
	case <-handler.ctx.Done():
	}
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
	// Always unregister the handler from the map, even if already done
	if handler.reqId != "" {
		handler.w.unregisterResponseHandler(handler.reqId)
	}
	if handler.done.Load() {
		return
	}
	// SendResponse with done=true will call close() via defer, even when reqId is empty
	handler.SendResponse(nil, true)
}

func (handler *RpcResponseHandler) IsDone() bool {
	return handler.done.Load()
}

func (w *WshRpc) SendComplexRequest(command string, data any, opts *wshrpc.RpcOpts) (rtnHandler *RpcRequestHandler, rtnErr error) {
	if w.IsServerDone() {
		return nil, errors.New("server is no longer running, cannot send new requests")
	}
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
		Command: command,
		ReqId:   handler.reqId,
		Data:    data,
		Timeout: timeoutMs,
		Route:   opts.Route,
	}
	barr, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	handler.respCh = w.registerRpc(handler, command, opts.Route, handler.reqId)
	select {
	case w.OutputCh <- barr:
		return handler, nil
	case <-handler.ctx.Done():
		handler.finalize()
		return nil, fmt.Errorf("timeout sending request")
	}
}

func (w *WshRpc) IsServerDone() bool {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	return w.ServerDone
}

func (w *WshRpc) setServerDone() {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	w.ServerDone = true
	close(w.CtxDoneCh)
	utilfn.DrainChannelSafe(w.InputCh, "wshrpc.setServerDone")
}

func (w *WshRpc) retrySendTimeout(resId string) {
	done := func() bool {
		w.Lock.Lock()
		defer w.Lock.Unlock()
		if w.ServerDone {
			return true
		}
		select {
		case w.CtxDoneCh <- resId:
			return true
		default:
			return false
		}
	}
	for {
		if done() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (w *WshRpc) sendRespWithBlockMessage(msg RpcMessage) {
	respCh, rd := w.getResponseCh(msg.ResId)
	if respCh == nil {
		return
	}
	select {
	case respCh <- &msg:
		// normal case, message got sent, just return!
		return
	default:
		// channel is full, we would block...
	}
	// log the fact that we're blocking
	_, noLog := blockingExpMap.Get(msg.ResId)
	if !noLog {
		log.Printf("[rpc:%s] blocking on response command:%s route:%s resid:%s\n", w.DebugName, rd.Command, rd.Route, msg.ResId)
		blockingExpMap.Set(msg.ResId, true, time.Now().Add(time.Second))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	select {
	case respCh <- &msg:
		// message got sent, just return!
		return
	case <-ctx.Done():
	}
	log.Printf("[rpc:%s] failed to clear response channel (waited 1s), will fail RPC command:%s route:%s resid:%s\n", w.DebugName, rd.Command, rd.Route, msg.ResId)
	w.unregisterRpc(msg.ResId, nil) // we don't pass an error because the channel is full, it won't work anyway...
}
