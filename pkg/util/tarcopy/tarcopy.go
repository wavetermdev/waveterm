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

	"github.com/wavetermdev/waveterm/pkg/util/iochan"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	tarCopySrcName  = "TarCopySrc"
	tarCopyDestName = "TarCopyDest"
	pipeReaderName  = "pipe reader"
	pipeWriterName  = "pipe writer"
	tarWriterName   = "tar writer"

	// custom flag to indicate that the source is a single file
	SingleFile = "singlefile"
)

// TarCopySrc creates a tar stream writer and returns a channel to send the tar stream to.
// writeHeader is a function that writes the tar header for the file. If only a single file is being written, the singleFile flag should be set to true.
// writer is the tar writer to write the file data to.
// close is a function that closes the tar writer and internal pipe writer.
func TarCopySrc(ctx context.Context, pathPrefix string) (outputChan chan wshrpc.RespOrErrorUnion[iochantypes.Packet], writeHeader func(fi fs.FileInfo, file string, singleFile bool) error, writer io.Writer, close func()) {
	pipeReader, pipeWriter := io.Pipe()
	tarWriter := tar.NewWriter(pipeWriter)
	rtnChan := iochan.ReaderChan(ctx, pipeReader, wshrpc.FileChunkSize, func() {
		log.Printf("Closing pipe reader\n")
		utilfn.GracefulClose(pipeReader, tarCopySrcName, pipeReaderName)
	})

	singleFileFlagSet := false

	return rtnChan, func(fi fs.FileInfo, path string, singleFile bool) error {
			// generate tar header
			header, err := tar.FileInfoHeader(fi, path)
			if err != nil {
				return err
			}

			if singleFile {
				if singleFileFlagSet {
					return errors.New("attempting to write multiple files to a single file tar stream")
				}

				header.PAXRecords = map[string]string{SingleFile: "true"}
				singleFileFlagSet = true
			}

			path, err = fixPath(path, pathPrefix)
			if err != nil {
				return err
			}

			// skip if path is empty, which means the file is the root directory
			if path == "" {
				return nil
			}
			header.Name = path

			log.Printf("TarCopySrc: header name: %v\n", header.Name)

			// write header
			if err := tarWriter.WriteHeader(header); err != nil {
				return err
			}
			return nil
		}, tarWriter, func() {
			log.Printf("Closing tar writer\n")
			utilfn.GracefulClose(tarWriter, tarCopySrcName, tarWriterName)
			utilfn.GracefulClose(pipeWriter, tarCopySrcName, pipeWriterName)
		}
}

func fixPath(path, prefix string) (string, error) {
	path = strings.TrimPrefix(strings.TrimPrefix(filepath.Clean(strings.TrimPrefix(path, prefix)), "/"), "\\")
	if strings.Contains(path, "..") {
		return "", fmt.Errorf("invalid tar path containing directory traversal: %s", path)
	}
	return path, nil
}

// TarCopyDest reads a tar stream from a channel and writes the files to the destination.
// readNext is a function that is called for each file in the tar stream to read the file data. If only a single file is being written from the tar src, the singleFile flag will be set in this callback. It should return an error if the file cannot be read.
// The function returns an error if the tar stream cannot be read.
func TarCopyDest(ctx context.Context, cancel context.CancelCauseFunc, ch <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet], readNext func(next *tar.Header, reader *tar.Reader, singleFile bool) error) error {
	pipeReader, pipeWriter := io.Pipe()
	iochan.WriterChan(ctx, pipeWriter, ch, func() {
		utilfn.GracefulClose(pipeWriter, tarCopyDestName, pipeWriterName)
	}, cancel)
	tarReader := tar.NewReader(pipeReader)
	defer func() {
		if !utilfn.GracefulClose(pipeReader, tarCopyDestName, pipeReaderName) {
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

			// Check for directory traversal
			if strings.Contains(next.Name, "..") {
				return fmt.Errorf("invalid tar path containing directory traversal: %s", next.Name)
			}
			err = readNext(next, tarReader, next.PAXRecords != nil && next.PAXRecords[SingleFile] == "true")
			if err != nil {
				return err
			}
		}
	}
}
