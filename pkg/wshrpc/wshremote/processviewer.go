// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"fmt"
	"os/user"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	goproc "github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/procinfo"
	"github.com/wavetermdev/waveterm/pkg/util/unixutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	ProcCacheIdleTimeout  = 10 * time.Second
	ProcCachePollInterval = 1 * time.Second
)

// cpuSample records a single CPU time measurement for a process.
type cpuSample struct {
	CPUSec    float64   // user+system cpu seconds at sample time
	SampledAt time.Time // when the sample was taken
	Epoch     int       // epoch at which this sample was recorded
}

// procCacheState is the singleton background cache for process list data.
// lastCPUSamples, lastCPUEpoch, and uidCache are only accessed by the single runLoop goroutine.
type procCacheState struct {
	lock        sync.Mutex
	cached      *wshrpc.ProcessListResponse
	lastRequest time.Time
	running     bool
	// ready is closed when the first result is placed in cache; set to nil after close.
	ready chan struct{}

	lastCPUSamples map[int32]cpuSample
	lastCPUEpoch   int
	uidCache       map[uint32]string // uid -> username, populated lazily
}

// procCache is the singleton background cache for process list data.
var procCache = &procCacheState{}

// requestAndWait marks the cache as recently requested and returns the current cached
// result. If the background goroutine is not running it starts it and waits for the
// first populate before returning.
func (s *procCacheState) requestAndWait(ctx context.Context) (*wshrpc.ProcessListResponse, error) {
	s.lock.Lock()
	s.lastRequest = time.Now()
	if !s.running {
		s.running = true
		readyCh := make(chan struct{})
		s.ready = readyCh
		go s.runLoop(readyCh)
	}
	readyCh := s.ready
	s.lock.Unlock()

	if readyCh != nil {
		select {
		case <-readyCh:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	s.lock.Lock()
	result := s.cached
	s.lock.Unlock()

	if result == nil {
		return nil, fmt.Errorf("process list unavailable")
	}
	return result, nil
}

func (s *procCacheState) runLoop(firstReadyCh chan struct{}) {
	defer func() {
		panichandler.PanicHandler("procCache.runLoop", recover())
	}()

	numCPU := runtime.NumCPU()
	if numCPU < 1 {
		numCPU = 1
	}

	firstDone := false

	for {
		iterStart := time.Now()

		s.lastCPUEpoch++
		result := s.collectSnapshot(numCPU)

		// Remove stale entries (pids that weren't seen this epoch).
		for pid, sample := range s.lastCPUSamples {
			if sample.Epoch < s.lastCPUEpoch {
				delete(s.lastCPUSamples, pid)
			}
		}

		s.lock.Lock()
		s.cached = result
		idleFor := time.Since(s.lastRequest)
		if !firstDone {
			firstDone = true
			close(firstReadyCh)
			s.ready = nil
		}
		if idleFor >= ProcCacheIdleTimeout {
			s.cached = nil
			s.running = false
			s.lastCPUSamples = nil
			s.lastCPUEpoch = 0
			s.uidCache = nil
			s.lock.Unlock()
			return
		}
		s.lock.Unlock()

		elapsed := time.Since(iterStart)
		if sleep := ProcCachePollInterval - elapsed; sleep > 0 {
			time.Sleep(sleep)
		}
	}
}

// lookupUID resolves a uid to a username, using the per-run cache to avoid
// repeated syscalls for the same uid.
func (s *procCacheState) lookupUID(uid uint32) string {
	if s.uidCache == nil {
		s.uidCache = make(map[uint32]string)
	}
	if name, ok := s.uidCache[uid]; ok {
		return name
	}
	u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		s.uidCache[uid] = ""
		return ""
	}
	name := u.Username
	s.uidCache[uid] = name
	return name
}

// collectSnapshot fetches all process info, updates lastCPUSamples with fresh measurements,
// and computes CPU% using each pid's previous sample (if available).
func (s *procCacheState) collectSnapshot(numCPU int) *wshrpc.ProcessListResponse {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	procs, err := goproc.ProcessesWithContext(ctx)
	if err != nil {
		return nil
	}

	if s.lastCPUSamples == nil {
		s.lastCPUSamples = make(map[int32]cpuSample, len(procs))
	}

	snap, _ := procinfo.MakeGlobalSnapshot()

	hasCPU := s.lastCPUEpoch > 1 // first epoch has no previous sample to diff against

	// Build per-pid procinfo in parallel, then compute CPU% sequentially.
	type pidInfo struct {
		pid  int32
		info *procinfo.ProcInfo
	}
	rawInfos := make([]pidInfo, len(procs))
	var wg sync.WaitGroup
	for i, p := range procs {
		i, p := i, p
		wg.Add(1)
		go func() {
			defer func() {
				panichandler.PanicHandler("collectSnapshot:GetProcInfo", recover())
				wg.Done()
			}()
			pi, err := procinfo.GetProcInfo(ctx, snap, p.Pid)
			if err != nil {
				pi = nil
			}
			rawInfos[i] = pidInfo{pid: p.Pid, info: pi}
		}()
	}
	wg.Wait()

	// Sample CPU times and compute CPU% sequentially to keep epoch accounting simple.
	cpuPcts := make(map[int32]float64, len(procs))
	sampleTime := time.Now()
	for _, ri := range rawInfos {
		if ri.info == nil {
			continue
		}
		curCPUSec := ri.info.CpuUser + ri.info.CpuSys

		if hasCPU {
			if prev, ok := s.lastCPUSamples[ri.pid]; ok {
				elapsed := sampleTime.Sub(prev.SampledAt).Seconds()
				if elapsed > 0 {
					cpuPcts[ri.pid] = computeCPUPct(prev.CPUSec, curCPUSec, elapsed)
				}
			}
		}

		s.lastCPUSamples[ri.pid] = cpuSample{
			CPUSec:    curCPUSec,
			SampledAt: sampleTime,
			Epoch:     s.lastCPUEpoch,
		}
	}

	// Compute total memory for MemPct.
	var totalMem uint64
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		totalMem = vm.Total
	}

	var cpuSum float64
	infos := make([]wshrpc.ProcessInfo, 0, len(rawInfos))
	for _, ri := range rawInfos {
		if ri.info == nil {
			continue
		}
		pi := ri.info
		info := wshrpc.ProcessInfo{
			Pid:        pi.Pid,
			Ppid:       pi.Ppid,
			Command:    pi.Command,
			Status:     pi.Status,
			Mem:        pi.VmRSS,
			NumThreads: pi.NumThreads,
			User:       s.lookupUID(pi.Uid),
		}
		if totalMem > 0 {
			info.MemPct = float64(pi.VmRSS) / float64(totalMem) * 100
		}
		if hasCPU {
			if cpu, ok := cpuPcts[pi.Pid]; ok {
				v := cpu
				info.Cpu = &v
				cpuSum += cpu
			}
		}
		infos = append(infos, info)
	}

	summaryCh := make(chan wshrpc.ProcessSummary, 1)
	go func() {
		defer func() {
			if err := panichandler.PanicHandler("buildProcessSummary", recover()); err != nil {
				summaryCh <- wshrpc.ProcessSummary{Total: len(procs)}
			}
		}()
		summaryCh <- buildProcessSummary(ctx, len(procs), numCPU, cpuSum)
	}()
	summary := <-summaryCh

	return &wshrpc.ProcessListResponse{
		Processes: infos,
		Summary:   summary,
		Ts:        time.Now().UnixMilli(),
		HasCPU:    hasCPU,
		IsWindows: runtime.GOOS == "windows",
	}
}

