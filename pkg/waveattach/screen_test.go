// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"strings"
	"testing"

	xterm "github.com/gitpod-io/xterm-go"
)

// --- ctrlArrowDir ---

func TestCtrlArrowDir_AllDirections(t *testing.T) {
	cases := []struct {
		name string
		seq  []byte
		want byte
	}{
		{"up", []byte{0x1B, '[', '1', ';', '5', 'A'}, 'U'},
		{"down", []byte{0x1B, '[', '1', ';', '5', 'B'}, 'D'},
		{"right", []byte{0x1B, '[', '1', ';', '5', 'C'}, 'R'},
		{"left", []byte{0x1B, '[', '1', ';', '5', 'D'}, 'L'},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir, consumed := ctrlArrowDir(tc.seq, 0)
			if dir != tc.want || consumed != 6 {
				t.Errorf("got dir=%c consumed=%d, want dir=%c consumed=6", dir, consumed, tc.want)
			}
		})
	}
}

func TestCtrlArrowDir_TooShort(t *testing.T) {
	for n := 0; n <= 5; n++ {
		seq := []byte{0x1B, '[', '1', ';', '5', 'A'}[:n]
		dir, consumed := ctrlArrowDir(seq, 0)
		if dir != 0 || consumed != 0 {
			t.Errorf("len=%d: expected no match, got dir=%c consumed=%d", n, dir, consumed)
		}
	}
}

func TestCtrlArrowDir_NoMatch(t *testing.T) {
	cases := []struct {
		name string
		seq  []byte
	}{
		{"wrong param", []byte{0x1B, '[', '2', ';', '5', 'A'}},
		{"not esc", []byte{'x', '[', '1', ';', '5', 'A'}},
		{"unknown final", []byte{0x1B, '[', '1', ';', '5', 'Z'}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir, consumed := ctrlArrowDir(tc.seq, 0)
			if dir != 0 || consumed != 0 {
				t.Errorf("expected no match, got dir=%c consumed=%d", dir, consumed)
			}
		})
	}
}

func TestCtrlArrowDir_NonZeroOffset(t *testing.T) {
	// Prefix bytes before the sequence.
	data := append([]byte("hello"), 0x1B, '[', '1', ';', '5', 'A')
	dir, consumed := ctrlArrowDir(data, 5)
	if dir != 'U' || consumed != 6 {
		t.Errorf("got dir=%c consumed=%d, want dir=U consumed=6", dir, consumed)
	}
}

// --- Viewport offset initialisation ---

func TestNewViewport_InitialOffset_BottomLeft(t *testing.T) {
	vp := newViewport(50, 220, 80, 24)
	// Bottom-left: offsetX=0, offsetY=50-24=26
	if vp.offsetX != 0 {
		t.Errorf("offsetX=%d, want 0", vp.offsetX)
	}
	if vp.offsetY != 26 {
		t.Errorf("offsetY=%d, want 26", vp.offsetY)
	}
}

func TestNewViewport_LocalLargerThanRemote(t *testing.T) {
	// Local is bigger than remote in both dims — offset must clamp to 0.
	vp := newViewport(10, 40, 80, 24)
	if vp.offsetX != 0 {
		t.Errorf("offsetX=%d, want 0", vp.offsetX)
	}
	if vp.offsetY != 0 {
		t.Errorf("offsetY=%d, want 0", vp.offsetY)
	}
}

// --- clampOffsets ---

func TestViewport_ClampOffsets_Boundaries(t *testing.T) {
	vp := newViewport(50, 220, 80, 24)

	// Force out-of-bounds then clamp.
	vp.mu.Lock()
	vp.offsetX = -10
	vp.offsetY = -5
	vp.clampOffsets()
	vp.mu.Unlock()
	if vp.offsetX != 0 || vp.offsetY != 0 {
		t.Errorf("expected 0,0 after negative clamp, got %d,%d", vp.offsetX, vp.offsetY)
	}

	vp.mu.Lock()
	vp.offsetX = 9999
	vp.offsetY = 9999
	vp.clampOffsets()
	vp.mu.Unlock()
	wantX := 220 - 80 // 140
	wantY := 50 - 24  // 26
	if vp.offsetX != wantX || vp.offsetY != wantY {
		t.Errorf("expected %d,%d after large clamp, got %d,%d", wantX, wantY, vp.offsetX, vp.offsetY)
	}
}

