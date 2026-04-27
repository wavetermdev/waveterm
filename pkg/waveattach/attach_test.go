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
	det, err := m.feed([]byte("hello"), &out)
	if err != nil || det {
		t.Fatalf("unexpected: detach=%v err=%v", det, err)
	}
	if out.String() != "hello" {
		t.Errorf("want 'hello', got %q", out.String())
	}
}

func TestPrefixKeyMachine_DetachOnCtrlAD(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 'd'}, &out)
	if !det {
		t.Fatal("expected detach")
	}
	if out.Len() != 0 {
		t.Errorf("expected nothing forwarded, got %q", out.String())
	}
}

func TestPrefixKeyMachine_DetachOnCtrlACapitalD(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 'D'}, &out)
	if !det {
		t.Fatal("expected detach")
	}
}

func TestPrefixKeyMachine_LiteralCtrlAByDoubling(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 0x01}, &out)
	if det {
		t.Fatal("did not expect detach")
	}
	if !bytes.Equal(out.Bytes(), []byte{0x01}) {
		t.Errorf("want 0x01, got %v", out.Bytes())
	}
}

func TestPrefixKeyMachine_PrefixThenOtherKey(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 'x'}, &out)
	if det {
		t.Fatal("did not expect detach")
	}
	if !bytes.Equal(out.Bytes(), []byte{0x01, 'x'}) {
		t.Errorf("want [0x01 'x'], got %v", out.Bytes())
	}
}

func TestPrefixKeyMachine_PrefixSplitAcrossReads(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	if det, _ := m.feed([]byte{0x01}, &out); det {
		t.Fatal("did not expect detach yet")
	}
	if out.Len() != 0 {
		t.Errorf("expected buffered, got %q", out.String())
	}
	det, _ := m.feed([]byte{'d'}, &out)
	if !det {
		t.Fatal("expected detach on second feed")
	}
}
