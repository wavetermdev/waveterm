// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// allows for streaming an io.Reader to a channel and an io.Writer from a channel
package iochan

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// ReaderChan reads from an io.Reader and sends the data to a channel
func ReaderChan(ctx context.Context, r io.Reader, chunkSize int64, callback func()) chan wshrpc.RespOrErrorUnion[[]byte] {
	ch := make(chan wshrpc.RespOrErrorUnion[[]byte], 32)
	go func() {
		defer func() {
			log.Printf("ReaderChan: closing channel")
			close(ch)
			callback()
		}()
		buf := make([]byte, chunkSize)
		for {
			select {
			case <-ctx.Done():
				if ctx.Err() == context.Canceled {
					return
				}
				log.Printf("ReaderChan: context error: %v", ctx.Err())
				return
			default:
				if n, err := r.Read(buf); err != nil {
					if errors.Is(err, io.EOF) {
						log.Printf("ReaderChan: EOF")
						return
					}
					ch <- wshutil.RespErr[[]byte](fmt.Errorf("ReaderChan: read error: %v", err))
					log.Printf("ReaderChan: read error: %v", err)
					return
				} else if n > 0 {
					// log.Printf("ReaderChan: read %d bytes", n)
					ch <- wshrpc.RespOrErrorUnion[[]byte]{Response: buf[:n]}
				}
			}
		}
	}()
	return ch
}

// WriterChan reads from a channel and writes the data to an io.Writer
func WriterChan(ctx context.Context, w io.Writer, ch <-chan wshrpc.RespOrErrorUnion[[]byte], callback func(), errCallback func(error)) {
	go func() {
		defer func() {
			log.Printf("WriterChan: closing channel")
			callback()
			drainChannel(ch)
		}()
		for {
			select {
			case <-ctx.Done():
				return
			case resp, ok := <-ch:
				if !ok {
					return
				}
				if resp.Error != nil {
					log.Printf("WriterChan: error: %v", resp.Error)
					errCallback(resp.Error)
					return
				}
				if _, err := w.Write(resp.Response); err != nil {
					log.Printf("WriterChan: write error: %v", err)
					errCallback(err)
					return
				} else {
					// log.Printf("WriterChan: wrote %d bytes", n)
				}
			}
		}
	}()
}

func drainChannel(ch <-chan wshrpc.RespOrErrorUnion[[]byte]) {
	for range ch {}
}
