// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows && !(linux && (mips || mips64))

package waveattach

import (
	"bytes"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"

	xterm "github.com/gitpod-io/xterm-go"
)

// renderedCell tracks what was last drawn at a (row, col) on the local terminal.
// width: 1 normal, 2 wide-start, 0 wide-continuation.
type renderedCell struct {
	ch             string
	fg             uint32
	bg             uint32
	width          int
	underlineStyle xterm.UnderlineStyle
	underlineColor uint32
}

// Viewport is a moveable window into the xterm-go terminal buffer.
// It owns the terminal emulator and acts as an io.Writer for PTY output.
type Viewport struct {
	mu              sync.Mutex
	term            *xterm.Terminal
	offsetX         int // leftmost visible column within the remote visible screen
	offsetY         int // topmost visible row within the remote visible screen
	width           int // local terminal width
	height          int // local terminal height
	cols            int // remote terminal cols
	rows            int // remote terminal rows
	lastCells       [][]renderedCell
	needsFullRedraw bool
	inAltScreen     bool // whether local terminal has been switched to alt screen
	lastCursorCode  int  // last DECSCUSR code emitted; -1 = not yet emitted
	lastYBase       int  // last observed yBase; when it changes the diff is invalid
}

func newViewport(remoteRows, remoteCols, localWidth, localHeight int) *Viewport {
	term := xterm.New(
		xterm.WithCols(remoteCols),
		xterm.WithRows(remoteRows),
	)
	vp := &Viewport{
		term:            term,
		width:           localWidth,
		height:          localHeight,
		cols:            remoteCols,
		rows:            remoteRows,
		needsFullRedraw: true,
		lastCursorCode:  -1,
		lastYBase:       -1,
	}
	// start at bottom-left of remote screen
	vp.offsetY = remoteRows - localHeight
	if vp.offsetY < 0 {
		vp.offsetY = 0
	}
	return vp
}

// Write implements io.Writer — feeds raw PTY output into the terminal emulator.
// If the data contains ESC[2J (erase display), a full redraw is scheduled so
// the next Render clears the local terminal before repainting, preventing
// stale cells from showing through when the remote TUI redraws its frame.
func (vp *Viewport) Write(data []byte) (int, error) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	for i := 0; i+3 < len(data); i++ {
		if data[i] == 0x1b && data[i+1] == '[' && data[i+2] == '2' && data[i+3] == 'J' {
			vp.needsFullRedraw = true
			break
		}
	}
	return vp.term.Write(data)
}

func (vp *Viewport) MoveUp(n int) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.offsetY -= n
	vp.clampOffsets()
}

func (vp *Viewport) MoveDown(n int) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.offsetY += n
	vp.clampOffsets()
}

func (vp *Viewport) MoveLeft(n int) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.offsetX -= n
	vp.clampOffsets()
}

func (vp *Viewport) MoveRight(n int) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.offsetX += n
	vp.clampOffsets()
}

// Resize updates the local viewport window when the client terminal is resized.
// The server terminal size (cols/rows) and the xterm-go emulator are not touched.
func (vp *Viewport) Resize(newWidth, newHeight int) {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.width = newWidth
	vp.height = newHeight
	vp.clampOffsets()
	vp.needsFullRedraw = true
}

// ForceFullRedraw causes the next Render to clear and re-emit every cell,
// regardless of lastCells diff.
func (vp *Viewport) ForceFullRedraw() {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.needsFullRedraw = true
}

// Reset re-creates the xterm-go emulator from scratch. Used when xterm-go
// state has diverged from the real remote and a fresh snapshot replay is
// needed to recover.
func (vp *Viewport) Reset() {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	vp.term = xterm.New(
		xterm.WithCols(vp.cols),
		xterm.WithRows(vp.rows),
	)
	vp.inAltScreen = false
	vp.lastCursorCode = -1
	vp.lastYBase = -1
	vp.lastCells = nil
	vp.needsFullRedraw = true
}

