// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pstrack

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// -- Constants and Guardrails --

const (
	// PollInterval is fixed to 1 second.
	PollInterval = 1 * time.Second

	// MinPollInterval is the minimum allowed poll rate (200ms).
	MinPollInterval = 200 * time.Millisecond

	// Sentinel values used for missing sample data.
	SentinelNoDataCPU = -1.0
	SentinelNoDataMem = -1.0

	// MaxSamples is the maximum number of samples stored for sparklines.
	MaxSamples = 100

	// SleepThreshold: if gap > SleepThreshold, then flush sample history.
	SleepThreshold = 100 * time.Second

	// KilledProcessLinger is the duration that a killed process will remain in the table.
	KilledProcessLinger = 5 * time.Second
)

// -- Process Data Structure --

// ProcessInfo holds the process details for a "ps"-like display.
type ProcessInfo struct {
	User       string  `json:"user"`
	PID        int32   `json:"pid"`
	CPUPercent float64 `json:"cpu_percent"`
	MemPercent float32 `json:"mem_percent"`
	VSZ        uint64  `json:"vsz"`
	RSS        int32   `json:"rss"`
	TTY        string  `json:"tty"`
	Status     string  `json:"status"`

	// Started is the process creation time in Unix milliseconds.
	Started int64 `json:"started"`
	// CPUTime is the total CPU time in milliseconds.
	CPUTime int64 `json:"cpu_time"`

	Command   string `json:"command"`
	UpdatedTs int64  `json:"updated_ts"`

	CPUSamples []float64 `json:"cpu_samples"`
	MemSamples []float32 `json:"mem_samples"`

	// KilledAt holds the Unix timestamp (in milliseconds) when the process was marked killed.
	// A value of 0 indicates the process is still active.
	KilledAt int64 `json:"killed_at"`
}

// -- Internal Tracking Structure --

type ProcessTable struct {
	// processes maps PID to process info.
	processes map[int32]*ProcessInfo

	// mu protects access to processes and lastUpdate.
	mu sync.Mutex

	// ticker drives the periodic polling.
	ticker *time.Ticker
	// quit signals the polling loop to stop.
	quit chan struct{}

	// lastUpdate tracks the wall-clock time of the previous poll.
	lastUpdate time.Time
}

// -- Global Tracker (singleton) --

var (
	tracker   *ProcessTable
	trackerMu sync.Mutex
)

// -- Public API --

// StartTracking starts the polling loop (at 1-second intervals).
func StartTracking() error {
	trackerMu.Lock()
	defer trackerMu.Unlock()
	if tracker != nil {
		return fmt.Errorf("pstrack: tracking already started")
	}

	tracker = &ProcessTable{
		processes:  make(map[int32]*ProcessInfo),
		quit:       make(chan struct{}),
		lastUpdate: time.Time{},
	}
	tracker.ticker = time.NewTicker(PollInterval)
	go tracker.run()
	return nil
}

// StopTracking stops the polling loop and clears all stored data.
func StopTracking() {
	trackerMu.Lock()
	defer trackerMu.Unlock()
	if tracker == nil {
		return
	}
	close(tracker.quit)
	tracker.ticker.Stop()
	tracker.mu.Lock()
	tracker.processes = make(map[int32]*ProcessInfo)
	tracker.lastUpdate = time.Time{}
	tracker.mu.Unlock()
	tracker = nil
}

// CopyData returns a deep copy of all process data, safe for sending to the FE.
func CopyData() map[int32]ProcessInfo {
	trackerMu.Lock()
	defer trackerMu.Unlock()
	if tracker == nil {
		return nil
	}
	return tracker.CopyData()
}

// -- Internal Methods --

// run is the polling loop that updates process info at each tick.
func (pt *ProcessTable) run() {
	for {
		select {
		case <-pt.ticker.C:
			pt.update()
		case <-pt.quit:
			return
		}
	}
}

func CombineAndSortStatus(statuses []string) string {
	sort.Strings(statuses)
	return strings.Join(statuses, "")
}