func TestViewport_Resize_ClampsSafely(t *testing.T) {
	vp := newViewport(50, 220, 80, 24)
	// Move to a mid position.
	vp.mu.Lock()
	vp.offsetY = 20
	vp.mu.Unlock()

	// Grow local terminal — max offsetY shrinks, clamp kicks in.
	vp.Resize(80, 45)
	if vp.offsetY > 50-45 {
		t.Errorf("offsetY=%d exceeds max after resize", vp.offsetY)
	}
}

// --- cellAttrToSGR ---

func TestCellAttrToSGR_Default(t *testing.T) {
	cell := xterm.NewCellData()
	got := cellAttrToSGR(cell)
	if got != "\x1b[m" {
		t.Errorf("want reset, got %q", got)
	}
}

func TestCellAttrToSGR_Bold(t *testing.T) {
	cell := xterm.NewCellData()
	cell.Fg = xterm.FgFlagBold
	got := cellAttrToSGR(cell)
	if !strings.Contains(got, ";1") {
		t.Errorf("bold missing from %q", got)
	}
}

func TestCellAttrToSGR_P16Fg_StandardColor(t *testing.T) {
	cell := xterm.NewCellData()
	cell.Fg = xterm.AttrCMP16 | 1 // standard fg red → 31
	got := cellAttrToSGR(cell)
	if !strings.Contains(got, ";31") {
		t.Errorf("want ;31 in %q", got)
	}
}

func TestCellAttrToSGR_P16Fg_BrightColor(t *testing.T) {
	cell := xterm.NewCellData()
	cell.Fg = xterm.AttrCMP16 | 9 // bright red → 91
	got := cellAttrToSGR(cell)
	if !strings.Contains(got, ";91") {
		t.Errorf("want ;91 in %q", got)
	}
}

func TestCellAttrToSGR_P256Fg(t *testing.T) {
	cell := xterm.NewCellData()
	cell.Fg = xterm.AttrCMP256 | 200
	got := cellAttrToSGR(cell)
	if !strings.Contains(got, ";38;5;200") {
		t.Errorf("want ;38;5;200 in %q", got)
	}
}

func TestCellAttrToSGR_RGBFg(t *testing.T) {
	cell := xterm.NewCellData()
	// Pack RGB (255, 0, 128): red<<16 | green<<8 | blue
	cell.Fg = xterm.AttrCMRGB | (255 << 16) | (0 << 8) | 128
	got := cellAttrToSGR(cell)
	if !strings.Contains(got, ";38;2;255;0;128") {
		t.Errorf("want ;38;2;255;0;128 in %q", got)
	}
}

func TestCellAttrToSGR_P16Bg_StandardColor(t *testing.T) {
	cell := xterm.NewCellData()
	cell.Bg = xterm.AttrCMP16 | 2 // standard bg green → 42
	got := cellAttrToSGR(cell)
	if !strings.Contains(got, ";42") {
		t.Errorf("want ;42 in %q", got)
	}
}

func TestCellAttrToSGR_P16Bg_BrightColor(t *testing.T) {
	cell := xterm.NewCellData()
	cell.Bg = xterm.AttrCMP16 | 10 // bright green bg → 102
	got := cellAttrToSGR(cell)
	if !strings.Contains(got, ";102") {
		t.Errorf("want ;102 in %q", got)
	}
}

func TestCellAttrToSGR_MultipleAttrs(t *testing.T) {
	cell := xterm.NewCellData()
	cell.Fg = xterm.FgFlagBold | xterm.AttrCMP16 | 3 // bold + fg yellow (33)
	cell.Bg = xterm.BgFlagItalic                      // italic flag lives in Bg
	got := cellAttrToSGR(cell)
	for _, want := range []string{";1", ";3", ";33"} {
		if !strings.Contains(got, want) {
			t.Errorf("want %q in %q", want, got)
		}
	}
}
