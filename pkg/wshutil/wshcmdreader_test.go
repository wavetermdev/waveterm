// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"io"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func readAllFromPtyBuffer(t *testing.T, buf *PtyBuffer) []byte {
	t.Helper()
	done := make(chan []byte, 1)
	go func() {
		var result []byte
		p := make([]byte, 4096)
		for {
			n, err := buf.Read(p)
			result = append(result, p[:n]...)
			if err == io.EOF {
				done <- result
				return
			}
			if err != nil {
				t.Errorf("unexpected read error: %v", err)
				done <- result
				return
			}
		}
	}()
	select {
	case data := <-done:
		return data
	case <-time.After(2 * time.Second):
		t.Fatal("timeout reading from PtyBuffer")
		return nil
	}
}

func TestPtyBuffer_PlainData(t *testing.T) {
	input := "hello world\n"
	buf := MakePtyBuffer(strings.NewReader(input), nil)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != input {
		t.Errorf("expected %q, got %q", input, got)
	}
}

func TestPtyBuffer_OSCIntercepted(t *testing.T) {
	var captured [][]byte
	handlers := map[string]func([]byte){
		"1234": func(p []byte) { captured = append(captured, append([]byte{}, p...)) },
	}
	input := "before\x1b]1234;hello world\x07after"
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != "beforeafter" {
		t.Errorf("passthrough: expected %q, got %q", "beforeafter", got)
	}
	if len(captured) != 1 || string(captured[0]) != "hello world" {
		t.Errorf("captured: expected [\"hello world\"], got %v", captured)
	}
}

