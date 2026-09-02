package streamclient

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type gatedAckRpc struct {
	mu     sync.Mutex
	allow  bool
	calls  int
	acks   []wshrpc.CommandStreamAckData
	failN  int // fail this many calls, then succeed (if allow is unused)
	useN   bool
}

func (m *gatedAckRpc) StreamDataCommand(data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	return nil
}

func (m *gatedAckRpc) StreamDataAckCommand(data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.useN {
		if m.failN > 0 {
			m.failN--
			return fmt.Errorf("timeout sending request")
		}
		m.acks = append(m.acks, data)
		return nil
	}
	if !m.allow {
		return fmt.Errorf("timeout sending request")
	}
	m.acks = append(m.acks, data)
	return nil
}

func (m *gatedAckRpc) setAllow(v bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.allow = v
}

func (m *gatedAckRpc) snapshot() (calls int, acks []wshrpc.CommandStreamAckData) {
	m.mu.Lock()
	defer m.mu.Unlock()
	acks = append([]wshrpc.CommandStreamAckData(nil), m.acks...)
	return m.calls, acks
}

func waitUntil(t *testing.T, d time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("condition not met within %s", d)
}

func TestCoalesceAcks(t *testing.T) {
	t.Parallel()

	t.Run("higher seq wins", func(t *testing.T) {
		t.Parallel()
		got := coalesceAcks(
			wshrpc.CommandStreamAckData{Id: "s", Seq: 10, RWnd: 100},
			wshrpc.CommandStreamAckData{Id: "s", Seq: 20, RWnd: 50},
		)
		if got.Seq != 20 || got.RWnd != 50 {
			t.Fatalf("got seq=%d rwnd=%d, want seq=20 rwnd=50", got.Seq, got.RWnd)
		}
	})

	t.Run("same seq higher rwnd wins", func(t *testing.T) {
		t.Parallel()
		got := coalesceAcks(
			wshrpc.CommandStreamAckData{Id: "s", Seq: 10, RWnd: 80},
			wshrpc.CommandStreamAckData{Id: "s", Seq: 10, RWnd: 20},
		)
		if got.Seq != 10 || got.RWnd != 80 {
			t.Fatalf("got seq=%d rwnd=%d, want seq=10 rwnd=80", got.Seq, got.RWnd)
		}
	})

	t.Run("fin preserved from older", func(t *testing.T) {
		t.Parallel()
		got := coalesceAcks(
			wshrpc.CommandStreamAckData{Id: "s", Seq: 5, Fin: true},
			wshrpc.CommandStreamAckData{Id: "s", Seq: 15, Fin: false},
		)
		if !got.Fin || got.Seq != 15 {
			t.Fatalf("got seq=%d fin=%v, want seq=15 fin=true", got.Seq, got.Fin)
		}
	})

	t.Run("cancel preserved from newer", func(t *testing.T) {
		t.Parallel()
		got := coalesceAcks(
			wshrpc.CommandStreamAckData{Id: "s", Seq: 5},
			wshrpc.CommandStreamAckData{Id: "s", Seq: 6, Cancel: true, Error: "gone"},
		)
		if !got.Cancel || got.Error != "gone" || got.Seq != 6 {
			t.Fatalf("got seq=%d cancel=%v err=%q", got.Seq, got.Cancel, got.Error)
		}
	})
}

func TestAckRetryAfterSendFailure(t *testing.T) {
	rpc := &gatedAckRpc{useN: true, failN: 1}
	b := NewBroker(rpc)
	b.ackRetryInterval = 10 * time.Millisecond
	defer b.Close()

	_, meta := b.CreateStreamReader("reader", "writer", 1024)
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 10, RWnd: 1000})

	waitUntil(t, time.Second, func() bool {
		_, acks := rpc.snapshot()
		return len(acks) >= 1
	})
	_, acks := rpc.snapshot()
	if acks[0].Seq != 10 || acks[0].Id != meta.Id {
		t.Fatalf("unexpected ack %#v", acks[0])
	}
}

