package jobmanager

// Tests for the stream data-path resilience changes (spec:
// .pi/specs/stream-data-path-resilience.md): transient send failures must
// retry FIFO without disconnecting; only sustained failure may disconnect.

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// failThenSucceedSender fails the first N SendData calls, then succeeds.
type failThenSucceedSender struct {
	mu       sync.Mutex
	failN    int
	attempts int
	sent     []wshrpc.CommandStreamData
}

func (f *failThenSucceedSender) SendData(pkt wshrpc.CommandStreamData) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.attempts++
	if f.failN > 0 {
		f.failN--
		return &fakeSendErr{}
	}
	f.sent = append(f.sent, pkt)
	return nil
}

func (f *failThenSucceedSender) snapshot() (attempts int, sent []wshrpc.CommandStreamData) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.attempts, append([]wshrpc.CommandStreamData(nil), f.sent...)
}

type fakeSendErr struct{}

func (*fakeSendErr) Error() string { return "simulated transient congestion" }

// cyclingFailSender alternates between failing runs and successes:
// failRun consecutive failures followed by one success, repeating.
type cyclingFailSender struct {
	mu       sync.Mutex
	failRun  int
	failLeft int
	sent     []wshrpc.CommandStreamData
}

func (c *cyclingFailSender) SendData(pkt wshrpc.CommandStreamData) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.failLeft > 0 {
		c.failLeft--
		return &fakeSendErr{}
	}
	c.sent = append(c.sent, pkt)
	c.failLeft = c.failRun - 1
	return nil
}

func (c *cyclingFailSender) snapshot() (attempts int, sent []wshrpc.CommandStreamData) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.sent) + c.failRun, append([]wshrpc.CommandStreamData(nil), c.sent...)
}

// alwaysFailSender never succeeds.
type alwaysFailSender struct{ delay time.Duration }

func (a *alwaysFailSender) SendData(pkt wshrpc.CommandStreamData) error {
	if a.delay > 0 {
		time.Sleep(a.delay)
	}
	return &fakeSendErr{}
}

// captureStatusFn returns a status-collecting statusFn plus a getter.
func captureStatusFn() (fn func(wshrpc.CommandStreamStatusData), states func() []string) {
	var mu sync.Mutex
	var statesSeen []string
	fn = func(data wshrpc.CommandStreamStatusData) {
		mu.Lock()
		statesSeen = append(statesSeen, data.State)
		mu.Unlock()
	}
	return fn, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), statesSeen...)
	}
}

func withShortRetryThresholds(t *testing.T, maxFails int, maxDur time.Duration) {
	t.Helper()
	oldFails, oldDur, oldInterval := MaxConsecutiveSendFails, MaxSendFailureDuration, SendRetryInterval
	MaxConsecutiveSendFails = maxFails
	MaxSendFailureDuration = maxDur
	SendRetryInterval = 5 * time.Millisecond
	t.Cleanup(func() {
		MaxConsecutiveSendFails, MaxSendFailureDuration, SendRetryInterval = oldFails, oldDur, oldInterval
	})
}

