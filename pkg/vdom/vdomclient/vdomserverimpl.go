// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package vdomclient

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type VDomServerImpl struct {
	Client  *Client
	BlockId string
}

func (*VDomServerImpl) WshServerImpl() {}

func (impl *VDomServerImpl) VDomRenderCommand(ctx context.Context, feUpdate vdom.VDomFrontendUpdate) chan wshrpc.RespOrErrorUnion[*vdom.VDomBackendUpdate] {
	respChan := make(chan wshrpc.RespOrErrorUnion[*vdom.VDomBackendUpdate], 5)

	defer func() {
		if r := recover(); r != nil {
			log.Printf("panic in VDomRenderCommand: %v\n", r)
			respChan <- wshrpc.RespOrErrorUnion[*vdom.VDomBackendUpdate]{
				Error: fmt.Errorf("internal error: %v", r),
			}
			close(respChan)
		}
	}()

	if feUpdate.Dispose {
		defer close(respChan)
		log.Printf("got dispose from frontend\n")
		impl.Client.doShutdown("got dispose from frontend")
		return respChan
	}

	if impl.Client.GetIsDone() {
		close(respChan)
		return respChan
	}

	// set atoms
	for _, ss := range feUpdate.StateSync {
		impl.Client.Root.SetAtomVal(ss.Atom, ss.Value, false)
	}
	// run events
	for _, event := range feUpdate.Events {
		if event.GlobalEventType != "" {
			if impl.Client.GlobalEventHandler != nil {
				impl.Client.GlobalEventHandler(impl.Client, event)
			}
		} else {
			impl.Client.Root.Event(event.WaveId, event.EventType, event)
		}
	}

	var update *vdom.VDomBackendUpdate
	var err error

	if feUpdate.Resync || true {
		update, err = impl.Client.fullRender()
	} else {
		update, err = impl.Client.incrementalRender()
	}
	update.CreateTransferElems()

	if err != nil {
		respChan <- wshrpc.RespOrErrorUnion[*vdom.VDomBackendUpdate]{
			Error: err,
		}
		close(respChan)
		return respChan
	}

	// Split the update into chunks and send them sequentially
	updates := vdom.SplitBackendUpdate(update)
	go func() {
		defer close(respChan)
		for _, splitUpdate := range updates {
			respChan <- wshrpc.RespOrErrorUnion[*vdom.VDomBackendUpdate]{
				Response: splitUpdate,
			}
		}
	}()

	return respChan
}

func (impl *VDomServerImpl) VDomUrlRequestCommand(ctx context.Context, data wshrpc.VDomUrlRequestData) chan wshrpc.RespOrErrorUnion[wshrpc.VDomUrlRequestResponse] {
	log.Printf("VDomUrlRequestCommand: url=%q\n", data.URL)
	respChan := make(chan wshrpc.RespOrErrorUnion[wshrpc.VDomUrlRequestResponse])
	writer := NewStreamingResponseWriter(respChan)

	go func() {
		defer close(respChan) // Declared first, so it executes last
		defer writer.Close()  // Ensures writer is closed before the channel is closed

		defer func() {
			if r := recover(); r != nil {
				writer.WriteHeader(http.StatusInternalServerError)
				writer.Write([]byte(fmt.Sprintf("internal server error: %v", r)))
			}
		}()

		// Create an HTTP request from the RPC request data
		var bodyReader *bytes.Reader
		if data.Body != nil {
			bodyReader = bytes.NewReader(data.Body)
		} else {
			bodyReader = bytes.NewReader([]byte{})
		}

		httpReq, err := http.NewRequest(data.Method, data.URL, bodyReader)
		if err != nil {
			writer.WriteHeader(http.StatusInternalServerError)
			writer.Write([]byte(err.Error()))
			return
		}

		for key, value := range data.Headers {
			httpReq.Header.Set(key, value)
		}

		if impl.Client.OverrideUrlHandler != nil {
			impl.Client.OverrideUrlHandler.ServeHTTP(writer, httpReq)
			return
		}
		impl.Client.UrlHandlerMux.ServeHTTP(writer, httpReq)
	}()

	return respChan
}
