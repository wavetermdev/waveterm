// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"bytes"
	"testing"
	"time"
)

func TestEventBuffer_ReplayAfterCutoff(t *testing.T) {
	buf := makeEventBuffer()
	t0 := time.Now()
	_ = buf.write(t0, []byte("A"), nil)
	_ = buf.write(t0.Add(10*time.Millisecond), []byte("B"), nil)
	cutoff := t0.Add(20 * time.Millisecond)
	_ = buf.write(cutoff.Add(time.Millisecond), []byte("C"), nil)

	var out bytes.Buffer
	buf.flush(cutoff, &out)
	if got := out.String(); got != "C" {
		t.Errorf("want %q, got %q", "C", got)
	}
}

func TestEventBuffer_StreamModeAfterFlush(t *testing.T) {
	buf := makeEventBuffer()
	cutoff := time.Now()
	buf.flush(cutoff, &bytes.Buffer{})

	var out bytes.Buffer
	buf.write(cutoff.Add(time.Second), []byte("hello"), &out)
	if got := out.String(); got != "hello" {
		t.Errorf("want %q, got %q", "hello", got)
	}
}
