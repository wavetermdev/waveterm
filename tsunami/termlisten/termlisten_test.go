// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package termlisten

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

// readOSCFrame reads one OSC 9010 frame from r and returns the JSON payload.
func readOSCFrame(r io.Reader) (string, error) {
	frame, err := bufio.NewReader(r).ReadBytes('\x07')
	if err != nil {
		return "", err
	}
	s := string(frame)
	idx := strings.Index(s, ";")
	if idx < 0 {
		return "", fmt.Errorf("invalid OSC frame: %q", s)
	}
	return s[idx+1 : len(s)-1], nil
}

func injectMsg(w io.Writer, msg inMsg) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "##listen%s\n", data)
	return err
}

func TestMakeListenerSuccess(t *testing.T) {
	resetForTesting()
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	SetOutput(outW)
	t.Cleanup(func() { inW.Close(); outW.Close() })

	errCh := make(chan error, 1)
	var got *Listener
	go func() {
		l, _, err := MakeListener(inR)
		got = l
		errCh <- err
	}()

	payload, err := readOSCFrame(outR)
	if err != nil {
		t.Fatal(err)
	}
	var frame oscMsg
	if err := json.Unmarshal([]byte(payload), &frame); err != nil {
		t.Fatalf("unmarshal OSC frame: %v", err)
	}
	if frame.Call != "listen-enter" {
		t.Fatalf("expected listen-enter, got %q", frame.Call)
	}

	if err := injectMsg(inW, inMsg{Id: frame.Id, Port: 22145}); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("MakeListener: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for MakeListener")
	}

	if got.Port() != 22145 {
		t.Fatalf("expected port 22145, got %d", got.Port())
	}
}

func TestMakeListenerWaveError(t *testing.T) {
	resetForTesting()
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	SetOutput(outW)
	t.Cleanup(func() { inW.Close(); outW.Close() })

	errCh := make(chan error, 1)
	go func() {
		_, _, err := MakeListener(inR)
		errCh <- err
	}()

	payload, err := readOSCFrame(outR)
	if err != nil {
		t.Fatal(err)
	}
	var frame oscMsg
	json.Unmarshal([]byte(payload), &frame)

	if err := injectMsg(inW, inMsg{Id: frame.Id, Error: "feature disabled"}); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "feature disabled") {
			t.Fatalf("unexpected error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout")
	}
}
