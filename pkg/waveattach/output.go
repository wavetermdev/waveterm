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

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// renderDebounce is the interval between render ticks. At ~60fps this is
// 16ms; we use 16ms so a full TUI repaint (ESC[2J + redraw, typically < 5ms
// of PTY data) is always consumed before the next render fires.
const renderDebounce = 16 * time.Millisecond

type pendingEvent struct {
	at   time.Time
	data []byte
}

type eventBuffer struct {
	mu      sync.Mutex
	pending []pendingEvent
	flushed bool
}

func makeEventBuffer() *eventBuffer {
	return &eventBuffer{}
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

// unflush switches the buffer back into "buffer pending events" mode. Used
// during resync so events arriving while a fresh snapshot is being read are
// queued (and discarded by the post-snapshot cutoff) instead of being applied
// concurrently to the freshly reset emulator.
func (b *eventBuffer) unflush() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.flushed = false
	b.pending = nil
}

// ViewportRenderer serializes renders to a single writer.
type ViewportRenderer struct {
	mu     sync.Mutex
	vp     *Viewport
	w      io.Writer
	tickCh chan struct{} // signal that new data arrived; render loop debounces
}

func newViewportRenderer(vp *Viewport, w io.Writer) *ViewportRenderer {
	return &ViewportRenderer{vp: vp, w: w, tickCh: make(chan struct{}, 1)}
}

func (vr *ViewportRenderer) Render() {
	vr.mu.Lock()
	defer vr.mu.Unlock()
	vr.vp.Render(vr.w)
}

// requestRender signals the render loop that new PTY data has arrived.
// The render loop debounces rapid signals into a single Render call.
func (vr *ViewportRenderer) requestRender() {
	select {
	case vr.tickCh <- struct{}{}:
	default:
	}
}

// runRenderLoop coalesces PTY events into renders. The first event after a
// quiet period starts a timer; when it fires, render is called. New events
// arriving while the timer is running are ignored (data already in xterm-go).
// Uses time.Timer (not Ticker) to avoid the Ticker.Reset channel-drain issue.
func (vr *ViewportRenderer) runRenderLoop(ctx context.Context) {
	timer := time.NewTimer(renderDebounce)
	timer.Stop()
	timerArmed := false
	for {
		select {
		case <-ctx.Done():
			if timerArmed {
				timer.Stop()
			}
			return
		case <-vr.tickCh:
			if !timerArmed {
				timer.Reset(renderDebounce)
				timerArmed = true
			}
		case <-timer.C:
			timerArmed = false
			// drain any surplus ticks that arrived during the wait
			select {
			case <-vr.tickCh:
			default:
			}
			vr.Render()
		}
	}
}

// StreamOutput reads the current screen state via snapshot, then subscribes to
// live events. After each event, a render is requested through the debounced
// render loop so that rapid PTY bursts (e.g. full-screen TUI redraws) are
// coalesced into a single frame render rather than painting mid-frame state.
//
// resyncCh triggers a manual recovery: the xterm-go emulator is rebuilt from
// scratch and a fresh snapshot is replayed. Used when local state has drifted
// from the remote terminal (e.g. emulator divergence on autocomplete popups).
func StreamOutput(ctx context.Context, rpcClient *wshutil.WshRpc, blockId string, vr *ViewportRenderer, resyncCh <-chan struct{}) error {
	vp := vr.vp
	buf := makeEventBuffer()
	blockRef := waveobj.MakeORef(waveobj.OType_Block, blockId).String()

	go vr.runRenderLoop(ctx)

	rpcClient.EventListener.On(wps.Event_BlockFile, func(ev *wps.WaveEvent) {
		var fed wps.WSFileEventData
		if err := utilfn.ReUnmarshal(&fed, ev.Data); err != nil {
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
		if err := buf.write(time.Now(), data, vp); err != nil {
			return
		}
		vr.requestRender()
	})

	subReq := wps.SubscriptionRequest{
		Event:  wps.Event_BlockFile,
		Scopes: []string{blockRef},
	}
	if err := wshclient.EventSubCommand(rpcClient, subReq, nil); err != nil {
		return fmt.Errorf("subscribing to blockfile events: %w", err)
	}

	if err := loadSnapshotAndFlush(rpcClient, blockId, vp, buf); err != nil {
		return err
	}
	vr.Render()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-resyncCh:
			buf.unflush()
			vp.Reset()
			if err := loadSnapshotAndFlush(rpcClient, blockId, vp, buf); err != nil {
				return err
			}
			vr.Render()
		}
	}
}

// loadSnapshotAndFlush reads the current block snapshot into vp, then sets a
// cutoff so events that arrived during snapshot transfer are discarded. Their
// bytes are almost certainly already in the snapshot — applying them again
// would duplicate-feed xterm-go and drift its state away from the real remote.
// The trade-off is a brief loss window during snapshot transfer.
func loadSnapshotAndFlush(rpcClient *wshutil.WshRpc, blockId string, vp *Viewport, buf *eventBuffer) error {
	if err := readSnapshot(rpcClient, blockId, vp); err != nil {
		return fmt.Errorf("reading snapshot: %w", err)
	}
	cutoff := time.Now()
	if err := buf.flush(cutoff, vp); err != nil {
		return err
	}
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