func TestAckCoalesceKeepsLatestAndFin(t *testing.T) {
	rpc := &gatedAckRpc{allow: false}
	b := NewBroker(rpc)
	b.ackRetryInterval = 10 * time.Millisecond
	defer b.Close()

	_, meta := b.CreateStreamReader("reader", "writer", 1024)
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 5, RWnd: 100})
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 15, RWnd: 40})
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 15, RWnd: 40, Fin: true})

	waitUntil(t, time.Second, func() bool {
		calls, _ := rpc.snapshot()
		return calls >= 3
	})

	rpc.setAllow(true)

	waitUntil(t, time.Second, func() bool {
		_, acks := rpc.snapshot()
		for _, ack := range acks {
			if ack.Seq == 15 && ack.Fin {
				return true
			}
		}
		return false
	})

	_, acks := rpc.snapshot()
	for _, ack := range acks {
		if ack.Seq < 15 && !ack.Fin {
			t.Fatalf("stale non-fin ack was delivered after coalesce: %#v", ack)
		}
	}
}

func TestAckCoalescePreservesCancel(t *testing.T) {
	rpc := &gatedAckRpc{allow: false}
	b := NewBroker(rpc)
	b.ackRetryInterval = 10 * time.Millisecond
	defer b.Close()

	_, meta := b.CreateStreamReader("reader", "writer", 1024)
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 8, RWnd: 10})
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 8, Cancel: true, Error: "stream reader not found"})

	waitUntil(t, time.Second, func() bool {
		calls, _ := rpc.snapshot()
		return calls >= 2
	})
	rpc.setAllow(true)

	waitUntil(t, time.Second, func() bool {
		_, acks := rpc.snapshot()
		for _, ack := range acks {
			if ack.Cancel {
				return true
			}
		}
		return false
	})
}

func TestFailedFinDoesNotCleanupReader(t *testing.T) {
	rpc := &gatedAckRpc{allow: false}
	b := NewBroker(rpc)
	b.ackRetryInterval = 10 * time.Millisecond
	defer b.Close()

	_, meta := b.CreateStreamReader("reader", "writer", 1024)
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 3, Fin: true})

	waitUntil(t, time.Second, func() bool {
		calls, _ := rpc.snapshot()
		return calls >= 1
	})

	b.lock.Lock()
	_, readerExists := b.readers[meta.Id]
	_, routeExists := b.writerRoutes[meta.Id]
	b.lock.Unlock()
	if !readerExists || !routeExists {
		t.Fatal("failed Fin ACK must not clean up the reader / writer route (retry needs them)")
	}

	rpc.setAllow(true)
	waitUntil(t, time.Second, func() bool {
		b.lock.Lock()
		defer b.lock.Unlock()
		_, readerExists := b.readers[meta.Id]
		return !readerExists
	})
}

func TestSuccessfulFinCleansUpReader(t *testing.T) {
	rpc := &gatedAckRpc{allow: true}
	b := NewBroker(rpc)
	defer b.Close()

	_, meta := b.CreateStreamReader("reader", "writer", 1024)
	b.SendAck(wshrpc.CommandStreamAckData{Id: meta.Id, Seq: 1, Fin: true})

	waitUntil(t, time.Second, func() bool {
		b.lock.Lock()
		defer b.lock.Unlock()
		_, ok := b.readers[meta.Id]
		return !ok
	})
}

func TestUnknownStreamAckNotRetried(t *testing.T) {
	rpc := &gatedAckRpc{allow: true}
	b := NewBroker(rpc)
	b.ackRetryInterval = 10 * time.Millisecond
	defer b.Close()

	b.SendAck(wshrpc.CommandStreamAckData{Id: "missing-stream", Seq: 1})

	waitUntil(t, time.Second, func() bool {
		// processSendAck logs and returns; give the worker a moment
		time.Sleep(30 * time.Millisecond)
		return true
	})

	b.lock.Lock()
	n := len(b.pendingAcks)
	b.lock.Unlock()
	if n != 0 {
		t.Fatalf("unknown-stream ACK should not be retried, pending=%d", n)
	}
	calls, acks := rpc.snapshot()
	if calls != 0 || len(acks) != 0 {
		t.Fatalf("unknown-stream ACK should not be sent, calls=%d acks=%d", calls, len(acks))
	}
}