// InAltScreen returns whether the local terminal is currently in alternate screen mode.
func (vp *Viewport) InAltScreen() bool {
	vp.mu.Lock()
	defer vp.mu.Unlock()
	return vp.inAltScreen
}

func (vp *Viewport) clampOffsets() {
	maxX := vp.cols - vp.width
	if maxX < 0 {
		maxX = 0
	}
	maxY := vp.rows - vp.height
	if maxY < 0 {
		maxY = 0
	}
	// allow scrolling into scrollback; minY is negative when scrollback exists
	minY := -vp.term.Buffer().YBase
	if vp.offsetX < 0 {
		vp.offsetX = 0
	} else if vp.offsetX > maxX {
		vp.offsetX = maxX
	}
	if vp.offsetY < minY {
		vp.offsetY = minY
	} else if vp.offsetY > maxY {
		vp.offsetY = maxY
	}
}

// Render writes the current viewport content to w. It diffs against the last
// rendered state so only changed cells are emitted with explicit cursor moves.
// On first render or after Resize, a full clear+redraw is performed.
func (vp *Viewport) Render(w io.Writer) {
	vp.mu.Lock()
	defer vp.mu.Unlock()

	ox, oy := vp.offsetX, vp.offsetY
	width, height := vp.width, vp.height
	if width <= 0 || height <= 0 {
		return
	}

	buf := vp.term.Buffer()
	yBase := buf.YBase
	cursorX := vp.term.CursorX()
	cursorY := vp.term.CursorY()

	fullRedraw := vp.needsFullRedraw
	if yBase != vp.lastYBase {
		// When scrolled into scrollback, compensate so the same absolute
		// lines stay visible as the remote terminal advances.
		if vp.offsetY < 0 {
			vp.offsetY -= yBase - vp.lastYBase
			vp.clampOffsets()
		}
		vp.lastYBase = yBase
		vp.lastCells = nil
		fullRedraw = true
	}
	if len(vp.lastCells) != height {
		vp.lastCells = make([][]renderedCell, height)
		fullRedraw = true
	}
	for i := range vp.lastCells {
		if len(vp.lastCells[i]) != width {
			vp.lastCells[i] = make([]renderedCell, width)
			fullRedraw = true
		}
	}
	vp.needsFullRedraw = false

	var out bytes.Buffer
	out.WriteString("\x1b[?25l") // hide cursor during update

	// Sync alt screen state with remote.
	remoteAlt := vp.term.IsAltBufferActive()
	if remoteAlt != vp.inAltScreen {
		if remoteAlt {
			out.WriteString("\x1b[?1049h")
		} else {
			out.WriteString("\x1b[?1049l")
		}
		vp.inAltScreen = remoteAlt
		vp.lastCells = nil
		fullRedraw = true
	}

	if fullRedraw {
		out.WriteString("\x1b[m\x1b[2J\x1b[H")
	}

	cell := xterm.NewCellData()
	// Sentinel values force SGR emission for the first changed cell.
	prevFg := ^uint32(0)
	prevBg := ^uint32(0)
	prevUlStyle := ^xterm.UnderlineStyle(0)
	prevUlColor := ^uint32(0)
	curRow, curCol := -1, -1

	emitMove := func(row, col int) {
		if curRow == row && curCol == col {
			return
		}
		out.WriteString(fmt.Sprintf("\x1b[%d;%dH", row+1, col+1))
		curRow, curCol = row, col
	}

	for row := 0; row < height; row++ {
		bufRow := yBase + oy + row
		var line *xterm.BufferLine
		if bufRow >= 0 && bufRow < buf.Lines.Length() {
			line = buf.Lines.Get(bufRow)
		}

		for col := 0; col < width; {
			cell.Fg = 0
			cell.Bg = 0
			cell.Extended = nil
			cell.Content = 0
			cell.CombinedData = ""

			bufCol := ox + col
			cellW := 1
			if line != nil && bufCol < vp.cols {
				line.LoadCell(bufCol, cell)
				cw := line.GetWidth(bufCol)
				if cw >= 1 {
					cellW = cw
				} else if cw == 0 {
					// Right half of a wide char (or unset). Render a space
					// at this column so the layout stays consistent.
					cellW = 1
					cell.Fg = 0
					cell.Bg = 0
					cell.Content = 0
					cell.CombinedData = ""
				}
			}

			ch := cell.GetChars()
			if ch == "" {
				ch = " "
			}
			// Suppress zsh PROMPT_SP % — bold+inverse % written mid-line because
			// Wave shell integration leaves the cursor at the prompt input column,
			// not col=0. The self-clearing wrap mechanism never fires, so the %
			// persists in the buffer and our diff render would show it indefinitely.
			if ch == "%" && cell.AttributeData.IsBold() != 0 && cell.AttributeData.IsInverse() != 0 {
				ch = " "
				cell.Fg = 0
				cell.Bg = 0
			}
			// If a wide char would overflow the right edge, render a space.
			if cellW == 2 && col+1 >= width {
				ch = " "
				cellW = 1
				cell.Fg = 0
				cell.Bg = 0
			}

			a := &cell.AttributeData
			ulStyle := a.GetUnderlineStyle()
			var ulColor uint32
			if a.HasExtendedAttrs() != 0 && a.Extended != nil {
				ulColor = a.Extended.UnderlineColor()
			}
			newRC := renderedCell{ch: ch, fg: cell.Fg, bg: cell.Bg, width: cellW, underlineStyle: ulStyle, underlineColor: ulColor}
			if fullRedraw || vp.lastCells[row][col] != newRC {
				emitMove(row, col)
				if cell.Fg != prevFg || cell.Bg != prevBg || ulStyle != prevUlStyle || ulColor != prevUlColor {
					out.WriteString(cellAttrToSGR(cell))
					prevFg = cell.Fg
					prevBg = cell.Bg
					prevUlStyle = ulStyle
					prevUlColor = ulColor
				}
				out.WriteString(ch)
				curCol += cellW
				vp.lastCells[row][col] = newRC
				if cellW == 2 && col+1 < width {
					vp.lastCells[row][col+1] = renderedCell{width: 0}
				}
			}
			col += cellW
		}
	}

	// Reset SGR so cursor reflects default colors.
	if prevFg != 0 || prevBg != 0 || prevUlStyle != 0 || prevUlColor != 0 {
		out.WriteString("\x1b[m")
	}

	// Sync cursor style (DECSCUSR) with remote state.
	dpm := vp.term.DecPrivateModes()
	code := cursorStyleCode(dpm)
	if code != vp.lastCursorCode {
		out.WriteString(fmt.Sprintf("\x1b[%d q", code))
		vp.lastCursorCode = code
	}

	// Position and show cursor if not hidden and within viewport.
	if !vp.term.IsCursorHidden() {
		localCurRow := cursorY - oy
		localCurCol := cursorX - ox
		if localCurRow >= 0 && localCurRow < height && localCurCol >= 0 && localCurCol < width {
			out.WriteString(fmt.Sprintf("\x1b[%d;%dH", localCurRow+1, localCurCol+1))
			out.WriteString("\x1b[?25h")
		}
	}

	_, _ = w.Write(out.Bytes())
}

