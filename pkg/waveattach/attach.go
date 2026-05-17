// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows && !(linux && (mips || mips64))

package waveattach

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"golang.org/x/term"
)

const (
	ctrlA = 0x01

	// Default remote screen size used when the block has no recorded TermSize.
	defaultRemoteRows = 24
	defaultRemoteCols = 80
)

type prefixAction int

const (
	actionNone prefixAction = iota
	actionDetach
	actionRedraw
	actionResync
	actionScrollUp
	actionScrollDown
)

type prefixKey struct {
	gotPrefix bool
}

func newPrefixKey() *prefixKey { return &prefixKey{} }

// feed processes a chunk of input bytes, writing pass-through bytes to w and
// returning the first prefix-triggered action it encounters. Bytes after the
// action in the same chunk are dropped — in practice keystrokes arrive one
// chunk at a time so this is fine.
func (p *prefixKey) feed(b []byte, w io.Writer) (action prefixAction, err error) {
	for _, c := range b {
		if !p.gotPrefix {
			if c == ctrlA {
				p.gotPrefix = true
				continue
			}
			if _, err := w.Write([]byte{c}); err != nil {
				return actionNone, err
			}
			continue
		}
		switch c {
		case 'd', 'D':
			return actionDetach, nil
		case 'r', 'R':
			p.gotPrefix = false
			return actionRedraw, nil
		case 's', 'S':
			p.gotPrefix = false
			return actionResync, nil
		case 'k', 'K':
			p.gotPrefix = false
			return actionScrollUp, nil
		case 'j', 'J':
			p.gotPrefix = false
			return actionScrollDown, nil
		case ctrlA:
			if _, err := w.Write([]byte{ctrlA}); err != nil {
				return actionNone, err
			}
		default:
			p.gotPrefix = false
			if _, err := w.Write([]byte{ctrlA, c}); err != nil {
				return actionNone, err
			}
		}
	}
	return actionNone, nil
}

var ErrDetached = errors.New("detached")
var ErrBlockClosed = errors.New("block closed")

// ctrlArrowDir matches a Ctrl+Arrow escape sequence starting at data[i].
// Handles the standard xterm form ESC [ 1 ; 5 A/B/C/D (6 bytes).
// Returns the direction ('U','D','L','R') and bytes consumed, or 0 if no match.
//
// Limitation: all 6 bytes must be present in the same Read call. In practice,
// raw-mode keyboard escape sequences are always delivered atomically, but
// this is not a POSIX guarantee. If a sequence is split across reads it will
// be forwarded to the remote terminal unchanged rather than handled locally.
func ctrlArrowDir(data []byte, i int) (dir byte, consumed int) {
	if i+5 >= len(data) {
		return 0, 0
	}
	if data[i] != 0x1B || data[i+1] != '[' || data[i+2] != '1' || data[i+3] != ';' || data[i+4] != '5' {
		return 0, 0
	}
	switch data[i+5] {
	case 'A':
		return 'U', 6
	case 'B':
		return 'D', 6
	case 'C':
		return 'R', 6
	case 'D':
		return 'L', 6
	}
	return 0, 0
}

