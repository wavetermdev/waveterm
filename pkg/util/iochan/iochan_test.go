// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package iochan_test

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/iochan"
)

const (
	buflen = 1024
)

func TestIochan_Basic(t *testing.T) {
	// Write the packet to the source pipe from a goroutine
	srcPipeReader, srcPipeWriter := io.Pipe()
	packet := []byte("hello world")
	go func() {
		srcPipeWriter.Write(packet)
		srcPipeWriter.Close()
	}()

	// Initialize the reader channel
	readerChanCallbackCalled := false
	readerChanCallback := func() {
		srcPipeReader.Close()
		readerChanCallbackCalled = true
	}
	defer readerChanCallback() // Ensure the callback is called
	ioch := iochan.ReaderChan(context.TODO(), srcPipeReader, buflen, readerChanCallback)

	// Initialize the destination pipe and the writer channel
	destPipeReader, destPipeWriter := io.Pipe()
	writerChanCallbackCalled := false
	writerChanCallback := func() {
		destPipeReader.Close()
		destPipeWriter.Close()
		writerChanCallbackCalled = true
	}
	defer writerChanCallback() // Ensure the callback is called
	iochan.WriterChan(context.TODO(), destPipeWriter, ioch, writerChanCallback, func(err error) {})

	// Read the packet from the destination pipe and compare it to the original packet
	buf := make([]byte, buflen)
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

	// Give the callbacks a chance to run before checking if they were called
	time.Sleep(10 * time.Millisecond)
	if !readerChanCallbackCalled {
		t.Fatalf("ReaderChan callback not called")
	}
	if !writerChanCallbackCalled {
		t.Fatalf("WriterChan callback not called")
	}
}
