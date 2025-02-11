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
)

// -- Process Data Structure --

// ProcessInfo holds the process details for a "ps"-like display.
// Note: Started and CPUTime are now stored as int64 values (Unix ms).
// Status is stored as []string.
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

// trackerMu guards access to the singleton tracker instance.
var (
	tracker   *ProcessTable
	trackerMu sync.Mutex
)

// -- Public API --

// StartTracking starts the polling loop (at 1-second intervals).
// It returns an error if tracking is already running.
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
// It also inserts missing-sample sentinels if a gap (e.g., due to sleep)
// is detected. If the gap exceeds SleepThreshold, the history is flushed.
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

	// Build a new map for updated processes.
	newMap := make(map[int32]*ProcessInfo)
	for _, p := range procs {
		pid := p.Pid

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
				// Too long a gap: flush the history.
				newProc.CPUSamples = []float64{newProc.CPUPercent}
				newProc.MemSamples = []float32{newProc.MemPercent}
			} else {
				// Copy old samples.
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
		} else {
			// For new processes, start the sample arrays.
			newProc.UpdatedTs = now.UnixMilli()
			newProc.CPUSamples = []float64{newProc.CPUPercent}
			newProc.MemSamples = []float32{newProc.MemPercent}
		}
		newMap[pid] = newProc
	}

	// Replace the internal map with the updated one.
	pt.processes = newMap
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

// stringSliceEqual compares two slices of strings for equality.
func stringSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i, v := range a {
		if v != b[i] {
			return false
		}
	}
	return true
}