func Attach(rpcClient *wshutil.WshRpc, blockId string) error {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return fmt.Errorf("stdin is not a terminal")
	}
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return fmt.Errorf("entering raw mode: %w", err)
	}
	defer term.Restore(fd, oldState)

	// Server terminal size is fixed; client only provides a viewport window.
	remoteRows, remoteCols := defaultRemoteRows, defaultRemoteCols
	if ts := getBlockTermSize(rpcClient, blockId); ts != nil && ts.Rows > 0 && ts.Cols > 0 {
		remoteRows, remoteCols = ts.Rows, ts.Cols
	}

	localCols, localRows, sizeErr := term.GetSize(fd)
	if sizeErr != nil || localRows <= 0 || localCols <= 0 {
		localRows, localCols = defaultRemoteRows, defaultRemoteCols
	}

	vp := newViewport(remoteRows, remoteCols, localCols, localRows)
	vr := newViewportRenderer(vp, os.Stdout)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle local terminal resize: update local viewport and remote PTY together.
	winchCh := make(chan os.Signal, 1)
	signal.Notify(winchCh, syscall.SIGWINCH)
	defer signal.Stop(winchCh)
	go func() {
		for {
			select {
			case <-winchCh:
				newCols, newRows, err := term.GetSize(fd)
				if err == nil && newRows > 0 && newCols > 0 {
					vp.Resize(newCols, newRows)
					vr.Render()
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	exitCh := make(chan error, 3)

	blockRef := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	rpcClient.EventListener.On(wps.Event_ControllerStatus, func(ev *wps.WaveEvent) {
		if !ev.HasScope(blockRef) {
			return
		}
		var status blockcontroller.BlockControllerRuntimeStatus
		if err := utilfn.ReUnmarshal(&status, ev.Data); err != nil {
			return
		}
		if status.ShellProcStatus == blockcontroller.Status_Done {
			exitCh <- ErrBlockClosed
		}
	})
	subReq := wps.SubscriptionRequest{
		Event:  wps.Event_ControllerStatus,
		Scopes: []string{blockRef},
	}
	if err := wshclient.EventSubCommand(rpcClient, subReq, nil); err != nil {
		return fmt.Errorf("subscribing to controllerstatus events: %w", err)
	}

	resyncCh := make(chan struct{}, 1)
	go func() {
		exitCh <- StreamOutput(ctx, rpcClient, blockId, vr, resyncCh)
	}()

	go func() {
		exitCh <- inputLoop(ctx, rpcClient, blockId, vp, vr, resyncCh)
	}()

	exitErr := <-exitCh
	cancel()
	// restore terminal: exit alt screen if needed, reset SGR, cursor style, show cursor, clear screen
	if vp.InAltScreen() {
		os.Stdout.WriteString("\x1b[?1049l")
	}
	os.Stdout.WriteString("\x1b[m\x1b[?25h\x1b[ 0 q\x1b[2J\x1b[H\r\n")
	switch {
	case errors.Is(exitErr, ErrDetached):
		fmt.Fprintf(os.Stderr, "[detached]\r\n")
		return nil
	case errors.Is(exitErr, ErrBlockClosed):
		fmt.Fprintf(os.Stderr, "[block closed]\r\n")
		return nil
	case exitErr != nil:
		fmt.Fprintf(os.Stderr, "[error] %v\r\n", exitErr)
		return exitErr
	}
	return nil
}

func inputLoop(ctx context.Context, rpcClient *wshutil.WshRpc, blockId string, vp *Viewport, vr *ViewportRenderer, resyncCh chan<- struct{}) error {
	pk := newPrefixKey()
	rawBuf := make([]byte, 4096)
	for {
		n, err := os.Stdin.Read(rawBuf)
		if err != nil {
			return err
		}
		raw := rawBuf[:n]

		// Filter out Ctrl+Arrow sequences (handle as viewport moves).
		// Remaining bytes go through the prefixKey detector and then to remote.
		filtered := raw[:0:0] // zero-length slice reusing no backing array
		moved := false
		i := 0
		for i < len(raw) {
			if dir, consumed := ctrlArrowDir(raw, i); consumed > 0 {
				switch dir {
				case 'U':
					vp.MoveUp(1)
				case 'D':
					vp.MoveDown(1)
				case 'L':
					vp.MoveLeft(1)
				case 'R':
					vp.MoveRight(1)
				}
				moved = true
				i += consumed
				continue
			}
			filtered = append(filtered, raw[i])
			i++
		}

		if moved {
			vr.Render()
		}

		if len(filtered) > 0 {
			var out bytes.Buffer
			action, err := pk.feed(filtered, &out)
			if err != nil {
				return err
			}
			if out.Len() > 0 {
				sendInput(rpcClient, blockId, out.Bytes())
			}
			switch action {
			case actionDetach:
				return ErrDetached
			case actionRedraw:
				vp.ForceFullRedraw()
				vr.Render()
			case actionResync:
				select {
				case resyncCh <- struct{}{}:
				default:
				}
			case actionScrollUp:
				vp.MoveUp(1)
				vr.Render()
			case actionScrollDown:
				vp.MoveDown(1)
				vr.Render()
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
}

func sendInput(rpcClient *wshutil.WshRpc, blockId string, data []byte) {
	req := wshrpc.CommandBlockInputData{
		BlockId:     blockId,
		InputData64: base64.StdEncoding.EncodeToString(data),
	}
	// ignore transient RPC errors to keep the attach alive
	wshclient.ControllerInputCommand(rpcClient, req, &wshrpc.RpcOpts{Timeout: 2000})
}

func getBlockTermSize(rpcClient *wshutil.WshRpc, blockId string) *waveobj.TermSize {
	info, err := wshclient.BlockInfoCommand(rpcClient, blockId, &wshrpc.RpcOpts{Timeout: 3000})
	if err != nil || info == nil || info.Block == nil {
		return nil
	}
	rtOpts := info.Block.RuntimeOpts
	if rtOpts == nil || (rtOpts.TermSize.Rows == 0 && rtOpts.TermSize.Cols == 0) {
		return nil
	}
	return &waveobj.TermSize{Rows: rtOpts.TermSize.Rows, Cols: rtOpts.TermSize.Cols}
}
