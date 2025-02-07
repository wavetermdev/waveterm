// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package tarcopy provides functions for copying files over a channel via a tar stream.
package tarcopy

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/iochan"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	maxRetries      = 5
	retryDelay      = 10 * time.Millisecond
	tarCopySrcName  = "TarCopySrc"
	tarCopyDestName = "TarCopyDest"
	pipeReaderName  = "pipe reader"
	pipeWriterName  = "pipe writer"
	tarWriterName   = "tar writer"
)

// TarCopySrc creates a tar stream writer and returns a channel to send the tar stream to.
// writeHeader is a function that writes the tar header for the file.
// writer is the tar writer to write the file data to.
// close is a function that closes the tar writer and internal pipe writer.
func TarCopySrc(ctx context.Context, pathPrefix string) (outputChan chan wshrpc.RespOrErrorUnion[iochantypes.Packet], writeHeader func(fi fs.FileInfo, file string) error, writer io.Writer, close func()) {
	pipeReader, pipeWriter := io.Pipe()
	tarWriter := tar.NewWriter(pipeWriter)
	rtnChan := iochan.ReaderChan(ctx, pipeReader, wshrpc.FileChunkSize, func() {
		gracefulClose(pipeReader, tarCopySrcName, pipeReaderName)
	})

	return rtnChan, func(fi fs.FileInfo, file string) error {
			// generate tar header
			header, err := tar.FileInfoHeader(fi, file)
			if err != nil {
				return err
			}

			header.Name = filepath.Clean(strings.TrimPrefix(file, pathPrefix))
			if err := validatePath(header.Name); err != nil {
				return err
			}

			// write header
			if err := tarWriter.WriteHeader(header); err != nil {
				return err
			}
			return nil
		}, tarWriter, func() {
			gracefulClose(tarWriter, tarCopySrcName, tarWriterName)
			gracefulClose(pipeWriter, tarCopySrcName, pipeWriterName)
		}
}

func validatePath(path string) error {
	if strings.Contains(path, "..") {
		return fmt.Errorf("invalid tar path containing directory traversal: %s", path)
	}
	if strings.HasPrefix(path, "/") {
		return fmt.Errorf("invalid tar path starting with /: %s", path)
	}
	return nil
}

// TarCopyDest reads a tar stream from a channel and writes the files to the destination.
// readNext is a function that is called for each file in the tar stream to read the file data. It should return an error if the file cannot be read.
// The function returns an error if the tar stream cannot be read.
func TarCopyDest(ctx context.Context, cancel context.CancelCauseFunc, ch <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet], readNext func(next *tar.Header, reader *tar.Reader) error) error {
	pipeReader, pipeWriter := io.Pipe()
	iochan.WriterChan(ctx, pipeWriter, ch, func() {
		gracefulClose(pipeWriter, tarCopyDestName, pipeWriterName)
	}, cancel)
	tarReader := tar.NewReader(pipeReader)
	defer func() {
		if !gracefulClose(pipeReader, tarCopyDestName, pipeReaderName) {
			// If the pipe reader cannot be closed, cancel the context. This should kill the writer goroutine.
			cancel(nil)
		}
	}()
	for {
		select {
		case <-ctx.Done():
			if ctx.Err() != nil {
				return context.Cause(ctx)
			}
			return nil
		default:
			next, err := tarReader.Next()
			if err != nil {
				// Do one more check for context error before returning
				if ctx.Err() != nil {
					return context.Cause(ctx)
				}
				if errors.Is(err, io.EOF) {
					return nil
				} else {
					return err
				}
			}
			err = readNext(next, tarReader)
			if err != nil {
				return err
			}
		}
	}
}

func gracefulClose(closer io.Closer, debugName string, closerName string) bool {
	closed := false
	for retries := 0; retries < maxRetries; retries++ {
		if err := closer.Close(); err != nil {
			log.Printf("%s: error closing %s: %v, trying again in %dms\n", debugName, closerName, err, retryDelay.Milliseconds())
			time.Sleep(retryDelay)
			continue
		}
		closed = true
		break
	}
	if !closed {
		log.Printf("%s: unable to close %s after %d retries\n", debugName, closerName, maxRetries)
	}
	return closed
}
