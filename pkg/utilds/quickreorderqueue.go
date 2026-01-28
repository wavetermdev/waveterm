// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilds

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// the quick reorder queue implements reordering of items with a certain timerame (the timeout passed)
// if an item is queued in order, it gets processed immediately
// if it comes in out of order it gets buffered for up to the timeout while we wait for the correct next seq to come in
// if we still haven't received the "correct" next seq within the timeout the out of order event is flushed.
// "old" events (less than the current nextseq) are flushed immediately
//
// we also implement a "session" system.  each session is assigned a virtual order based on the timestamp
// it was first seen.  so all events of a session are either "before" or "after" all the events of a different session.
// the assumption is that sessions will always be separated by an amount of time greater than the timeout of the reorder queue (e.g. a system reboot, or main server restart)
//
// enqueuing without a sessionid or if seqNum is 0, will bypass the reorder queue and just flush the event

type queuedItem[T any] struct {
	sessionId string
	seqNum    int
	data      T
	timestamp time.Time
}

type QuickReorderQueue[T any] struct {
	lock             sync.Mutex
	sessionOrder     map[string]int64 // sessionId -> timestamp millis when first seen
	currentSessionId string
	nextSeqNum       int
	buffer           []queuedItem[T]
	outCh            chan T
	timeout          time.Duration
	timer            *time.Timer
	closed           bool
}

func MakeQuickReorderQueue[T any](bufSize int, timeout time.Duration) *QuickReorderQueue[T] {
	return &QuickReorderQueue[T]{
		sessionOrder: make(map[string]int64),
		nextSeqNum:   1,
		outCh:        make(chan T, bufSize),
		timeout:      timeout,
	}
}

func (q *QuickReorderQueue[T]) C() <-chan T {
	return q.outCh
}

func (q *QuickReorderQueue[T]) SetNextSeqNum(seqNum int) {
	q.lock.Lock()
	defer q.lock.Unlock()
	q.nextSeqNum = seqNum
}

func (q *QuickReorderQueue[T]) ensureSessionTs_withlock(sessionId string) {
	if sessionId == "" {
		return
	}
	if _, ok := q.sessionOrder[sessionId]; ok {
		return
	}
	ts := time.Now().UnixMilli()
	q.sessionOrder[sessionId] = ts
	q.flushBuffer_withlock()
	q.currentSessionId = sessionId
	q.nextSeqNum = 1
}

func (q *QuickReorderQueue[T]) cmpSessionSeq_withlock(session1 string, seq1 int, session2 string, seq2 int) int {
	ts1 := q.sessionOrder[session1]
	ts2 := q.sessionOrder[session2]
	if ts1 < ts2 {
		return -1
	}
	if ts1 > ts2 {
		return 1
	}
	if seq1 < seq2 {
		return -1
	}
	if seq1 > seq2 {
		return 1
	}
	return 0
}

func (q *QuickReorderQueue[T]) sortBuffer_withlock() {
	sort.Slice(q.buffer, func(i, j int) bool {
		return q.cmpSessionSeq_withlock(q.buffer[i].sessionId, q.buffer[i].seqNum, q.buffer[j].sessionId, q.buffer[j].seqNum) < 0
	})
}

func (q *QuickReorderQueue[T]) flushBuffer_withlock() {
	if len(q.buffer) == 0 {
		return
	}
	q.sortBuffer_withlock()
	for _, item := range q.buffer {
		q.outCh <- item.data
	}
	q.buffer = nil
	if q.timer != nil {
		q.timer.Stop()
		q.timer = nil
	}
}

func (q *QuickReorderQueue[T]) QueueItem(sessionId string, seqNum int, data T) error {
	q.lock.Lock()
	defer q.lock.Unlock()

	if q.closed {
		return fmt.Errorf("ReorderQueue is closed, cannot queue new item")
	}

	if len(q.buffer)+len(q.outCh) >= cap(q.outCh) {
		return fmt.Errorf("queue is full, cannot accept new items, cap: %d", cap(q.outCh))
	}

	q.ensureSessionTs_withlock(sessionId)

	cmp := q.cmpSessionSeq_withlock(sessionId, seqNum, q.currentSessionId, q.nextSeqNum)

	if cmp < 0 || seqNum == 0 || sessionId == "" {
		q.outCh <- data
		return nil
	}

	if cmp == 0 {
		q.outCh <- data
		q.nextSeqNum++
		q.processBuffer_withlock()
		return nil
	}

	q.buffer = append(q.buffer, queuedItem[T]{
		sessionId: sessionId,
		seqNum:    seqNum,
		data:      data,
		timestamp: time.Now(),
	})
	q.ensureTimer_withlock()
	return nil
}

func (q *QuickReorderQueue[T]) processBuffer_withlock() {
	if len(q.buffer) == 0 {
		return
	}

	q.sortBuffer_withlock()

	enqueued := 0
	for i, item := range q.buffer {
		if item.sessionId == q.currentSessionId && item.seqNum == q.nextSeqNum {
			q.outCh <- item.data
			q.nextSeqNum++
			enqueued = i + 1
		} else {
			break
		}
	}

	if enqueued > 0 {
		q.buffer = q.buffer[enqueued:]
	}
}

func (q *QuickReorderQueue[T]) ensureTimer_withlock() {
	if q.timer != nil {
		return
	}
	q.timer = time.AfterFunc(q.timeout, func() {
		q.onTimeout()
	})
}

func (q *QuickReorderQueue[T]) onTimeout() {
	q.lock.Lock()
	defer q.lock.Unlock()

	if q.closed {
		return
	}

	q.timer = nil

	if len(q.buffer) == 0 {
		return
	}

	now := time.Now()

	q.sortBuffer_withlock()

	highestTimedOutIdx := -1
	for i, item := range q.buffer {
		if now.Sub(item.timestamp) >= q.timeout {
			highestTimedOutIdx = i
		}
	}

	if highestTimedOutIdx >= 0 {
		for i := 0; i <= highestTimedOutIdx; i++ {
			item := q.buffer[i]
			q.outCh <- item.data
			if item.sessionId == q.currentSessionId && item.seqNum >= q.nextSeqNum {
				q.nextSeqNum = item.seqNum + 1
			}
		}
		q.buffer = q.buffer[highestTimedOutIdx+1:]
	}

	if len(q.buffer) > 0 {
		oldestTime := q.buffer[0].timestamp
		for _, item := range q.buffer[1:] {
			if item.timestamp.Before(oldestTime) {
				oldestTime = item.timestamp
			}
		}
		nextTimeout := q.timeout - now.Sub(oldestTime)
		if nextTimeout < 0 {
			nextTimeout = 0
		}
		q.timer = time.AfterFunc(nextTimeout, func() {
			q.onTimeout()
		})
	}
}

func (q *QuickReorderQueue[T]) Close() {
	q.lock.Lock()
	defer q.lock.Unlock()

	if q.closed {
		return
	}
	q.closed = true
	if q.timer != nil {
		q.timer.Stop()
		q.timer = nil
	}
	close(q.outCh)
}
