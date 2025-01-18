// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// allows for streaming an io.Reader to a channel and an io.Writer from a channel
package iochan

import (
	"context"
	"fmt"
	"io"
	"log"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// ReaderChan reads from an io.Reader and sends the data to a channel
func ReaderChan(ctx context.Context, r io.Reader, chunkSize int64, callback func()) chan wshrpc.RespOrErrorUnion[[]byte] {
	ch := make(chan wshrpc.RespOrErrorUnion[[]byte], 16)
	go func() {
		defer close(ch)
		buf := make([]byte, chunkSize)
		for {
			if ctx.Err() != nil {
				log.Printf("ReaderChan: context error: %v", ctx.Err())
				callback()
				return
			}

			if n, err := r.Read(buf); err != nil && err != io.EOF {
				ch <- wshrpc.RespOrErrorUnion[[]byte]{Error: fmt.Errorf("ReaderChan: read error: %v", err)}
				log.Printf("ReaderChan: read error: %v", err)
				callback()
				return
			} else if n > 0 {
				log.Printf("ReaderChan: read %d bytes", n)
				ch <- wshrpc.RespOrErrorUnion[[]byte]{Response: buf[:n]}
			}
		}
	}()
	return ch
}

// WriterChan reads from a channel and writes the data to an io.Writer
func WriterChan(ctx context.Context, w io.Writer, ch <-chan wshrpc.RespOrErrorUnion[[]byte], callback func()) {
	go func() {
		defer callback()
		for resp := range ch {
			if resp.Error != nil {
				log.Printf("WriterChan: error: %v", resp.Error)
				return
			}
			if n, err := w.Write(resp.Response); err != nil {
				log.Printf("WriterChan: write error: %v", err)
				return
			} else {
				log.Printf("WriterChan: wrote %d bytes", n)
			}
		}
	}()
}