func computeCPUPct(t1, t2, elapsedSec float64) float64 {
	delta := (t2 - t1) / elapsedSec * 100
	if delta < 0 {
		delta = 0
	}
	return delta
}

func buildProcessSummary(ctx context.Context, total int, numCPU int, cpuSum float64) wshrpc.ProcessSummary {
	summary := wshrpc.ProcessSummary{Total: total, NumCPU: numCPU, CpuSum: cpuSum}
	if avg, err := load.AvgWithContext(ctx); err == nil {
		summary.Load1 = avg.Load1
		summary.Load5 = avg.Load5
		summary.Load15 = avg.Load15
	}
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		summary.MemTotal = vm.Total
		summary.MemUsed = vm.Used
		summary.MemFree = vm.Free
	}
	return summary
}

func filterProcesses(processes []wshrpc.ProcessInfo, textSearch string) []wshrpc.ProcessInfo {
	if textSearch == "" {
		return processes
	}
	search := strings.ToLower(textSearch)
	filtered := processes[:0]
	for _, p := range processes {
		pidStr := strconv.Itoa(int(p.Pid))
		if strings.Contains(strings.ToLower(p.Command), search) ||
			strings.Contains(strings.ToLower(p.Status), search) ||
			strings.Contains(strings.ToLower(p.User), search) ||
			strings.Contains(pidStr, search) {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

func sortAndLimitProcesses(processes []wshrpc.ProcessInfo, sortBy string, sortDesc bool, start int, limit int) []wshrpc.ProcessInfo {
	switch sortBy {
	case "cpu":
		sort.Slice(processes, func(i, j int) bool {
			ci, cj := 0.0, 0.0
			if processes[i].Cpu != nil {
				ci = *processes[i].Cpu
			}
			if processes[j].Cpu != nil {
				cj = *processes[j].Cpu
			}
			if sortDesc {
				return ci > cj
			}
			return ci < cj
		})
	case "mem":
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].Mem > processes[j].Mem
			}
			return processes[i].Mem < processes[j].Mem
		})
	case "command":
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].Command > processes[j].Command
			}
			return processes[i].Command < processes[j].Command
		})
	case "user":
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].User > processes[j].User
			}
			return processes[i].User < processes[j].User
		})
	case "status":
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].Status > processes[j].Status
			}
			return processes[i].Status < processes[j].Status
		})
	case "threads":
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].NumThreads > processes[j].NumThreads
			}
			return processes[i].NumThreads < processes[j].NumThreads
		})
	default: // "pid"
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].Pid > processes[j].Pid
			}
			return processes[i].Pid < processes[j].Pid
		})
	}
	if start > 0 {
		if start >= len(processes) {
			return nil
		}
		processes = processes[start:]
	}
	if limit > 0 && len(processes) > limit {
		processes = processes[:limit]
	}
	return processes
}

