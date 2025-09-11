// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"log"
	"time"
)

const NotifyMaxCadence = 10 * time.Millisecond
const NotifyDebounceTime = 500 * time.Microsecond
const NotifyMaxDebounceTime = 2 * time.Millisecond

func (c *ClientImpl) notifyAsyncRenderWork() {
	log.Printf("notify async work\n")
	c.notifyOnce.Do(func() {
		c.notifyWakeCh = make(chan struct{}, 1)
		go c.asyncInitiationLoop()
	})

	nowNs := time.Now().UnixNano()
	c.notifyLastEventNs.Store(nowNs)
	// Establish batch start if there's no active batch.
	if c.notifyBatchStartNs.Load() == 0 {
		c.notifyBatchStartNs.CompareAndSwap(0, nowNs)
	}
	// Coalesced wake-up.
	select {
	case c.notifyWakeCh <- struct{}{}:
	default:
	}
}

func (c *ClientImpl) asyncInitiationLoop() {
	var (
		lastSent time.Time
		timer    *time.Timer
		timerC   <-chan time.Time
	)

	schedule := func() {
		firstNs := c.notifyBatchStartNs.Load()
		if firstNs == 0 {
			// No pending batch; stop timer if running.
			if timer != nil {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
			}
			timerC = nil
			return
		}
		lastNs := c.notifyLastEventNs.Load()

		first := time.Unix(0, firstNs)
		last := time.Unix(0, lastNs)
		cadenceReady := lastSent.Add(NotifyMaxCadence)

		// Reset the 2ms "max debounce" window at the cadence boundary:
		// deadline = max(first, cadenceReady) + 2ms
		anchor := first
		if cadenceReady.After(anchor) {
			anchor = cadenceReady
		}
		deadline := anchor.Add(NotifyMaxDebounceTime)

		// candidate = min(last+500us, deadline)
		candidate := last.Add(NotifyDebounceTime)
		if deadline.Before(candidate) {
			candidate = deadline
		}

		// final target = max(cadenceReady, candidate)
		target := candidate
		if cadenceReady.After(target) {
			target = cadenceReady
		}

		d := time.Until(target)
		if d < 0 {
			d = 0
		}
		if timer == nil {
			timer = time.NewTimer(d)
		} else {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(d)
		}
		timerC = timer.C
	}

	for {
		select {
		case <-c.notifyWakeCh:
			schedule()

		case <-timerC:
			now := time.Now()

			// Recompute right before sending; if a late event arrived,
			// push the fire time out to respect the debounce.
			firstNs := c.notifyBatchStartNs.Load()
			if firstNs == 0 {
				// Nothing to do.
				continue
			}
			lastNs := c.notifyLastEventNs.Load()

			first := time.Unix(0, firstNs)
			last := time.Unix(0, lastNs)
			cadenceReady := lastSent.Add(NotifyMaxCadence)

			anchor := first
			if cadenceReady.After(anchor) {
				anchor = cadenceReady
			}
			deadline := anchor.Add(NotifyMaxDebounceTime)

			candidate := last.Add(NotifyDebounceTime)
			if deadline.Before(candidate) {
				candidate = deadline
			}
			target := candidate
			if cadenceReady.After(target) {
				target = cadenceReady
			}

			// If we're early (because a new event just came in), reschedule.
			if now.Before(target) {
				d := time.Until(target)
				if d < 0 {
					d = 0
				}
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(d)
				continue
			}

			// Fire.
			_ = c.SendAsyncInitiation()
			lastSent = now

			// Close current batch; a concurrent notify will CAS a new start.
			c.notifyBatchStartNs.Store(0)

			// If anything is already pending, this will arm the next timer.
			schedule()
		}
	}
}