func TestPtyBuffer_UnrecognizedOSCPassthrough(t *testing.T) {
	handlers := map[string]func([]byte){
		"1234": func(p []byte) {},
	}
	seq := "\x1b]9999;some data\x07"
	buf := MakePtyBuffer(strings.NewReader(seq), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != seq {
		t.Errorf("expected passthrough of unrecognized OSC %q, got %q", seq, got)
	}
}

func TestPtyBuffer_MultipleOSCHandlers(t *testing.T) {
	var captured1, captured2 [][]byte
	handlers := map[string]func([]byte){
		"9010":  func(p []byte) { captured1 = append(captured1, append([]byte{}, p...)) },
		"23198": func(p []byte) { captured2 = append(captured2, append([]byte{}, p...)) },
	}
	input := "a\x1b]9010;msg1\x07b\x1b]23198;msg2\x07c"
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != "abc" {
		t.Errorf("passthrough: expected %q, got %q", "abc", got)
	}
	if len(captured1) != 1 || string(captured1[0]) != "msg1" {
		t.Errorf("handler 9010: expected [\"msg1\"], got %v", captured1)
	}
	if len(captured2) != 1 || string(captured2[0]) != "msg2" {
		t.Errorf("handler 23198: expected [\"msg2\"], got %v", captured2)
	}
}

func TestPtyBuffer_STTerminator(t *testing.T) {
	var captured [][]byte
	handlers := map[string]func([]byte){
		"1234": func(p []byte) { captured = append(captured, append([]byte{}, p...)) },
	}
	// 0x9c is the single-byte ST (string terminator)
	input := "x\x1b]1234;payload\x9cy"
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != "xy" {
		t.Errorf("passthrough: expected %q, got %q", "xy", got)
	}
	if len(captured) != 1 || string(captured[0]) != "payload" {
		t.Errorf("captured: expected [\"payload\"], got %v", captured)
	}
}

func TestPtyBuffer_OSCNumTooLong(t *testing.T) {
	called := false
	handlers := map[string]func([]byte){
		"123456": func(p []byte) { called = true },
	}
	// 6-digit OSC — stops accumulating after 5 digits, 6th triggers passthrough
	seq := "\x1b]123456;data\x07"
	buf := MakePtyBuffer(strings.NewReader(seq), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if called {
		t.Error("handler for 6-digit OSC should not be called")
	}
	if string(got) != seq {
		t.Errorf("expected full passthrough %q, got %q", seq, got)
	}
}

func TestPtyBuffer_ESCInPayload(t *testing.T) {
	var captured [][]byte
	handlers := map[string]func([]byte){
		"1234": func(p []byte) { captured = append(captured, append([]byte{}, p...)) },
	}
	// ESC in the middle of payload invalidates the sequence; payload is discarded
	input := "\x1b]1234;pay\x1bload\x07end"
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if len(captured) != 0 {
		t.Errorf("handler should not be called after ESC-interrupted payload, got %v", captured)
	}
	// After ESC, ModeEscStart sees 'l' (not ']') → outputs \x1b + l, then "oad\x07end" normally
	expected := "\x1bload\x07end"
	if string(got) != expected {
		t.Errorf("passthrough after ESC interrupt: expected %q, got %q", expected, got)
	}
}

func TestPtyBuffer_NilHandlers(t *testing.T) {
	seq := "\x1b]1234;data\x07"
	buf := MakePtyBuffer(strings.NewReader(seq), nil)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != seq {
		t.Errorf("expected passthrough with nil handlers %q, got %q", seq, got)
	}
}

func TestPtyBuffer_EmptyPayload(t *testing.T) {
	var captured [][]byte
	handlers := map[string]func([]byte){
		"1234": func(p []byte) { captured = append(captured, append([]byte{}, p...)) },
	}
	input := "\x1b]1234;\x07"
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	readAllFromPtyBuffer(t, buf)
	if len(captured) != 1 || len(captured[0]) != 0 {
		t.Errorf("expected one empty-payload capture, got %v", captured)
	}
}

func TestPtyBuffer_MultipleSequences(t *testing.T) {
	var captured [][]byte
	handlers := map[string]func([]byte){
		"1234": func(p []byte) { captured = append(captured, append([]byte{}, p...)) },
	}
	input := "\x1b]1234;first\x07middle\x1b]1234;second\x07"
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != "middle" {
		t.Errorf("passthrough: expected %q, got %q", "middle", got)
	}
	if len(captured) != 2 || string(captured[0]) != "first" || string(captured[1]) != "second" {
		t.Errorf("captured: expected [\"first\", \"second\"], got %v", captured)
	}
}

func TestPtyBuffer_CSIPassthrough(t *testing.T) {
	// CSI sequences (\x1b[...) should pass through unchanged
	input := "a\x1b[31mred\x1b[0mb"
	buf := MakePtyBuffer(strings.NewReader(input), nil)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != input {
		t.Errorf("CSI passthrough: expected %q, got %q", input, got)
	}
}

func TestPtyBuffer_ChunkedInput(t *testing.T) {
	var captured [][]byte
	handlers := map[string]func([]byte){
		"9010": func(p []byte) { captured = append(captured, append([]byte{}, p...)) },
	}
	pr, pw := io.Pipe()
	buf := MakePtyBuffer(pr, handlers)
	go func() {
		chunks := []string{"hel", "lo\x1b]", "90", "10;pay", "load\x07", "world"}
		for _, chunk := range chunks {
			pw.Write([]byte(chunk))
		}
		pw.Close()
	}()
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != "helloworld" {
		t.Errorf("passthrough: expected %q, got %q", "helloworld", got)
	}
	if len(captured) != 1 || string(captured[0]) != "payload" {
		t.Errorf("captured: expected [\"payload\"], got %v", captured)
	}
}

func TestPtyBuffer_WaveOSCHandler(t *testing.T) {
	messageCh := make(chan baseds.RpcInputChType, 10)
	handlers := map[string]func([]byte){
		WaveOSC: MakeWaveOSCHandler(messageCh),
	}
	input := "before\x1b]" + WaveOSC + ";wavemsg\x07after"
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != "beforeafter" {
		t.Errorf("passthrough: expected %q, got %q", "beforeafter", got)
	}
	select {
	case msg := <-messageCh:
		if string(msg.MsgBytes) != "wavemsg" {
			t.Errorf("message: expected %q, got %q", "wavemsg", string(msg.MsgBytes))
		}
	default:
		t.Error("expected message in messageCh, got none")
	}
}

func TestPtyBuffer_NoSemicolon(t *testing.T) {
	// OSC with no ';' — BEL terminates before semicolon, should passthrough
	seq := "\x1b]1234\x07"
	buf := MakePtyBuffer(strings.NewReader(seq), nil)
	got := readAllFromPtyBuffer(t, buf)
	if string(got) != seq {
		t.Errorf("expected passthrough of OSC without semicolon %q, got %q", seq, got)
	}
}

func TestPtyBuffer_ConsecutiveESC(t *testing.T) {
	// Two ESC bytes in a row — first is output, second starts new escape detection
	input := "\x1b\x1b]1234;payload\x07end"
	var captured [][]byte
	handlers := map[string]func([]byte){
		"1234": func(p []byte) { captured = append(captured, append([]byte{}, p...)) },
	}
	buf := MakePtyBuffer(strings.NewReader(input), handlers)
	got := readAllFromPtyBuffer(t, buf)
	// First ESC is output (ModeEscStart sees second ESC → outputs first, restarts)
	// Second ESC starts the OSC sequence which is captured
	if string(got) != "\x1bend" {
		t.Errorf("expected %q, got %q", "\x1bend", got)
	}
	if len(captured) != 1 || string(captured[0]) != "payload" {
		t.Errorf("captured: expected [\"payload\"], got %v", captured)
	}
}