func (impl *ServerImpl) RemoteProcessListCommand(ctx context.Context, data wshrpc.CommandRemoteProcessListData) (*wshrpc.ProcessListResponse, error) {
	raw, err := procCache.requestAndWait(ctx)
	if err != nil {
		return nil, err
	}

	// Pids overrides all other request fields; when set we skip sort/limit/start/textsearch
	// and return only the exact pids requested.
	if len(data.Pids) > 0 {
		pidSet := make(map[int32]struct{}, len(data.Pids))
		for _, pid := range data.Pids {
			pidSet[pid] = struct{}{}
		}
		processes := make([]wshrpc.ProcessInfo, 0, len(data.Pids))
		for _, p := range raw.Processes {
			if _, ok := pidSet[p.Pid]; ok {
				processes = append(processes, p)
			}
		}
		return &wshrpc.ProcessListResponse{
			Processes: processes,
			Summary:   raw.Summary,
			Ts:        raw.Ts,
			HasCPU:    raw.HasCPU,
			IsWindows: raw.IsWindows,
		}, nil
	}

	sortBy := data.SortBy
	if sortBy == "" {
		sortBy = "cpu"
	}
	limit := data.Limit
	if limit <= 0 || limit > 500 {
		limit = 50
	}

	totalCount := len(raw.Processes)

	// Copy processes so we can sort/limit without mutating the cache.
	processes := make([]wshrpc.ProcessInfo, len(raw.Processes))
	copy(processes, raw.Processes)
	processes = filterProcesses(processes, data.TextSearch)
	filteredCount := len(processes)
	processes = sortAndLimitProcesses(processes, sortBy, data.SortDesc, data.Start, limit)

	return &wshrpc.ProcessListResponse{
		Processes:     processes,
		Summary:       raw.Summary,
		Ts:            raw.Ts,
		HasCPU:        raw.HasCPU,
		IsWindows:     raw.IsWindows,
		TotalCount:    totalCount,
		FilteredCount: filteredCount,
	}, nil
}

func (impl *ServerImpl) RemoteProcessSignalCommand(ctx context.Context, data wshrpc.CommandRemoteProcessSignalData) error {
	return unixutil.SendSignalByName(int(data.Pid), data.Signal)
}
