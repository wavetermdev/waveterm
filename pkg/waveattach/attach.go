// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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

const ctrlA = 0x01

type prefixKey struct {
	gotPrefix bool
}

func newPrefixKey() *prefixKey { return &prefixKey{} }

func (p *prefixKey) feed(b []byte, w io.Writer) (detach bool, err error) {
	for _, c := range b {
		if !p.gotPrefix {
			if c == ctrlA {
				p.gotPrefix = true
				continue
			}
			if _, err := w.Write([]byte{c}); err != nil {
				return false, err
			}
			continue
		}
		switch c {
		case 'd', 'D':
			return true, nil
		case ctrlA:
			if _, err := w.Write([]byte{ctrlA}); err != nil {
				return false, err
			}
		default:
			p.gotPrefix = false
			if _, err := w.Write([]byte{ctrlA, c}); err != nil {
				return false, err
			}
		}
	}
	return false, nil
}

var ErrDetached = errors.New("detached")
var ErrBlockClosed = errors.New("block closed")

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

	origTermSize := getBlockTermSize(rpcClient, blockId)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	exitCh := make(chan error, 3)

	winchCh := make(chan os.Signal, 1)
	signal.Notify(winchCh, syscall.SIGWINCH)
	defer signal.Stop(winchCh)

	sendTermSize := func() {
		w, h, err := term.GetSize(fd)
		if err != nil {
			return
		}
		data := wshrpc.CommandBlockInputData{
			BlockId:  blockId,
			TermSize: &waveobj.TermSize{Rows: h, Cols: w},
		}
		_ = wshclient.ControllerInputCommand(rpcClient, data, nil)
	}
	sendTermSize()

	go func() {
		for {
			select {
			case <-winchCh:
				sendTermSize()
			case <-ctx.Done():
				return
			}
		}
	}()

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

	go func() {
		exitCh <- StreamOutput(ctx, rpcClient, blockId, os.Stdout)
	}()

	go func() {
		exitCh <- inputLoop(ctx, rpcClient, blockId)
	}()

	exitErr := <-exitCh
	cancel()
	if origTermSize != nil {
		restoreData := wshrpc.CommandBlockInputData{
			BlockId:  blockId,
			TermSize: origTermSize,
		}
		_ = wshclient.ControllerInputCommand(rpcClient, restoreData, &wshrpc.RpcOpts{Timeout: 3000})
	}
	// ensure cursor is at column 0 before printing exit message
	fmt.Fprintf(os.Stdout, "\r\n")
	switch {
	case errors.Is(exitErr, ErrDetached):
		fmt.Fprintf(os.Stderr, "\r\n[detached]\r\n")
		return nil
	case errors.Is(exitErr, ErrBlockClosed):
		fmt.Fprintf(os.Stderr, "\r\n[block closed]\r\n")
		return nil
	case exitErr != nil:
		fmt.Fprintf(os.Stderr, "\r\n[error] %v\r\n", exitErr)
		return exitErr
	}
	return nil
}

func inputLoop(ctx context.Context, rpcClient *wshutil.WshRpc, blockId string) error {
	pk := newPrefixKey()
	buf := make([]byte, 4096)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil {
			return err
		}
		var forward bytes.Buffer
		detach, err := pk.feed(buf[:n], &forward)
		if err != nil {
			return err
		}
		if forward.Len() > 0 {
			data := wshrpc.CommandBlockInputData{
				BlockId:     blockId,
				InputData64: base64.StdEncoding.EncodeToString(forward.Bytes()),
			}
			// ignore transient RPC errors (e.g. timeout under rapid input) to keep the attach alive
			wshclient.ControllerInputCommand(rpcClient, data, &wshrpc.RpcOpts{Timeout: 2000})
		}
		if detach {
			return ErrDetached
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
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
