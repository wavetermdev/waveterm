// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sse

import (
	"bytes"
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type stalledWriter struct {
	*httptest.ResponseRecorder
	started  chan struct{}
	release  chan struct{}
	once     sync.Once
	writeErr error
}

func (w *stalledWriter) SetWriteDeadline(time.Time) error { return nil }

func (w *stalledWriter) Write(p []byte) (int, error) {
	if bytes.HasPrefix(p, []byte("data: ")) {
		w.once.Do(func() { close(w.started) })
		<-w.release
		if w.writeErr != nil {
			return 0, w.writeErr
		}
	}
	return w.ResponseRecorder.Write(p)
}

func makeFullQueue(t *testing.T, writeErr error) (*SSEHandlerCh, *stalledWriter, func(), context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	w := &stalledWriter{
		ResponseRecorder: httptest.NewRecorder(),
		started:          make(chan struct{}),
		release:          make(chan struct{}),
		writeErr:         writeErr,
	}
	h := MakeSSEHandlerCh(w, ctx)
	var releaseOnce sync.Once
	t.Cleanup(func() {
		cancel()
		releaseOnce.Do(func() { close(w.release) })
		h.Close()
	})
	if err := h.SetupSSE(); err != nil {
		t.Fatal(err)
	}
	if err := h.WriteData("first"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-w.started:
	case <-time.After(5 * time.Second):
		t.Fatal("writer did not start")
	}
	for i := 0; i < cap(h.writeCh); i++ {
		if err := h.WriteData("queued"); err != nil {
			t.Fatal(err)
		}
	}
	return h, w, func() { releaseOnce.Do(func() { close(w.release) }) }, cancel
}

func TestFullQueuePreservesFinishOnClose(t *testing.T) {
	h, w, release, _ := makeFullQueue(t, nil)
	if err := h.SetupSSE(); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- h.AiMsgFinish("", nil) }()
	select {
	case err := <-finished:
		t.Fatalf("finish returned before queue space was available: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	closed := make(chan struct{})
	go func() { h.Close(); close(closed) }()
	release()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("finish remained blocked after writer resumed")
	}
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("Close remained blocked after writer resumed")
	}
	body := w.Body.String()
	if strings.Count(body, SSEStreamStartMsg) != 1 || strings.Count(body, "data: queued\n\n") != cap(h.writeCh) || strings.Count(body, `{"type":"finish"}`) != 1 || strings.Count(body, "data: [DONE]\n\n") != 1 {
		t.Fatalf("stream lost queued messages or its terminal event: %q", body)
	}
}

func TestFullQueueReturnsWriterFailure(t *testing.T) {
	wantErr := errors.New("client write failed")
	h, _, release, _ := makeFullQueue(t, wantErr)
	finished := make(chan error, 1)
	go func() { finished <- h.AiMsgFinish("", nil) }()
	release()
	select {
	case err := <-finished:
		if !errors.Is(err, wantErr) {
			t.Fatalf("got %v, want %v", err, wantErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("enqueue remained blocked after writer failure")
	}
}

func TestFullQueueReturnsCancellation(t *testing.T) {
	h, _, release, cancel := makeFullQueue(t, nil)
	defer cancel()
	finished := make(chan error, 1)
	go func() { finished <- h.AiMsgFinish("", nil) }()
	cancel()
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v, want cancellation", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("enqueue remained blocked after cancellation")
	}
	release()
}
