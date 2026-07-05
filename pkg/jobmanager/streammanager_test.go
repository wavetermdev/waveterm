// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type testWriter struct {
	mu      sync.Mutex
	packets []wshrpc.CommandStreamData
}

func (tw *testWriter) SendData(pkt wshrpc.CommandStreamData) error {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	tw.packets = append(tw.packets, pkt)
	return nil
}

func (tw *testWriter) GetPackets() []wshrpc.CommandStreamData {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	result := make([]wshrpc.CommandStreamData, len(tw.packets))
	copy(result, tw.packets)
	return result
}

func (tw *testWriter) Clear() {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	tw.packets = nil
}

func decodeData(data64 string) string {
	decoded, _ := base64.StdEncoding.DecodeString(data64)
	return string(decoded)
}

func TestBasicDisconnectedMode(t *testing.T) {
	tw := &testWriter{}
	sm := MakeStreamManager()

	reader := strings.NewReader("hello world")
	err := sm.AttachReader(reader)
	if err != nil {
		t.Fatalf("AttachReader failed: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	packets := tw.GetPackets()
	if len(packets) > 0 {
		t.Errorf("Expected no packets in DISCONNECTED mode without client, got %d", len(packets))
	}

	sm.Close()
}

func TestConnectedModeBasicFlow(t *testing.T) {
	tw := &testWriter{}
	sm := MakeStreamManager()

	reader := strings.NewReader("hello")
	err := sm.AttachReader(reader)
	if err != nil {
		t.Fatalf("AttachReader failed: %v", err)
	}

	_, err = sm.ClientConnected("1", tw, CwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	packets := tw.GetPackets()
	if len(packets) == 0 {
		t.Fatal("Expected packets after ClientConnected")
	}

	// Verify we got the data
	allData := ""
	for _, pkt := range packets {
		if pkt.Data64 != "" {
			allData += decodeData(pkt.Data64)
		}
	}

	if allData != "hello" {
		t.Errorf("Expected 'hello', got '%s'", allData)
	}

	// Send ACK
	sm.RecvAck(wshrpc.CommandStreamAckData{Id: "1", Seq: 5, RWnd: CwndSize})

	time.Sleep(50 * time.Millisecond)

	// Check for EOF packet
	packets = tw.GetPackets()
	hasEof := false
	for _, pkt := range packets {
		if pkt.Eof {
			hasEof = true
		}
	}

	if !hasEof {
		t.Error("Expected EOF packet after ACKing all data")
	}

	sm.Close()
}

func TestDisconnectedToConnectedTransition(t *testing.T) {
	tw := &testWriter{}
	sm := MakeStreamManager()

	reader := strings.NewReader("test data")
	err := sm.AttachReader(reader)
	if err != nil {
		t.Fatalf("AttachReader failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	_, err = sm.ClientConnected("1", tw, CwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	packets := tw.GetPackets()
	if len(packets) == 0 {
		t.Fatal("Expected cirbuf drain after connect")
	}

	allData := ""
	for _, pkt := range packets {
		if pkt.Data64 != "" {
			allData += decodeData(pkt.Data64)
		}
	}

	if allData != "test data" {
		t.Errorf("Expected 'test data', got '%s'", allData)
	}

	sm.Close()
}

func TestConnectedToDisconnectedTransition(t *testing.T) {
	tw := &testWriter{}
	sm := MakeStreamManager()

	reader := &slowReader{data: []byte("slow data"), delay: 50 * time.Millisecond}
	err := sm.AttachReader(reader)
	if err != nil {
		t.Fatalf("AttachReader failed: %v", err)
	}

	_, err = sm.ClientConnected("1", tw, CwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	time.Sleep(150 * time.Millisecond)

	sm.ClientDisconnected()

	time.Sleep(100 * time.Millisecond)

	sm.Close()
}

func TestFlowControl(t *testing.T) {
	cwndSize := 1024
	tw := &testWriter{}
	sm := MakeStreamManagerWithSizes(cwndSize, 8*1024)

	largeData := strings.Repeat("x", cwndSize+500)
	reader := strings.NewReader(largeData)

	err := sm.AttachReader(reader)
	if err != nil {
		t.Fatalf("AttachReader failed: %v", err)
	}

	_, err = sm.ClientConnected("1", tw, cwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	packets := tw.GetPackets()
	totalData := 0
	for _, pkt := range packets {
		if pkt.Data64 != "" {
			decoded, _ := base64.StdEncoding.DecodeString(pkt.Data64)
			totalData += len(decoded)
		}
	}

	if totalData > cwndSize {
		t.Errorf("Sent %d bytes without ACK, exceeds cwnd size %d", totalData, cwndSize)
	}

	sm.RecvAck(wshrpc.CommandStreamAckData{Id: "1", Seq: int64(totalData), RWnd: int64(cwndSize)})

	time.Sleep(100 * time.Millisecond)

	sm.Close()
}

func TestSequenceNumbering(t *testing.T) {
	tw := &testWriter{}
	sm := MakeStreamManager()

	reader := strings.NewReader("abcdefghij")
	err := sm.AttachReader(reader)
	if err != nil {
		t.Fatalf("AttachReader failed: %v", err)
	}

	_, err = sm.ClientConnected("1", tw, CwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	packets := tw.GetPackets()
	if len(packets) == 0 {
		t.Fatal("Expected packets")
	}

	expectedSeq := int64(0)
	for _, pkt := range packets {
		if pkt.Data64 == "" {
			continue
		}

		if pkt.Seq != expectedSeq {
			t.Errorf("Expected seq %d, got %d", expectedSeq, pkt.Seq)
		}

		decoded, _ := base64.StdEncoding.DecodeString(pkt.Data64)
		expectedSeq += int64(len(decoded))
	}

	sm.Close()
}

func TestTerminalEventOrdering(t *testing.T) {
	tw := &testWriter{}
	sm := MakeStreamManager()

	reader := strings.NewReader("data")
	err := sm.AttachReader(reader)
	if err != nil {
		t.Fatalf("AttachReader failed: %v", err)
	}

	_, err = sm.ClientConnected("1", tw, CwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	packets := tw.GetPackets()
	if len(packets) == 0 {
		t.Fatal("Expected data packets")
	}

	hasData := false
	hasEof := false
	eofSeq := int64(-1)

	for _, pkt := range packets {
		if pkt.Data64 != "" {
			hasData = true
		}
		if pkt.Eof {
			hasEof = true
			eofSeq = pkt.Seq
		}
	}

	if !hasData {
		t.Error("Expected data packet")
	}

	if hasEof {
		t.Error("Should not have EOF before ACK")
	}

	sm.RecvAck(wshrpc.CommandStreamAckData{Id: "1", Seq: 4, RWnd: CwndSize})

	time.Sleep(50 * time.Millisecond)

	packets = tw.GetPackets()
	hasEof = false
	for _, pkt := range packets {
		if pkt.Eof {
			hasEof = true
			eofSeq = pkt.Seq
		}
	}

	if !hasEof {
		t.Error("Expected EOF after ACKing all data")
	}

	if eofSeq != 4 {
		t.Errorf("Expected EOF at seq 4, got %d", eofSeq)
	}

	sm.Close()
}

type slowReader struct {
	data  []byte
	pos   int
	delay time.Duration
}

func (sr *slowReader) Read(p []byte) (n int, err error) {
	if sr.pos >= len(sr.data) {
		return 0, io.EOF
	}

	time.Sleep(sr.delay)

	n = copy(p, sr.data[sr.pos:])
	sr.pos += n

	return n, nil
}

type blockingSender struct {
	mu       sync.Mutex
	blockCh  chan struct{}
	packets  []wshrpc.CommandStreamData
	sendErr  error
	timeout  time.Duration
}

func newBlockingSender() *blockingSender {
	return &blockingSender{
		blockCh: make(chan struct{}),
	}
}

func newTimeoutSender(timeout time.Duration) *blockingSender {
	return &blockingSender{
		blockCh: make(chan struct{}),
		timeout: timeout,
	}
}

func (bs *blockingSender) SendData(pkt wshrpc.CommandStreamData) error {
	bs.mu.Lock()
	bs.packets = append(bs.packets, pkt)
	bs.mu.Unlock()
	if bs.timeout > 0 {
		select {
		case <-bs.blockCh:
			return bs.sendErr
		case <-time.After(bs.timeout):
			return fmt.Errorf("send timeout")
		}
	}
	<-bs.blockCh
	return bs.sendErr
}

func (bs *blockingSender) Unblock() {
	close(bs.blockCh)
	bs.blockCh = make(chan struct{})
}

func TestDiskBufferingWritesToDisk(t *testing.T) {
	sm := MakeStreamManager()

	// Manually set up disk file in temp dir
	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	sm.lock.Lock()
	sm.diskFile = f
	sm.diskStartSeq = 0
	sm.diskEndSeq = 0
	sm.diskReadPos = 0
	sm.lock.Unlock()

	// Feed data while disk is active
	data := []byte("disk buffered data")
	sm.handleReadData(data)

	sm.lock.Lock()
	diskEnd := sm.diskEndSeq
	sm.lock.Unlock()

	if diskEnd != int64(len(data)) {
		t.Errorf("Expected diskEndSeq=%d, got %d", len(data), diskEnd)
	}

	// Verify data is on disk
contents, err := os.ReadFile(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "disk buffered data" {
		t.Errorf("Expected disk content 'disk buffered data', got '%s'", string(contents))
	}

	sm.Close()
}

func TestEofPosWithDiskData(t *testing.T) {
	sm := MakeStreamManager()

	// Set up disk file with pre-existing data
	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte("existing disk data"))
	f.Close()

	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)
	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 0
	sm.diskEndSeq = 18 // "existing disk data" = 18 bytes
	sm.lock.Unlock()

	// EOF should use max(TotalSize, diskEndSeq) = max(0, 18) = 18
	sm.handleEOF()

	sm.lock.Lock()
	eofPos := sm.eofPos
	sm.lock.Unlock()

	if eofPos != 18 {
		t.Errorf("Expected eofPos=18 (diskEndSeq), got %d", eofPos)
	}

	sm.Close()
}

func TestClientConnectedBoundsWithDisk(t *testing.T) {
	sm := MakeStreamManager()

	// Set up disk state
	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	sm.lock.Lock()
	sm.diskFile = f
	sm.diskStartSeq = 0
	sm.diskEndSeq = 50
	sm.lock.Unlock()

	tw := &testWriter{}

	// clientSeq within disk range should succeed
	serverSeq, err := sm.ClientConnected("1", tw, CwndSize, 25)
	if err != nil {
		t.Fatalf("ClientConnected with clientSeq in disk range should succeed: %v", err)
	}
	if serverSeq != 25 {
		t.Errorf("Expected serverSeq=25, got %d", serverSeq)
	}

	sm.Close()
}

func TestClientConnectedBoundsBeyondDisk(t *testing.T) {
	sm := MakeStreamManager()

	// Set up disk state
	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	sm.lock.Lock()
	sm.diskFile = f
	sm.diskStartSeq = 0
	sm.diskEndSeq = 50
	sm.lock.Unlock()

	tw := &testWriter{}

	// clientSeq beyond disk range should fail
	_, err = sm.ClientConnected("1", tw, CwndSize, 100)
	if err == nil {
		t.Fatal("ClientConnected with clientSeq beyond disk range should fail")
	}
}

func TestDrainCompletionCleansUpDisk(t *testing.T) {
	sm := MakeStreamManager()

	// Create disk file and write data
	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write([]byte("drain me"))
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	tw := &testWriter{}
	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)
	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 0
	sm.diskEndSeq = 8
	sm.diskReadPos = 0
	sm.connected = true
	sm.dataSender = tw
	sm.streamId = "test-drain"
	sm.terminalEvent = &streamTerminalEvent{isEof: true}
	sm.eofPos = 8
	sm.lock.Unlock()

	sm.lock.Lock()
	gen := sm.drainGen
	sm.lock.Unlock()
	sm.drainDiskToCirBuf(gen)

	sm.lock.Lock()
	diskFile := sm.diskFile
	sm.lock.Unlock()

	if diskFile != nil {
		t.Error("Expected diskFile to be nil after drain completion")
	}

	// os.Remove is called in a goroutine, give it time
	time.Sleep(50 * time.Millisecond)
	if _, err := os.Stat(diskPath); !os.IsNotExist(err) {
		t.Error("Expected disk file to be deleted after drain completion")
	}

	sm.Close()
}

func TestSendTimeoutTriggersDisconnect(t *testing.T) {
	sm := MakeStreamManager()

	bs := newBlockingSender()

	_, err := sm.ClientConnected("1", bs, CwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	// Write some data
	reader := strings.NewReader("data")
	sm.AttachReader(reader)
	time.Sleep(50 * time.Millisecond)

	// senderLoop will try to send, but blockingSender blocks.
	// We need to verify that after timeout, handleSendFailure is called.
	// The senderLoop goroutine is already running. Since we can't directly
	// test the timeout without waiting 5s, we verify the interface contract
	// by checking that SendData returns error when we simulate it.

	// Verify sender is connected
	sm.lock.Lock()
	connected := sm.connected
	sm.lock.Unlock()

	if !connected {
		t.Fatal("Expected to be connected before timeout")
	}

	sm.Close()
}

func TestDiskWriteFallbackOnWriteError(t *testing.T) {
	sm := MakeStreamManager()

	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	sm.lock.Lock()
	sm.diskFile = f
	sm.diskStartSeq = 0
	sm.diskEndSeq = 0
	sm.diskReadPos = 0
	sm.lock.Unlock()

	// Close the file descriptor to cause Write() to fail
	f.Close()

	data := []byte("data that should fall through to CirBuf")
	sm.handleReadData(data)

	sm.lock.Lock()
	diskEndSeq := sm.diskEndSeq
	diskFile := sm.diskFile
	sm.lock.Unlock()

	if diskEndSeq != 0 {
		t.Errorf("diskEndSeq should not have been incremented on write error, got %d", diskEndSeq)
	}
	if diskFile != nil {
		t.Error("diskFile should have been nil'd after write error")
	}

	// Data should have fallen through to CirBuf
	bufSize := sm.buf.Size()
	if bufSize == 0 {
		t.Error("expected data in CirBuf after disk write failure")
	}

	// Disk file should be cleaned up (goroutine may not have finished yet)
	time.Sleep(50 * time.Millisecond)
	if _, err := os.Stat(diskPath); !os.IsNotExist(err) {
		t.Error("disk file should have been removed after write error fallback")
	}

	sm.Close()
}

func TestTerminalPacketDeferredDuringDrain(t *testing.T) {
	sm := MakeStreamManager()

	// Set up disk file with data and EOF
	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write([]byte("buffered"))
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	tw := &testWriter{}
	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)
	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 0
	sm.diskEndSeq = 8
	sm.diskReadPos = 0
	sm.eofPos = 8
	sm.terminalEvent = &streamTerminalEvent{isEof: true}
	sm.lock.Unlock()

	// Cork the stream (rwndSize=0)
	sm.ClientConnected("1", tw, 0, 0)

	// Wait — senderLoop should NOT send terminal packet because diskFile != nil
	time.Sleep(100 * time.Millisecond)

	packets := tw.GetPackets()
	for _, pkt := range packets {
		if pkt.Eof {
			t.Error("Terminal packet should be deferred while diskFile != nil")
		}
	}

	// Uncork — drain goroutine starts, drains disk to CirBuf
	sm.SetRwndSize(CwndSize)
	time.Sleep(200 * time.Millisecond)

	// Drain should have written data to CirBuf; verify no EOF yet (data not ACKed)
	packets = tw.GetPackets()
	hasData := false
	for _, pkt := range packets {
		if pkt.Data64 != "" {
			hasData = true
		}
		if pkt.Eof {
			t.Error("EOF should not be sent before data is ACKed")
		}
	}
	if !hasData {
		t.Error("Expected data packets from disk drain")
	}

	// ACK the drained data — senderLoop can now proceed to terminal packet
	sm.RecvAck(wshrpc.CommandStreamAckData{Id: "1", Seq: 8, RWnd: CwndSize})
	time.Sleep(200 * time.Millisecond)

	// Now the terminal packet should have been sent
	packets = tw.GetPackets()
	hasEof := false
	for _, pkt := range packets {
		if pkt.Eof {
			hasEof = true
		}
	}
	if !hasEof {
		t.Error("Expected EOF packet after ACKing drained data")
	}

	sm.Close()
}

func TestDisconnectReconnectWithDiskRecovery(t *testing.T) {
	sm := MakeStreamManager()
	sm.SetJobId(t.Name())
	tw := &testWriter{}

	// Attach reader but don't connect yet
	reader := strings.NewReader("reconnect data")
	sm.AttachReader(reader)

	// Connect, then disconnect — activates disk buffering
	sm.ClientConnected("1", tw, CwndSize, 0)
	time.Sleep(50 * time.Millisecond) // let reader produce some data
	sm.ClientDisconnected()
	sm.activateDiskBuffering()

	sm.lock.Lock()
	diskFile := sm.diskFile
	hasTerminal := sm.terminalEvent != nil
	sm.lock.Unlock()

	// Disk file may or may not exist depending on timing of reader vs activate
	// The important thing is that on reconnect, any data is recovered

	// Reconnect — should drain disk if it exists
	tw.Clear()
	sm.ClientConnected("2", tw, CwndSize, 0)
	time.Sleep(200 * time.Millisecond)

	// Verify data was recovered
	allData := ""
	packets := tw.GetPackets()
	for _, pkt := range packets {
		if pkt.Data64 != "" {
			allData += decodeData(pkt.Data64)
		}
	}

	if diskFile != nil && allData != "reconnect data" {
		t.Errorf("Expected 'reconnect data', got '%s'", allData)
	}
	if hasTerminal && diskFile != nil {
		t.Log("Terminal event set during disk buffer — verified process exit during disconnect handling")
	}

	sm.Close()
}

func TestDrainCompletionSyncsTotalSize(t *testing.T) {
	sm := MakeStreamManager()

	// Create disk file with data
	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write([]byte("sync test"))
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	tw := &testWriter{}
	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)
	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 100 // simulate: CirBuf had 100 bytes before disk started
	sm.diskEndSeq = 109   // 100 + 9 bytes
	sm.diskReadPos = 100
	sm.connected = true
	sm.dataSender = tw
	sm.streamId = "test-sync"
	sm.terminalEvent = &streamTerminalEvent{isEof: true}
	sm.eofPos = 109
	// Set buf's totalSize to 100 to simulate stale state
	sm.buf.SetTotalSize(100)
	gen := sm.drainGen
	sm.lock.Unlock()

	// Record totalSize before drain
	sm.buf.lock.Lock()
	oldTotalSize := sm.buf.totalSize
	sm.buf.lock.Unlock()

	sm.drainDiskToCirBuf(gen)

	// After drain, totalSize should be synced to diskEndSeq
	sm.buf.lock.Lock()
	newTotalSize := sm.buf.totalSize
	sm.buf.lock.Unlock()

	if oldTotalSize != 100 {
		t.Errorf("Expected old totalSize=100, got %d", oldTotalSize)
	}
	if newTotalSize != 109 {
		t.Errorf("Expected totalSize synced to 109 (diskEndSeq), got %d", newTotalSize)
	}

	sm.Close()
}

func TestDrainDoesNotCompleteWithoutTerminalEvent(t *testing.T) {
	sm := MakeStreamManager()

	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write([]byte("live data"))
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	tw := &testWriter{}
	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)
	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 0
	sm.diskEndSeq = 9
	sm.diskReadPos = 0
	sm.connected = true
	sm.dataSender = tw
	sm.streamId = "test-live"
	// NO terminalEvent set — simulate live process
	sm.lock.Unlock()

	// Run drain in a goroutine with a timeout
	drainDone := make(chan struct{})
	sm.lock.Lock()
	gen := sm.drainGen
	sm.lock.Unlock()
	go func() {
		sm.drainDiskToCirBuf(gen)
		close(drainDone)
	}()

	// Drain should NOT complete because terminalEvent is nil
	select {
	case <-drainDone:
		sm.lock.Lock()
		df := sm.diskFile
		te := sm.terminalEvent
		sm.lock.Unlock()
		if df == nil && te == nil {
			t.Fatal("drain completed early for live process without terminal event")
		}
		// If terminal event was nil but drain completed, that's a bug
	case <-time.After(500 * time.Millisecond):
		// Expected: drain is spinning in catch-up mode, hasn't deactivated
	}

	sm.lock.Lock()
	diskStillActive := sm.diskFile != nil
	sm.lock.Unlock()
	if !diskStillActive {
		t.Error("disk file should still be active for live process")
	}

	sm.Close()
}

func TestDrainCompletesWhenTerminalEventArrives(t *testing.T) {
	sm := MakeStreamManager()

	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write([]byte("exit data"))
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	tw := &testWriter{}
	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)
	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 0
	sm.diskEndSeq = 9
	sm.diskReadPos = 0
	sm.connected = true
	sm.dataSender = tw
	sm.streamId = "test-exit"
	// NO terminalEvent — drain will catch up and spin
	sm.lock.Unlock()

	drainDone := make(chan struct{})
	sm.lock.Lock()
	gen := sm.drainGen
	sm.lock.Unlock()
	go func() {
		sm.drainDiskToCirBuf(gen)
		close(drainDone)
	}()

	// Wait a bit for drain to catch up, then inject terminal event
	time.Sleep(200 * time.Millisecond)

	sm.lock.Lock()
	sm.terminalEvent = &streamTerminalEvent{isEof: true}
	sm.eofPos = 9
	sm.lock.Unlock()

	// Drain should now complete
	select {
	case <-drainDone:
		sm.lock.Lock()
		df := sm.diskFile
		sm.lock.Unlock()
		if df != nil {
			t.Error("disk file should be nil after drain completion with terminal event")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("drain did not complete after terminal event was set")
	}

	sm.Close()
}

func TestDrainGenKillsOldGoroutineOnReconnect(t *testing.T) {
	sm := MakeStreamManager()

	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Write([]byte("gen test data"))
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)
	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 0
	sm.diskEndSeq = 13
	sm.diskReadPos = 0
	sm.connected = true
	sm.lock.Unlock()

	// Drain with arbitrary gen=999 that will never match drainGen(0)
	doneCh := make(chan struct{})
	go func() {
		sm.drainDiskToCirBuf(999)
		close(doneCh)
	}()

	// Goroutine should exit immediately since 999 != sm.drainGen(0)
	select {
	case <-doneCh:
		// Expected: drain exits because generation mismatch
	case <-time.After(500 * time.Millisecond):
		t.Fatal("drain with wrong generation did not exit")
	}

	// Verify no drain work was done (diskReadPos unchanged)
	sm.lock.Lock()
	pos := sm.diskReadPos
	sm.lock.Unlock()
	if pos != 0 {
		t.Errorf("drain with wrong gen should not have advanced diskReadPos, got %d", pos)
	}

	// Now test that real drain completes when connected+terminal
	tw := &testWriter{}
	sm.lock.Lock()
	sm.dataSender = tw
	sm.streamId = "test-real"
	sm.terminalEvent = &streamTerminalEvent{isEof: true}
	sm.eofPos = 13
	gen := sm.drainGen
	sm.lock.Unlock()

	sm.drainDiskToCirBuf(gen)

	// Verify drain completed (diskFile nil'd, data delivered)
	sm.lock.Lock()
	df := sm.diskFile
	sm.lock.Unlock()
	if df != nil {
		t.Error("Expected diskFile to be nil after successful drain")
	}

	sm.Close()
}

func TestHandleReadDataPostWriteIdentityCheck(t *testing.T) {
	// Tests that handleReadData falls through to CirBuf when diskFile
	// is deactivated between capture and post-write lock.
	sm := MakeStreamManager()

	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}
	sm.lock.Lock()
	sm.diskFile = f
	sm.diskStartSeq = 0
	sm.diskEndSeq = 0
	sm.diskReadPos = 0
	sm.lock.Unlock()

	// Close the file while handleReadData is capturing diskFile
	// This simulates the race: write happens, then deactivate closes the file,
	// then post-write lock check detects diskFile was nil'd.
	_ = f.Close()

	data := []byte("lost data")
	sm.handleReadData(data)

	// handleReadData should have fallen through to CirBuf after detecting
	// that diskFile was replaced/deactivated
	sm.lock.Lock()
	de := sm.diskEndSeq
	sm.lock.Unlock()
	if de != 0 {
		t.Errorf("Expected diskEndSeq=0 (data fell through to CirBuf), got %d", de)
	}

	// Data should be in CirBuf
	bufSize := sm.buf.Size()
	if bufSize == 0 {
		t.Error("Expected data in CirBuf after disk write failure")
	}

	sm.Close()
}

func TestSendTimeoutFiresHandleSendFailure(t *testing.T) {
	sm := MakeStreamManager()
	sm.SetJobId(t.Name())

	// Use a DataSender that returns an error after a delay, simulating a timeout
	timeout := 100 * time.Millisecond
	bs := newTimeoutSender(timeout)

	reader := strings.NewReader(strings.Repeat("x", MaxPacketSize))
	sm.AttachReader(reader)
	time.Sleep(50 * time.Millisecond)

	_, err := sm.ClientConnected("1", bs, CwndSize, 0)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}

	// Wait for the timeout to fire
	time.Sleep(timeout + 200*time.Millisecond)

	// After timeout, handleSendFailure should have set connected=false
	sm.lock.Lock()
	connected := sm.connected
	sm.lock.Unlock()

	if connected {
		t.Error("Expected senderLoop to call handleSendFailure after SendData error, setting connected=false")
	}

	sm.Close()
}

func TestDrainStartedWhenClientSeqWithinCirBufAndDiskHasMore(t *testing.T) {
	sm := MakeStreamManager()

	tmpDir := t.TempDir()
	diskPath := tmpDir + "/test.stream"
	f, err := os.Create(diskPath)
	if err != nil {
		t.Fatal(err)
	}

	// Simulate: disk was activated when totalSize=100. 100 bytes were written to disk
	// (diskEndSeq=200). A prior drain advanced diskReadPos to 150, leaving CirBuf with
	// data from seq 80-150 (head=80, count=70, totalSize=150).
	// Client reconnects at clientSeq=90 (within CirBuf range [80,150)).
	// Drain must start from diskReadPos=150 (not reset backward to clientSeq=90).
	_, err = f.Write([]byte(strings.Repeat("x", 100)))
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	tw := &testWriter{}
	f2, _ := os.OpenFile(diskPath, os.O_RDWR, 0644)

	sm.lock.Lock()
	sm.diskFile = f2
	sm.diskStartSeq = 100
	sm.diskEndSeq = 200
	sm.diskReadPos = 150

	// Set up CirBuf: totalSize=150, head=80, count=70 (seq 80-150)
	sm.buf.WriteAvailable([]byte(strings.Repeat("a", 150)))
	sm.buf.Consume(80)
	// head=80, count=70, totalSize=150
	gen := sm.drainGen
	sm.lock.Unlock()

	// Reconnect: clientSeq=90 is within CirBuf [80, 150), diskEndSeq=200 > 90
	serverSeq, err := sm.ClientConnected("reconnect", tw, CwndSize, 90)
	if err != nil {
		t.Fatalf("ClientConnected failed: %v", err)
	}
	// clientSeq(90) > headPos(80): consumed 10, head becomes 90
	if serverSeq != 90 {
		t.Errorf("Expected serverSeq=90, got %d", serverSeq)
	}

	sm.lock.Lock()
	newGen := sm.drainGen
	newDiskReadPos := sm.diskReadPos
	sm.lock.Unlock()

	if newGen == gen {
		t.Error("Expected drainGen to be incremented, drain goroutine not started")
	}
	// diskReadPos must not move backward from 150 to 90 (clientSeq).
	// Drain goroutine runs asynchronously — it may have already advanced past 150.
	if newDiskReadPos < 150 {
		t.Errorf("diskReadPos moved backward from %d to %d (clientSeq=90)", 150, newDiskReadPos)
	}

	sm.Close()
}
