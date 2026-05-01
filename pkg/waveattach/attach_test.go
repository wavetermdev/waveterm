// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"bytes"
	"testing"
)

func TestPrefixKeyMachine_PlainBytesPassThrough(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	act, err := m.feed([]byte("hello"), &out)
	if err != nil || act != actionNone {
		t.Fatalf("unexpected: action=%v err=%v", act, err)
	}
	if out.String() != "hello" {
		t.Errorf("want 'hello', got %q", out.String())
	}
}

func TestPrefixKeyMachine_DetachOnCtrlAD(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	act, _ := m.feed([]byte{0x01, 'd'}, &out)
	if act != actionDetach {
		t.Fatalf("expected detach, got %v", act)
	}
	if out.Len() != 0 {
		t.Errorf("expected nothing forwarded, got %q", out.String())
	}
}

func TestPrefixKeyMachine_DetachOnCtrlACapitalD(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	act, _ := m.feed([]byte{0x01, 'D'}, &out)
	if act != actionDetach {
		t.Fatalf("expected detach, got %v", act)
	}
}

func TestPrefixKeyMachine_RedrawOnCtrlAR(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	act, _ := m.feed([]byte{0x01, 'r'}, &out)
	if act != actionRedraw {
		t.Fatalf("expected redraw, got %v", act)
	}
	if out.Len() != 0 {
		t.Errorf("expected nothing forwarded, got %q", out.String())
	}
}

func TestPrefixKeyMachine_ResyncOnCtrlAS(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	act, _ := m.feed([]byte{0x01, 'S'}, &out)
	if act != actionResync {
		t.Fatalf("expected resync, got %v", act)
	}
	if out.Len() != 0 {
		t.Errorf("expected nothing forwarded, got %q", out.String())
	}
}

func TestPrefixKeyMachine_LiteralCtrlAByDoubling(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	act, _ := m.feed([]byte{0x01, 0x01}, &out)
	if act != actionNone {
		t.Fatalf("did not expect action, got %v", act)
	}
	if !bytes.Equal(out.Bytes(), []byte{0x01}) {
		t.Errorf("want 0x01, got %v", out.Bytes())
	}
}

func TestPrefixKeyMachine_PrefixThenOtherKey(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	act, _ := m.feed([]byte{0x01, 'x'}, &out)
	if act != actionNone {
		t.Fatalf("did not expect action, got %v", act)
	}
	if !bytes.Equal(out.Bytes(), []byte{0x01, 'x'}) {
		t.Errorf("want [0x01 'x'], got %v", out.Bytes())
	}
}

func TestPrefixKeyMachine_PrefixSplitAcrossReads(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	if act, _ := m.feed([]byte{0x01}, &out); act != actionNone {
		t.Fatalf("did not expect action yet, got %v", act)
	}
	if out.Len() != 0 {
		t.Errorf("expected buffered, got %q", out.String())
	}
	act, _ := m.feed([]byte{'d'}, &out)
	if act != actionDetach {
		t.Fatalf("expected detach on second feed, got %v", act)
	}
}
