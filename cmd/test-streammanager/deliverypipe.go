// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/base64"
	"math/rand"
	"sort"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type DeliveryConfig struct {
	Delay time.Duration
	Skew  time.Duration
}

type taggedPacket struct {
	seq          uint64
	deliveryTime time.Time
	isData       bool
	dataPk       wshrpc.CommandStreamData
	ackPk        wshrpc.CommandStreamAckData
	dataSize     int
}

type DeliveryPipe struct {
	lock   sync.Mutex
	config DeliveryConfig

	// Sequence counters (separate for data and ack)
	dataSeq uint64
	ackSeq  uint64

	// Pending packets sorted by (deliveryTime, seq)
	dataPending []taggedPacket
	ackPending  []taggedPacket

	// Delivery targets
	dataTarget func(wshrpc.CommandStreamData)
	ackTarget  func(wshrpc.CommandStreamAckData)

	// Control
	closed bool
	wg     sync.WaitGroup

	// Metrics
	metrics        *Metrics
	lastDataSeqNum int64
	lastAckSeqNum  int64

	// Byte tracking for high water mark
	currentBytes int64
}

func NewDeliveryPipe(config DeliveryConfig, metrics *Metrics) *DeliveryPipe {
	return &DeliveryPipe{
		config:         config,
		metrics:        metrics,
		lastDataSeqNum: -1,
		lastAckSeqNum:  -1,
	}
}

func (dp *DeliveryPipe) SetDataTarget(fn func(wshrpc.CommandStreamData)) {
	dp.lock.Lock()
	defer dp.lock.Unlock()
	dp.dataTarget = fn
}

func (dp *DeliveryPipe) SetAckTarget(fn func(wshrpc.CommandStreamAckData)) {
	dp.lock.Lock()
	defer dp.lock.Unlock()
	dp.ackTarget = fn
}

func (dp *DeliveryPipe) EnqueueData(pkt wshrpc.CommandStreamData) {
	dp.lock.Lock()
	defer dp.lock.Unlock()

	if dp.closed {
		return
	}

	dataSize := base64.StdEncoding.DecodedLen(len(pkt.Data64))
	dp.dataSeq++
	tagged := taggedPacket{
		seq:          dp.dataSeq,
		deliveryTime: dp.computeDeliveryTime(),
		isData:       true,
		dataPk:       pkt,
		dataSize:     dataSize,
	}

	dp.dataPending = append(dp.dataPending, tagged)
	dp.sortPending(&dp.dataPending)

	dp.currentBytes += int64(dataSize)
	if dp.metrics != nil {
		dp.metrics.AddDataPacket()
		dp.metrics.UpdatePipeHighWaterMark(dp.currentBytes)
	}
}

func (dp *DeliveryPipe) EnqueueAck(pkt wshrpc.CommandStreamAckData) {
	dp.lock.Lock()
	defer dp.lock.Unlock()

	if dp.closed {
		return
	}

	dp.ackSeq++
	tagged := taggedPacket{
		seq:          dp.ackSeq,
		deliveryTime: dp.computeDeliveryTime(),
		isData:       false,
		ackPk:        pkt,
	}

	dp.ackPending = append(dp.ackPending, tagged)
	dp.sortPending(&dp.ackPending)

	if dp.metrics != nil {
		dp.metrics.AddAckPacket()
	}
}

func (dp *DeliveryPipe) computeDeliveryTime() time.Time {
	base := time.Now().Add(dp.config.Delay)

	if dp.config.Skew == 0 {
		return base
	}

	// Random skew: -skew to +skew
	skewNs := dp.config.Skew.Nanoseconds()
	randomSkew := time.Duration(rand.Int63n(2*skewNs+1) - skewNs)
	return base.Add(randomSkew)
}

func (dp *DeliveryPipe) sortPending(pending *[]taggedPacket) {
	sort.Slice(*pending, func(i, j int) bool {
		pi, pj := (*pending)[i], (*pending)[j]
		if pi.deliveryTime.Equal(pj.deliveryTime) {
			return pi.seq < pj.seq
		}
		return pi.deliveryTime.Before(pj.deliveryTime)
	})
}

func (dp *DeliveryPipe) Start() {
	dp.wg.Add(2)
	go dp.dataDeliveryLoop()
	go dp.ackDeliveryLoop()
}

func (dp *DeliveryPipe) dataDeliveryLoop() {
	defer dp.wg.Done()
	dp.deliveryLoop(
		func() *[]taggedPacket { return &dp.dataPending },
		func(pkt taggedPacket) {
			if dp.dataTarget != nil {
				// Track out-of-order packets
				if dp.metrics != nil && dp.lastDataSeqNum != -1 {
					if pkt.dataPk.Seq < dp.lastDataSeqNum {
						dp.metrics.AddOOOPacket()
					}
				}
				dp.lastDataSeqNum = pkt.dataPk.Seq
				dp.dataTarget(pkt.dataPk)

				dp.lock.Lock()
				dp.currentBytes -= int64(pkt.dataSize)
				dp.lock.Unlock()
			}
		},
	)
}

func (dp *DeliveryPipe) ackDeliveryLoop() {
	defer dp.wg.Done()
	dp.deliveryLoop(
		func() *[]taggedPacket { return &dp.ackPending },
		func(pkt taggedPacket) {
			if dp.ackTarget != nil {
				// Track out-of-order acks
				if dp.metrics != nil && dp.lastAckSeqNum != -1 {
					if pkt.ackPk.Seq < dp.lastAckSeqNum {
						dp.metrics.AddOOOPacket()
					}
				}
				dp.lastAckSeqNum = pkt.ackPk.Seq
				dp.ackTarget(pkt.ackPk)
			}
		},
	)
}

func (dp *DeliveryPipe) deliveryLoop(
	getPending func() *[]taggedPacket,
	deliver func(taggedPacket),
) {
	for {
		dp.lock.Lock()
		if dp.closed {
			dp.lock.Unlock()
			return
		}

		pending := getPending()
		now := time.Now()

		// Find all packets ready for delivery (deliveryTime <= now)
		readyCount := 0
		for _, pkt := range *pending {
			if pkt.deliveryTime.After(now) {
				break
			}
			readyCount++
		}

		// Extract ready packets
		ready := make([]taggedPacket, readyCount)
		copy(ready, (*pending)[:readyCount])
		*pending = (*pending)[readyCount:]

		dp.lock.Unlock()

		// Deliver all ready packets (outside lock)
		for _, pkt := range ready {
			deliver(pkt)
		}

		// Always sleep 1ms - simple busy loop
		time.Sleep(1 * time.Millisecond)
	}
}

func (dp *DeliveryPipe) Close() {
	dp.lock.Lock()
	dp.closed = true
	dp.lock.Unlock()

	dp.wg.Wait()
}