// cellAttrToSGR converts a cell's AttributeData to an ANSI SGR escape sequence.
func cellAttrToSGR(cell *xterm.CellData) string {
	a := &cell.AttributeData
	if a.IsAttributeDefault() {
		return "\x1b[m"
	}

	var sb strings.Builder
	sb.WriteString("\x1b[0")

	if a.IsBold() != 0 {
		sb.WriteString(";1")
	}
	if a.IsDim() != 0 {
		sb.WriteString(";2")
	}
	if a.IsItalic() != 0 {
		sb.WriteString(";3")
	}
	if ulStyle := a.GetUnderlineStyle(); ulStyle != xterm.UnderlineStyleNone {
		switch ulStyle {
		case xterm.UnderlineStyleDouble:
			sb.WriteString(";4:2")
		case xterm.UnderlineStyleCurly:
			sb.WriteString(";4:3")
		case xterm.UnderlineStyleDotted:
			sb.WriteString(";4:4")
		case xterm.UnderlineStyleDashed:
			sb.WriteString(";4:5")
		default: // UnderlineStyleSingle
			sb.WriteString(";4")
		}
	}
	if a.IsBlink() != 0 {
		sb.WriteString(";5")
	}
	if a.IsInverse() != 0 {
		sb.WriteString(";7")
	}
	if a.IsInvisible() != 0 {
		sb.WriteString(";8")
	}
	if a.IsStrikethrough() != 0 {
		sb.WriteString(";9")
	}
	if a.IsOverline() != 0 {
		sb.WriteString(";53")
	}

	// Foreground color
	switch a.Fg & xterm.AttrCMMask {
	case xterm.AttrCMP16:
		n := a.GetFgColor()
		if n < 8 {
			sb.WriteString(";" + strconv.Itoa(30+n))
		} else {
			sb.WriteString(";" + strconv.Itoa(90+n-8))
		}
	case xterm.AttrCMP256:
		sb.WriteString(";38;5;" + strconv.Itoa(a.GetFgColor()))
	case xterm.AttrCMRGB:
		c := xterm.ToColorRGB(uint32(a.GetFgColor()))
		sb.WriteString(fmt.Sprintf(";38;2;%d;%d;%d", c[0], c[1], c[2]))
	}

	// Background color
	switch a.Bg & xterm.AttrCMMask {
	case xterm.AttrCMP16:
		n := a.GetBgColor()
		if n < 8 {
			sb.WriteString(";" + strconv.Itoa(40+n))
		} else {
			sb.WriteString(";" + strconv.Itoa(100+n-8))
		}
	case xterm.AttrCMP256:
		sb.WriteString(";48;5;" + strconv.Itoa(a.GetBgColor()))
	case xterm.AttrCMRGB:
		c := xterm.ToColorRGB(uint32(a.GetBgColor()))
		sb.WriteString(fmt.Sprintf(";48;2;%d;%d;%d", c[0], c[1], c[2]))
	}

	// Underline color
	if a.HasExtendedAttrs() != 0 && a.Extended != nil {
		uc := a.Extended.UnderlineColor()
		switch uc & xterm.AttrCMMask {
		case xterm.AttrCMP16, xterm.AttrCMP256:
			sb.WriteString(";58;5;" + strconv.Itoa(int(uc&xterm.AttrPColorMask)))
		case xterm.AttrCMRGB:
			c := xterm.ToColorRGB(uc & xterm.AttrRGBMask)
			sb.WriteString(fmt.Sprintf(";58;2;%d;%d;%d", c[0], c[1], c[2]))
		}
	}

	sb.WriteString("m")
	return sb.String()
}

// cursorStyleCode returns the DECSCUSR Ps parameter that matches the terminal's
// current cursor style and blink settings. The caller emits "\x1b[Ps q".
// Returns 0 (reset to terminal default) when no explicit style has been set.
func cursorStyleCode(dpm xterm.DecPrivateModes) int {
	if dpm.CursorStyle == nil && dpm.CursorBlinkOverride == nil {
		return 0
	}
	style := xterm.CursorStyleBlock
	if dpm.CursorStyle != nil {
		style = *dpm.CursorStyle
	}
	blink := true
	if dpm.CursorBlinkOverride != nil {
		blink = *dpm.CursorBlinkOverride
	} else if dpm.CursorBlink != nil {
		blink = *dpm.CursorBlink
	}
	switch style {
	case xterm.CursorStyleBlock:
		if blink {
			return 1
		}
		return 2
	case xterm.CursorStyleUnderline:
		if blink {
			return 3
		}
		return 4
	case xterm.CursorStyleBar:
		if blink {
			return 5
		}
		return 6
	}
	return 0
}
