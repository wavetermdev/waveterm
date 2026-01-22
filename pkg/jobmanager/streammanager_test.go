// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"io"
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

func (tw *testWriter) SendData(pkt wshrpc.CommandStreamData) {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	tw.packets = append(tw.packets, pkt)
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
