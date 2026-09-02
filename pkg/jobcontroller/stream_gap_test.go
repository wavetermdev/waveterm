package jobcontroller

// Tests for the stream-gap fixes (spec .pi/specs/stream-gap-on-reconnect.md):
// Fix A (post-close drain in restartStreaming), gap telemetry classification,
// and B2 (shutdown drain of job readers).

import (
	"encoding/base64"
	"errors"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/streamclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type nopAckSender struct{}

func (nopAckSender) SendAck(ackPk wshrpc.CommandStreamAckData) {}

// makeBufferedReader builds a reader with the given chunks already received
// (buffered + ACKed, mirroring RecvData's ack-on-arrival behavior).
func makeBufferedReader(t *testing.T, id string, chunks ...string) *streamclient.Reader {
	t.Helper()
	reader := streamclient.NewReader(id, 64*1024, nopAckSender{})
	seq := int64(0)
	for _, c := range chunks {
		reader.RecvData(wshrpc.CommandStreamData{
			Id:     id,
			Seq:    seq,
			Data64: base64.StdEncoding.EncodeToString([]byte(c)),
		})
		seq += int64(len(c))
	}
	return reader
}

// T1: bytes ACKed and buffered, then Close() before any Read — the exact
// Read-vs-Close race — must be recovered by the post-close drain.
func TestPostCloseDrainRecoversBufferedBytes(t *testing.T) {
	reader := makeBufferedReader(t, "s-t1", "hello", "world")
	reader.Close() // consumer never read: buffer still holds 10 bytes

	var appended []byte
	n := drainJobReaderBuffer("job-t1", reader, func(data []byte) error {
		appended = append(appended, data...)
		return nil
	})

	if n != 10 {
		t.Fatalf("recovered %d bytes, want 10", n)
	}
	if string(appended) != "helloworld" {
		t.Fatalf("appended %q, want %q", appended, "helloworld")
	}
}

// T2: no double-append. Bytes consumed via Read are gone from the buffer;
// post-close drain returns only the unread remainder.
func TestPostCloseDrainNoDoubleAppend(t *testing.T) {
	reader := makeBufferedReader(t, "s-t2", "abcdef")
	buf := make([]byte, 4) // consume "abcd" like runOutputLoop would
	if n, err := reader.Read(buf); err != nil || n != 4 {
		t.Fatalf("Read = (%d, %v), want (4, nil)", n, err)
	}
	readPart := string(buf[:4])
	reader.Close()

	var appended []byte
	drainJobReaderBuffer("job-t2", reader, func(data []byte) error {
		appended = append(appended, data...)
		return nil
	})
	if drainJobReaderBuffer("job-t2", reader, func(data []byte) error { return nil }) != 0 {
		t.Fatal("second drain should be empty")
	}

	total := readPart + string(appended)
	if total != "abcdef" {
		t.Fatalf("total=%q, want %q (no loss, no duplication)", total, "abcdef")
	}
}

// T3: idle reader (empty buffer) — drain is a no-op.
func TestDrainEmptyBufferIsNoop(t *testing.T) {
	reader := makeBufferedReader(t, "s-t3") // nothing received
	reader.Close()

	appendCalled := false
	n := drainJobReaderBuffer("job-t3", reader, func(data []byte) error {
		appendCalled = true
		return nil
	})
	if n != 0 || appendCalled {
		t.Fatalf("drain on empty buffer returned n=%d appendCalled=%v, want 0/false", n, appendCalled)
	}
}

// T4: append failure is contained — returns 0 (loss surfaces as a gap later),
// does not panic or retry.
func TestDrainAppendErrorContained(t *testing.T) {
	reader := makeBufferedReader(t, "s-t4", "data")
	reader.Close()

	calls := 0
	n := drainJobReaderBuffer("job-t4", reader, func(data []byte) error {
		calls++
		return errors.New("simulated WFS failure")
	})
	if n != 0 {
		t.Fatalf("n=%d after append error, want 0", n)
	}
	if calls != 1 {
		t.Fatalf("appendFn called %d times, want exactly 1 (no retry)", calls)
	}
}

// T6: gap telemetry distinguishes supersession class from process-restart class.
func TestClassifyGapLoss(t *testing.T) {
	if got := classifyGapLoss(true); got != "supersession" {
		t.Fatalf("classifyGapLoss(true) = %q, want supersession", got)
	}
	if got := classifyGapLoss(false); got != "process-restart" {
		t.Fatalf("classifyGapLoss(false) = %q, want process-restart", got)
	}
}

// T7: shutdown drain iterates all registered readers and persists per-job
// buffered bytes; empty readers contribute nothing.
func TestShutdownDrainAllJobReaders(t *testing.T) {
	// Deterministic start: other tests in this package leave readers behind.
	jobReaders.ForEach(func(k string, _ *streamclient.Reader) { jobReaders.Delete(k) })

	r1 := makeBufferedReader(t, "s-t7a", "aaa")
	jobReaders.Set("job-t7a", r1)
	defer jobReaders.Delete("job-t7a")

	r2 := makeBufferedReader(t, "s-t7b", "bb", "cc")
	jobReaders.Set("job-t7b", r2)
	defer jobReaders.Delete("job-t7b")

	r3 := makeBufferedReader(t, "s-t7c") // empty
	jobReaders.Set("job-t7c", r3)
	defer jobReaders.Delete("job-t7c")

	got := map[string][]byte{}
	// NOTE: do not assert drainAllJobReadersWith's global total — parallel tests
	// in this package register their own readers concurrently.
	drainAllJobReadersWith(func(jobId string, data []byte) error {
		got[jobId] = append(got[jobId], data...)
		return nil
	})

	if string(got["job-t7a"]) != "aaa" {
		t.Fatalf("job-t7a=%q, want aaa", got["job-t7a"])
	}
	if string(got["job-t7b"]) != "bbcc" {
		t.Fatalf("job-t7b=%q, want bbcc", got["job-t7b"])
	}
	if _, ok := got["job-t7c"]; ok {
		t.Fatal("empty reader should not invoke appendFn")
	}
}

// B2 ordering guarantee at the unit level: draining works on closed readers
// (StopAllBlockControllersForShutdown may close things concurrently with
// doShutdown's drain).
func TestShutdownDrainAfterClose(t *testing.T) {
	r1 := makeBufferedReader(t, "s-t7close", "tail")
	jobReaders.Set("job-t7close", r1)
	defer jobReaders.Delete("job-t7close")
	r1.Close()

	total := drainAllJobReadersWith(func(jobId string, data []byte) error { return nil })
	if total != 4 {
		t.Fatalf("total=%d after close, want 4", total)
	}
}
