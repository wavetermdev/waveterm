// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/jobmanager"
	"github.com/wavetermdev/waveterm/pkg/streamclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type TestConfig struct {
	Mode       string
	DataSize   int64
	Delay      time.Duration
	Skew       time.Duration
	WindowSize int
	SlowReader int
	Verbose    bool
}

var config TestConfig

var rootCmd = &cobra.Command{
	Use:   "test-streammanager",
	Short: "Integration test for StreamManager streaming system",
	RunE: func(cmd *cobra.Command, args []string) error {
		return runTest(config)
	},
}

func init() {
	rootCmd.Flags().StringVar(&config.Mode, "mode", "streammanager", "Writer mode: 'streammanager' or 'writer'")
	rootCmd.Flags().Int64Var(&config.DataSize, "size", 10*1024*1024, "Total data to transfer (bytes)")
	rootCmd.Flags().DurationVar(&config.Delay, "delay", 0, "Base delivery delay (e.g., 10ms)")
	rootCmd.Flags().DurationVar(&config.Skew, "skew", 0, "Delivery skew +/- (e.g., 5ms)")
	rootCmd.Flags().IntVar(&config.WindowSize, "windowsize", 64*1024, "Window size for both sender and receiver")
	rootCmd.Flags().IntVar(&config.SlowReader, "slowreader", 0, "Slow reader mode: bytes per second (0=disabled, e.g., 1024)")
	rootCmd.Flags().BoolVar(&config.Verbose, "verbose", false, "Enable verbose logging")
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func runTest(config TestConfig) error {
	if config.Mode != "streammanager" && config.Mode != "writer" {
		return fmt.Errorf("invalid mode: %s (must be 'streammanager' or 'writer')", config.Mode)
	}

	fmt.Printf("Starting Streaming Integration Test\n")
	fmt.Printf("  Mode: %s\n", config.Mode)
	fmt.Printf("  Data Size: %d bytes\n", config.DataSize)
	fmt.Printf("  Delay: %v, Skew: %v\n", config.Delay, config.Skew)
	fmt.Printf("  Window Size: %d\n", config.WindowSize)
	if config.SlowReader > 0 {
		fmt.Printf("  Slow Reader: %d bytes/sec\n", config.SlowReader)
	}

	// 1. Create metrics
	metrics := NewMetrics()

	// 2. Create the delivery pipe
	pipe := NewDeliveryPipe(DeliveryConfig{
		Delay: config.Delay,
		Skew:  config.Skew,
	}, metrics)

	// 3. Create brokers with bridges
	writerBridge := &WriterBridge{pipe: pipe}
	readerBridge := &ReaderBridge{pipe: pipe}

	writerBroker := streamclient.NewBroker(writerBridge)
	readerBroker := streamclient.NewBroker(readerBridge)

	// 4. Wire up delivery targets
	pipe.SetDataTarget(readerBroker.RecvData)
	pipe.SetAckTarget(writerBroker.RecvAck)

	// 5. Start the delivery pipe
	pipe.Start()

	// 6. Create the reader side
	reader, streamMeta := readerBroker.CreateStreamReader("reader-route", "writer-route", int64(config.WindowSize))

	// 7. Set up writer side based on mode
	var writerDone chan error
	if config.Mode == "streammanager" {
		writerDone = runStreamManagerMode(config, writerBroker, streamMeta)
	} else {
		writerDone = runWriterMode(config, writerBroker, streamMeta)
	}

	// 8. Create verifier
	verifier := NewVerifier(config.DataSize)

	// 9. Create metrics writer wrapper
	metricsWriter := &MetricsWriter{
		writer:  verifier,
		metrics: metrics,
	}

	// 10. Wrap reader with slow reader if configured
	var actualReader io.Reader = reader
	if config.SlowReader > 0 {
		actualReader = NewSlowReader(reader, config.SlowReader)
	}

	// 11. Start reading from stream reader and writing to verifier
	metrics.Start()

	readerDone := make(chan error)
	go func() {
		_, err := io.Copy(metricsWriter, actualReader)
		readerDone <- err
	}()

	// 12. Wait for completion
	var writerErr, readerErr error
	if writerDone != nil {
		writerErr = <-writerDone
	}
	readerErr = <-readerDone
	metrics.End()

	// 13. Cleanup
	pipe.Close()
	writerBroker.Close()
	readerBroker.Close()

	// 14. Report results
	fmt.Println(metrics.Report())
	fmt.Printf("Verification: received=%d, mismatches=%d\n",
		verifier.TotalReceived(), verifier.Mismatches())

	if writerErr != nil && writerErr != io.EOF {
		return fmt.Errorf("writer error: %w", writerErr)
	}

	if readerErr != nil && readerErr != io.EOF {
		return fmt.Errorf("reader error: %w", readerErr)
	}

	if verifier.Mismatches() > 0 {
		return fmt.Errorf("data corruption: %d mismatches, first at byte %d",
			verifier.Mismatches(), verifier.FirstMismatch())
	}

	fmt.Println("TEST PASSED")
	return nil
}

func runStreamManagerMode(config TestConfig, writerBroker *streamclient.Broker, streamMeta *wshrpc.StreamMeta) chan error {
	streamManager := jobmanager.MakeStreamManagerWithSizes(config.WindowSize, 2*1024*1024)
	writerBroker.AttachStreamWriter(streamMeta, streamManager)

	dataSender := &BrokerDataSender{broker: writerBroker}
	startSeq, err := streamManager.ClientConnected(streamMeta.Id, dataSender, config.WindowSize, 0)
	if err != nil {
		fmt.Printf("failed to connect stream manager: %v\n", err)
		return nil
	}
	fmt.Printf("  Stream connected, startSeq: %d\n", startSeq)

	generator := NewTestDataGenerator(config.DataSize)
	if err := streamManager.AttachReader(generator); err != nil {
		fmt.Printf("failed to attach reader: %v\n", err)
		return nil
	}

	return nil
}

func runWriterMode(config TestConfig, writerBroker *streamclient.Broker, streamMeta *wshrpc.StreamMeta) chan error {
	writer, err := writerBroker.CreateStreamWriter(streamMeta)
	if err != nil {
		fmt.Printf("failed to create stream writer: %v\n", err)
		return nil
	}
	fmt.Printf("  Stream writer created\n")

	generator := NewTestDataGenerator(config.DataSize)

	done := make(chan error, 1)
	go func() {
		_, copyErr := io.Copy(writer, generator)
		closeErr := writer.Close()
		if copyErr != nil && copyErr != io.EOF {
			done <- copyErr
		} else {
			done <- closeErr
		}
	}()

	return done
}

// BrokerDataSender implements DataSender interface
type BrokerDataSender struct {
	broker *streamclient.Broker
}

func (s *BrokerDataSender) SendData(dataPk wshrpc.CommandStreamData) {
	s.broker.SendData(dataPk)
}

// MetricsWriter wraps an io.Writer and records bytes written to metrics
type MetricsWriter struct {
	writer  io.Writer
	metrics *Metrics
}

func (mw *MetricsWriter) Write(p []byte) (n int, err error) {
	n, err = mw.writer.Write(p)
	if n > 0 {
		mw.metrics.AddBytes(int64(n))
	}
	return n, err
}

// SlowReader wraps an io.Reader and rate-limits reads to a specified bytes/sec
type SlowReader struct {
	reader      io.Reader
	bytesPerSec int
}

func NewSlowReader(reader io.Reader, bytesPerSec int) *SlowReader {
	return &SlowReader{
		reader:      reader,
		bytesPerSec: bytesPerSec,
	}
}

func (sr *SlowReader) Read(p []byte) (n int, err error) {
	time.Sleep(1 * time.Second)

	readSize := sr.bytesPerSec
	if readSize > len(p) {
		readSize = len(p)
	}

	n, err = sr.reader.Read(p[:readSize])
	log.Printf("SlowReader: read %d bytes, err=%v", n, err)
	return n, err
}
