// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveapp

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/wavetermdev/waveterm/tsunami/rpc"
	"github.com/wavetermdev/waveterm/tsunami/rpctypes"
	"github.com/wavetermdev/waveterm/tsunami/util"
)

type WaveAppServerImpl struct {
	Client  *Client
	BlockId string
}

func (*WaveAppServerImpl) WshServerImpl() {}

func (impl *WaveAppServerImpl) VDomRenderCommand(ctx context.Context, feUpdate rpctypes.VDomFrontendUpdate) chan rpc.RespOrErrorUnion[*rpctypes.VDomBackendUpdate] {
	respChan := make(chan rpc.RespOrErrorUnion[*rpctypes.VDomBackendUpdate], 5)
	defer func() {
		panicErr := util.PanicHandler("VDomRenderCommand", recover())
		if panicErr != nil {
			respChan <- rpc.RespOrErrorUnion[*rpctypes.VDomBackendUpdate]{
				Error: panicErr,
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

	impl.Client.Root.RenderTs = feUpdate.Ts

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
	// update refs
	for _, ref := range feUpdate.RefUpdates {
		impl.Client.Root.UpdateRef(ref)
	}

	var update *rpctypes.VDomBackendUpdate
	var err error

	if feUpdate.Resync || true {
		update, err = impl.Client.fullRender()
	} else {
		update, err = impl.Client.incrementalRender()
	}
	update.CreateTransferElems()

	if err != nil {
		respChan <- rpc.RespOrErrorUnion[*rpctypes.VDomBackendUpdate]{
			Error: err,
		}
		close(respChan)
		return respChan
	}

	// Split the update into chunks and send them sequentially
	updates := rpctypes.SplitBackendUpdate(update)
	go func() {
		defer func() {
			util.PanicHandler("VDomRenderCommand:splitUpdates", recover())
		}()
		defer close(respChan)
		for _, splitUpdate := range updates {
			respChan <- rpc.RespOrErrorUnion[*rpctypes.VDomBackendUpdate]{
				Response: splitUpdate,
			}
		}
	}()

	return respChan
}

func (impl *WaveAppServerImpl) VDomUrlRequestCommand(ctx context.Context, data rpc.VDomUrlRequestData) chan rpc.RespOrErrorUnion[rpc.VDomUrlRequestResponse] {
	respChan := make(chan rpc.RespOrErrorUnion[rpc.VDomUrlRequestResponse])
	writer := NewStreamingResponseWriter(respChan)

	go func() {
		defer close(respChan) // Declared first, so it executes last
		defer writer.Close()  // Ensures writer is closed before the channel is closed

		defer func() {
			panicErr := util.PanicHandler("VDomUrlRequestCommand", recover())
			if panicErr != nil {
				writer.WriteHeader(http.StatusInternalServerError)
				writer.Write([]byte(fmt.Sprintf("internal server error: %v", panicErr)))
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
		if httpReq.URL.Path == "/wave/global.css" && impl.Client.GlobalStylesOption != nil {
			ServeFileOption(writer, httpReq, *impl.Client.GlobalStylesOption)
			return
		}
		if impl.Client.OverrideUrlHandler != nil {
			impl.Client.OverrideUrlHandler.ServeHTTP(writer, httpReq)
			return
		}
		impl.Client.UrlHandlerMux.ServeHTTP(writer, httpReq)
	}()

	return respChan
}