func waitCond(t *testing.T, d time.Duration, cond func() bool) {
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

// T2+T3: transient failures recover; delivery stays ordered and gapless.
func TestTransientSendFailureRecoversInOrder(t *testing.T) {
	withShortRetryThresholds(t, 1000, time.Hour) // effectively disable disconnect gate

	sm := MakeStreamManager()
	sm.SetJobId(t.Name())
	statusFn, states := captureStatusFn()
	sm.SetStatusFn(statusFn)
	defer sm.Close()

	payload := strings.Repeat("abcdefgh", 512) // 4096 bytes = one packet at MaxPacketSize
	sender := &failThenSucceedSender{failN: 3}
	sm.AttachReader(strings.NewReader(payload))
	time.Sleep(50 * time.Millisecond)

	if _, err := sm.ClientConnected("stream-t2", sender, CwndSize, 0); err != nil {
		t.Fatalf("ClientConnected: %v", err)
	}

	waitCond(t, 2*time.Second, func() bool {
		_, sent := sender.snapshot()
		return len(sent) > 0
	})

	attempts, sent := sender.snapshot()
	if len(sent) != 1 {
		t.Fatalf("expected exactly 1 delivered packet, got %d (attempts=%d)", len(sent), attempts)
	}
	if sent[0].Seq != 0 {
		t.Fatalf("first packet seq=%d, want 0", sent[0].Seq)
	}
	if got := sent[0].Data64; len(got) == 0 {
		t.Fatal("delivered packet has empty payload")
	}

	// Must NOT have disconnected
	sm.lock.Lock()
	connected := sm.connected
	streak := sm.sendFailStreak
	sm.lock.Unlock()
	if !connected {
		t.Fatal("transient failures must not disconnect")
	}
	if streak != 0 {
		t.Fatalf("success must reset failure streak, got %d", streak)
	}

	// State transitions: retrying then back to connected
	waitCond(t, time.Second, func() bool {
		for _, s := range states() {
			if s == wshrpc.StreamStateRetrying {
				return true
			}
		}
		return false
	})
	found := states()
	last := found[len(found)-1]
	if last != wshrpc.StreamStateConnected {
		t.Fatalf("last reported state=%q, want connected (all=%v)", last, found)
	}

	// ACK everything; accounting must converge to zero unacked
	seq := int64(len(payload))
	sm.RecvAck(wshrpc.CommandStreamAckData{Id: "stream-t2", Seq: seq, RWnd: CwndSize})
	sm.lock.Lock()
	unacked := sm.sentNotAcked
	sm.lock.Unlock()
	if unacked != 0 {
		t.Fatalf("sentNotAcked=%d after full ACK, want 0", unacked)
	}
}

// T5+T9: sustained failure disconnects (and emits the disk-buffer state).
// Note: we don't assert sm.diskFile here — activateDiskBuffering cannot create
// its wavebase-pathed file in a unit-test environment.
func TestSustainedFailureDisconnectsAndReports(t *testing.T) {
	withShortRetryThresholds(t, 3, time.Minute)

	sm := MakeStreamManager()
	sm.SetJobId(t.Name())
	statusFn, states := captureStatusFn()
	sm.SetStatusFn(statusFn)
	defer sm.Close()

	sender := &alwaysFailSender{}
	sm.AttachReader(strings.NewReader(strings.Repeat("y", 1024)))
	time.Sleep(50 * time.Millisecond)

	started := time.Now()
	if _, err := sm.ClientConnected("stream-t5", sender, CwndSize, 0); err != nil {
		t.Fatalf("ClientConnected: %v", err)
	}

	waitCond(t, 2*time.Second, func() bool {
		sm.lock.Lock()
		defer sm.lock.Unlock()
		return !sm.connected
	})
	if elapsed := time.Since(started); elapsed > 1500*time.Millisecond {
		t.Fatalf("disconnect took too long: %s (gate should fire promptly once sustained)", elapsed)
	}

	waitCond(t, time.Second, func() bool {
		for _, s := range states() {
			if s == wshrpc.StreamStateDiskBuffer {
				return true
			}
		}
		return false
	})
}

// T6: recovery resets the gate — repeated sub-threshold failure bursts must
// not accumulate into a disconnect.
func TestRecoveryResetsFailureGate(t *testing.T) {
	withShortRetryThresholds(t, 4, time.Hour)

	sm := MakeStreamManager()
	sm.SetJobId(t.Name())
	defer sm.Close()

	// Cycles: fail 2, succeed 1, fail 2, succeed 1, ...
	sender := &cyclingFailSender{failRun: 2}

	payload := strings.Repeat("z", 3*MaxPacketSize)
	sm.AttachReader(strings.NewReader(payload))
	time.Sleep(50 * time.Millisecond)

	if _, err := sm.ClientConnected("stream-t6", sender, CwndSize, 0); err != nil {
		t.Fatalf("ClientConnected: %v", err)
	}

	// All 3 packets eventually delivered, still connected.
	waitCond(t, 5*time.Second, func() bool {
		_, sent := sender.snapshot()
		return len(sent) >= 3
	})

	sm.lock.Lock()
	connected := sm.connected
	streak := sm.sendFailStreak
	sm.lock.Unlock()
	if !connected {
		t.Fatal("repeated sub-threshold bursts must not disconnect")
	}
	if streak != 0 {
		t.Fatalf("streak=%d after final success, want 0", streak)
	}

	// Ordering: delivered seqs strictly increasing from 0
	_, sent := sender.snapshot()
	for i, pkt := range sent {
		if pkt.Seq != int64(i)*MaxPacketSize {
			t.Fatalf("out-of-order delivery at %d: seq=%d want %d", i, pkt.Seq, int64(i)*MaxPacketSize)
		}
	}
}

// T10: state transitions emit StreamStatusReport with correct fields.
func TestStatusReportTransitions(t *testing.T) {
	withShortRetryThresholds(t, 1000, time.Hour)

	sm := MakeStreamManager()
	sm.SetJobId("job-status-test")

	var mu sync.Mutex
	var reports []wshrpc.CommandStreamStatusData
	sm.SetStatusFn(func(data wshrpc.CommandStreamStatusData) {
		mu.Lock()
		reports = append(reports, data)
		mu.Unlock()
	})
	defer sm.Close()

	sender := &failThenSucceedSender{failN: 1}
	sm.AttachReader(strings.NewReader("hello"))
	time.Sleep(50 * time.Millisecond)

	if _, err := sm.ClientConnected("stream-status", sender, CwndSize, 0); err != nil {
		t.Fatalf("ClientConnected: %v", err)
	}

	waitCond(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(reports) >= 2
	})

	mu.Lock()
	defer mu.Unlock()
	var sawRetrying, sawConnected bool
	for _, r := range reports {
		if r.JobId != "job-status-test" || r.StreamId != "stream-status" {
			t.Fatalf("bad report identity: %+v", r)
		}
		switch r.State {
		case wshrpc.StreamStateRetrying:
			sawRetrying = true
			if r.RetryCount < 1 {
				t.Fatalf("retrying report RetryCount=%d, want >=1", r.RetryCount)
			}
		case wshrpc.StreamStateConnected:
			sawConnected = true
			if r.RetryCount != 0 {
				t.Fatalf("connected report RetryCount=%d, want 0", r.RetryCount)
			}
		}
	}
	if !sawRetrying || !sawConnected {
		t.Fatalf("missing transitions; saw %v", reports)
	}
}

// Disconnect gate emits disconnected-diskbuffer state.
func TestStatusReportOnDiskBufferTransition(t *testing.T) {
	withShortRetryThresholds(t, 2, time.Minute)

	sm := MakeStreamManager()
	sm.SetJobId(t.Name())

	var mu sync.Mutex
	sawDiskBuffer := false
	sm.SetStatusFn(func(data wshrpc.CommandStreamStatusData) {
		if data.State == wshrpc.StreamStateDiskBuffer {
			mu.Lock()
			sawDiskBuffer = true
			mu.Unlock()
		}
	})
	defer sm.Close()

	sm.AttachReader(strings.NewReader("data"))
	time.Sleep(50 * time.Millisecond)
	sm.ClientConnected("stream-disk", &alwaysFailSender{}, CwndSize, 0)

	waitCond(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return sawDiskBuffer
	})
}