// update polls the current processes and updates our internal map.
// It also inserts missing-sample sentinels if a gap is detected.
// Additionally, processes that are no longer active are marked as killed,
// and remain in the map for KilledProcessLinger duration before being removed.
func (pt *ProcessTable) update() {
	now := time.Now()
	pt.mu.Lock()
	defer pt.mu.Unlock()

	// Calculate gap since last update.
	var missingCount int
	flushSamples := false
	if pt.lastUpdate.IsZero() {
		missingCount = 0
	} else {
		gap := now.Sub(pt.lastUpdate)
		if gap >= SleepThreshold {
			flushSamples = true
		} else if gap > PollInterval {
			// How many full intervals have been missed (minus the current update).
			missingCount = int(gap/PollInterval) - 1
		}
	}
	pt.lastUpdate = now

	// Get list of current processes.
	procs, err := process.Processes()
	if err != nil {
		// In production, you might want to log this error.
		return
	}

	// Create a set to record which PIDs are active in this poll.
	seenPIDs := make(map[int32]bool)

	for _, p := range procs {
		pid := p.Pid
		seenPIDs[pid] = true

		// Gather process details (ignoring errors for brevity).
		user, _ := p.Username()
		cmd, _ := p.Cmdline()
		cpuPercent, _ := p.CPUPercent()
		memPercent, _ := p.MemoryPercent()
		memInfo, _ := p.MemoryInfo()
		tty, _ := p.Terminal()
		statusArr, _ := p.Status()
		createTime, _ := p.CreateTime() // Unix time in ms.
		times, _ := p.Times()
		cpuTime := int64((times.User + times.System) * 1000)
		status := CombineAndSortStatus(statusArr)

		newProc := &ProcessInfo{
			User:       user,
			PID:        pid,
			CPUPercent: cpuPercent,
			MemPercent: memPercent,
			VSZ:        memInfo.VMS,
			RSS:        int32(memInfo.RSS),
			TTY:        tty,
			Status:     status,
			Started:    createTime,
			CPUTime:    cpuTime,
			Command:    cmd,
		}

		// If the process was seen before, update its samples and check for changes.
		if old, exists := pt.processes[pid]; exists {
			// Check if the process has been replaced (new instance) based on the start time.
			if old.Started != newProc.Started {
				// New process instance; discard the old sample history.
				newProc.UpdatedTs = now.UnixMilli()
				newProc.CPUSamples = []float64{newProc.CPUPercent}
				newProc.MemSamples = []float32{newProc.MemPercent}
				newProc.KilledAt = 0
			} else {
				// Same process instance.
				// Clear killed marker if it was previously set.
				newProc.KilledAt = 0

				changed := (old.User != newProc.User ||
					old.Command != newProc.Command ||
					old.CPUPercent != newProc.CPUPercent ||
					old.MemPercent != newProc.MemPercent ||
					old.VSZ != newProc.VSZ ||
					old.RSS != newProc.RSS ||
					old.TTY != newProc.TTY ||
					old.Status != newProc.Status ||
					old.Started != newProc.Started ||
					old.CPUTime != newProc.CPUTime)
				if changed {
					newProc.UpdatedTs = now.UnixMilli()
				} else {
					newProc.UpdatedTs = old.UpdatedTs
				}

				// Handle sample history.
				if flushSamples {
					newProc.CPUSamples = []float64{newProc.CPUPercent}
					newProc.MemSamples = []float32{newProc.MemPercent}
				} else {
					newSamplesCPU := append([]float64{}, old.CPUSamples...)
					newSamplesMem := append([]float32{}, old.MemSamples...)
					// Insert missing-sample sentinels.
					for i := 0; i < missingCount; i++ {
						newSamplesCPU = append(newSamplesCPU, SentinelNoDataCPU)
						newSamplesMem = append(newSamplesMem, SentinelNoDataMem)
					}
					// Append the current sample.
					newSamplesCPU = append(newSamplesCPU, newProc.CPUPercent)
					newSamplesMem = append(newSamplesMem, newProc.MemPercent)
					// Trim history to the last MaxSamples samples.
					if len(newSamplesCPU) > MaxSamples {
						newSamplesCPU = newSamplesCPU[len(newSamplesCPU)-MaxSamples:]
					}
					if len(newSamplesMem) > MaxSamples {
						newSamplesMem = newSamplesMem[len(newSamplesMem)-MaxSamples:]
					}
					newProc.CPUSamples = newSamplesCPU
					newProc.MemSamples = newSamplesMem
				}
			}
		} else {
			// New process.
			newProc.UpdatedTs = now.UnixMilli()
			newProc.CPUSamples = []float64{newProc.CPUPercent}
			newProc.MemSamples = []float32{newProc.MemPercent}
			newProc.KilledAt = 0
		}
		// Update the map with the new/updated process.
		pt.processes[pid] = newProc
	}

	// Handle processes that were not seen in the current poll.
	for pid, info := range pt.processes {
		if !seenPIDs[pid] {
			if info.KilledAt == 0 {
				// Mark the process as killed.
				info.KilledAt = now.UnixMilli()
				info.UpdatedTs = now.UnixMilli()
			} else {
				// Already marked as killed; check if linger period has expired.
				killedTime := time.UnixMilli(info.KilledAt)
				if now.Sub(killedTime) >= KilledProcessLinger {
					delete(pt.processes, pid)
				}
			}
		}
	}
}

// CopyData returns a deep copy of the processes map.
func (pt *ProcessTable) CopyData() map[int32]ProcessInfo {
	copyMap := make(map[int32]ProcessInfo)
	for pid, info := range pt.processes {
		// Make a shallow copy of the struct.
		copyInfo := *info
		// Deep copy the CPUSamples slice.
		copyInfo.CPUSamples = make([]float64, len(info.CPUSamples))
		copy(copyInfo.CPUSamples, info.CPUSamples)
		// Deep copy the MemSamples slice.
		copyInfo.MemSamples = make([]float32, len(info.MemSamples))
		copy(copyInfo.MemSamples, info.MemSamples)
		copyMap[pid] = copyInfo
	}
	return copyMap
}
