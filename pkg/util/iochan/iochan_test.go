// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package iochan_test

import (
	"context"
	"io"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/iochan"
)

func TestIochan_Basic(t *testing.T) {
	pipeReader, pipeWriter := io.Pipe()
	packet := []byte("hello world")
	go func() {
		pipeWriter.Write(packet)
		pipeWriter.Close()
	}()
	destPipeReader, destPipeWriter := io.Pipe()
	defer destPipeReader.Close()
	defer destPipeWriter.Close()
	ioch := iochan.ReaderChan(context.TODO(), pipeReader, 1024, func() {
		pipeReader.Close()
		pipeWriter.Close()
	})
	iochan.WriterChan(destPipeWriter, ioch)
	buf := make([]byte, 1024)
	n, err := destPipeReader.Read(buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if n != len(packet) {
		t.Fatalf("Read length mismatch: %d != %d", n, len(packet))
	}
	if string(buf[:n]) != string(packet) {
		t.Fatalf("Read data mismatch: %s != %s", buf[:n], packet)
	}
}
