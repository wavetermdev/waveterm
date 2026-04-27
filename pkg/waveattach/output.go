// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type pendingEvent struct {
	at   time.Time
	data []byte
}

type eventBuffer struct {
	mu      sync.Mutex
	pending []pendingEvent
	flushed bool
}

func newEventBuffer() *eventBuffer {
	return &eventBuffer{}
}

func (b *eventBuffer) add(at time.Time, data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.flushed {
		return
	}
	b.pending = append(b.pending, pendingEvent{at: at, data: data})
}

func (b *eventBuffer) flush(cutoff time.Time, w io.Writer) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ev := range b.pending {
		if ev.at.After(cutoff) {
			if _, err := w.Write(ev.data); err != nil {
				return err
			}
		}
	}
	b.pending = nil
	b.flushed = true
	return nil
}

func (b *eventBuffer) write(at time.Time, data []byte, w io.Writer) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.flushed {
		b.pending = append(b.pending, pendingEvent{at: at, data: data})
		return nil
	}
	_, err := w.Write(data)
	return err
}

// StreamOutput subscribes to blockfile events, reads the term snapshot, then
// forwards live appends to w. Returns when ctx is cancelled.
func StreamOutput(ctx context.Context, rpcClient *wshutil.WshRpc, blockId string, w io.Writer) error {
	buf := newEventBuffer()
	blockRef := waveobj.MakeORef(waveobj.OType_Block, blockId).String()

	rpcClient.EventListener.On(wps.Event_BlockFile, func(ev *wps.WaveEvent) {
		fed, ok := ev.Data.(*wps.WSFileEventData)
		if !ok {
			return
		}
		if fed.ZoneId != blockId || fed.FileName != wavebase.BlockFile_Term {
			return
		}
		if fed.FileOp != wps.FileOp_Append {
			return
		}
		data, err := base64.StdEncoding.DecodeString(fed.Data64)
		if err != nil {
			return
		}
		_ = buf.write(time.Now(), data, w)
	})

	subReq := wps.SubscriptionRequest{
		Event:  wps.Event_BlockFile,
		Scopes: []string{blockRef},
	}
	if err := wshclient.EventSubCommand(rpcClient, subReq, nil); err != nil {
		return fmt.Errorf("subscribing to blockfile events: %w", err)
	}

	if err := readSnapshot(rpcClient, blockId, w); err != nil {
		return fmt.Errorf("reading snapshot: %w", err)
	}
	cutoff := time.Now()
	if err := buf.flush(cutoff, w); err != nil {
		return err
	}

	<-ctx.Done()
	return nil
}

func readSnapshot(rpcClient *wshutil.WshRpc, blockId string, w io.Writer) error {
	broker := rpcClient.StreamBroker
	if broker == nil {
		return fmt.Errorf("stream broker not available")
	}

	readerRouteId, err := wshclient.ControlGetRouteIdCommand(rpcClient, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		return fmt.Errorf("getting route id: %w", err)
	}
	if readerRouteId == "" {
		return fmt.Errorf("no route to receive data")
	}

	reader, streamMeta := broker.CreateStreamReader(readerRouteId, "", 64*1024)
	defer reader.Close()

	data := wshrpc.CommandWaveFileReadStreamData{
		ZoneId:     blockId,
		Name:       wavebase.BlockFile_Term,
		StreamMeta: *streamMeta,
	}

	_, err = wshclient.WaveFileReadStreamCommand(rpcClient, data, nil)
	if err != nil {
		return fmt.Errorf("starting stream read: %w", err)
	}

	_, err = io.Copy(w, reader)
	if err != nil {
		return fmt.Errorf("reading stream: %w", err)
	}
	return nil
}
