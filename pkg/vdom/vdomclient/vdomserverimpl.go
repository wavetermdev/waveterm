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

func (impl *VDomServerImpl) VDomRenderCommand(ctx context.Context, feUpdate vdom.VDomFrontendUpdate) (*vdom.VDomBackendUpdate, error) {
	if feUpdate.Dispose {
		log.Printf("got dispose from frontend\n")
		impl.Client.doShutdown("got dispose from frontend")
		return nil, nil
	}
	if impl.Client.GetIsDone() {
		return nil, nil
	}
	// set atoms
	for _, ss := range feUpdate.StateSync {
		impl.Client.Root.SetAtomVal(ss.Atom, ss.Value, false)
	}
	// run events
	for _, event := range feUpdate.Events {
		if event.WaveId == "" {
			if impl.Client.GlobalEventHandler != nil {
				impl.Client.GlobalEventHandler(impl.Client, event)
			}
		} else {
			impl.Client.Root.Event(event.WaveId, event.EventType, event.EventData)
		}
	}
	if feUpdate.Resync {
		return impl.Client.fullRender()
	}
	return impl.Client.incrementalRender()
}

func (impl *VDomServerImpl) VDomUrlRequestCommand(ctx context.Context, data wshrpc.VDomUrlRequestData) chan wshrpc.RespOrErrorUnion[wshrpc.VDomUrlRequestResponse] {
	respChan := make(chan wshrpc.RespOrErrorUnion[wshrpc.VDomUrlRequestResponse])
	writer := NewStreamingResponseWriter(respChan)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				// On panic, send 500 status code
				writer.WriteHeader(http.StatusInternalServerError)
				writer.Write([]byte(fmt.Sprintf("internal server error: %v", r)))
			}
			close(respChan)
		}()

		if impl.Client.UrlHandler == nil {
			writer.WriteHeader(http.StatusInternalServerError)
			writer.Write([]byte("UrlHandler is not set"))
			return
		}

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

		for key, value := range data.Header {
			httpReq.Header.Set(key, value)
		}

		impl.Client.UrlHandler.ServeHTTP(writer, httpReq)
	}()

	return respChan
}
