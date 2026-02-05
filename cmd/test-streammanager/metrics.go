// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"sync"
	"time"
)

type Metrics struct {
	lock sync.Mutex

	// Timing
	startTime time.Time
	endTime   time.Time

	// Data transfer
	totalBytes int64

	// Packet counts
	dataPackets int64
	ackPackets  int64

	// Out of order tracking
	oooPackets int64

	// High water mark for pipe bytes
	pipeHighWaterMark int64
}

func NewMetrics() *Metrics {
	return &Metrics{}
}

func (m *Metrics) Start() {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.startTime = time.Now()
}

func (m *Metrics) End() {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.endTime = time.Now()
}

func (m *Metrics) AddDataPacket() {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.dataPackets++
}

func (m *Metrics) AddAckPacket() {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.ackPackets++
}

func (m *Metrics) AddOOOPacket() {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.oooPackets++
}

func (m *Metrics) AddBytes(n int64) {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.totalBytes += n
}

func (m *Metrics) UpdatePipeHighWaterMark(currentBytes int64) {
	m.lock.Lock()
	defer m.lock.Unlock()
	if currentBytes > m.pipeHighWaterMark {
		m.pipeHighWaterMark = currentBytes
	}
}

func (m *Metrics) GetPipeHighWaterMark() int64 {
	m.lock.Lock()
	defer m.lock.Unlock()
	return m.pipeHighWaterMark
}

func (m *Metrics) Report() string {
	m.lock.Lock()
	defer m.lock.Unlock()

	duration := m.endTime.Sub(m.startTime)
	durationSecs := duration.Seconds()
	if durationSecs == 0 {
		durationSecs = 1.0
	}
	throughput := float64(m.totalBytes) / durationSecs / 1024 / 1024

	return fmt.Sprintf(`
StreamManager Integration Test Results
======================================
Duration:        %v
Total Bytes:     %d
Throughput:      %.2f MB/s
Data Packets:    %d
Ack Packets:     %d
OOO Packets:     %d
Pipe High Water: %d bytes (%.2f KB)
`, duration, m.totalBytes, throughput, m.dataPackets, m.ackPackets, m.oooPackets,
		m.pipeHighWaterMark, float64(m.pipeHighWaterMark)/1024)
}
