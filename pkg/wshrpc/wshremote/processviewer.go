// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"fmt"
	"os"
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
	ProcCacheIdleTimeout  = 60 * time.Second
	ProcCachePollInterval = 1 * time.Second
	ProcViewerMaxLimit    = 500
)

// cpuSample records a single CPU time measurement for a process.
type cpuSample struct {
	CPUSec    float64   // user+system cpu seconds at sample time
	SampledAt time.Time // when the sample was taken
	Epoch     int       // epoch at which this sample was recorded
}

// widgetPidOrder stores the ordered pid list from the last non-LastPidOrder request for a widget.
type widgetPidOrder struct {
	pids        []int32
	totalCount  int
	lastRequest time.Time
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

	widgetPidOrders map[string]*widgetPidOrder // keyed by widgetId
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

func (s *procCacheState) touchLastRequest() {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.lastRequest = time.Now()
}

func (s *procCacheState) touchWidgetPidOrder(widgetId string) {
	if widgetId == "" {
		return
	}
	s.lock.Lock()
	defer s.lock.Unlock()
	s.lastRequest = time.Now()
	if s.widgetPidOrders != nil {
		if entry, ok := s.widgetPidOrders[widgetId]; ok {
			entry.lastRequest = time.Now()
		}
	}
}

func (s *procCacheState) storeWidgetPidOrder(widgetId string, pids []int32, totalCount int) {
	if widgetId == "" {
		return
	}
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.widgetPidOrders == nil {
		s.widgetPidOrders = make(map[string]*widgetPidOrder)
	}
	s.widgetPidOrders[widgetId] = &widgetPidOrder{
		pids:        pids,
		totalCount:  totalCount,
		lastRequest: time.Now(),
	}
}

func (s *procCacheState) getWidgetPidOrder(widgetId string) ([]int32, int) {
	if widgetId == "" {
		return nil, 0
	}
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.widgetPidOrders == nil {
		return nil, 0
	}
	entry, ok := s.widgetPidOrders[widgetId]
	if !ok {
		return nil, 0
	}
	if time.Since(entry.lastRequest) >= ProcCacheIdleTimeout {
		delete(s.widgetPidOrders, widgetId)
		return nil, 0
	}
	return entry.pids, entry.totalCount
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
			s.widgetPidOrders = nil
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
		if ri.info.CpuUser < 0 || ri.info.CpuSys < 0 {
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
			MemPct:     -1,
			Cpu:        -1,
			NumThreads: pi.NumThreads,
			User:       s.lookupUID(pi.Uid),
		}
		if totalMem > 0 && pi.VmRSS >= 0 {
			info.MemPct = float64(pi.VmRSS) / float64(totalMem) * 100
		}
		if hasCPU {
			if cpu, ok := cpuPcts[pi.Pid]; ok {
				info.Cpu = cpu
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
		Platform:  runtime.GOOS,
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

func sortProcesses(processes []wshrpc.ProcessInfo, sortBy string, sortDesc bool) {
	switch sortBy {
	case "cpu":
		sort.Slice(processes, func(i, j int) bool {
			ci := processes[i].Cpu
			cj := processes[j].Cpu
			iNull := ci < 0
			jNull := cj < 0
			if iNull != jNull {
				return !iNull
			}
			if !iNull && ci != cj {
				if sortDesc {
					return ci > cj
				}
				return ci < cj
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "mem":
		sort.Slice(processes, func(i, j int) bool {
			mi := processes[i].Mem
			mj := processes[j].Mem
			iNull := mi < 0
			jNull := mj < 0
			if iNull != jNull {
				return !iNull
			}
			if !iNull && mi != mj {
				if sortDesc {
					return mi > mj
				}
				return mi < mj
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "command":
		sort.Slice(processes, func(i, j int) bool {
			if processes[i].Command != processes[j].Command {
				if sortDesc {
					return processes[i].Command > processes[j].Command
				}
				return processes[i].Command < processes[j].Command
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "user":
		sort.Slice(processes, func(i, j int) bool {
			if processes[i].User != processes[j].User {
				if sortDesc {
					return processes[i].User > processes[j].User
				}
				return processes[i].User < processes[j].User
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "status":
		sort.Slice(processes, func(i, j int) bool {
			if processes[i].Status != processes[j].Status {
				if sortDesc {
					return processes[i].Status > processes[j].Status
				}
				return processes[i].Status < processes[j].Status
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "threads":
		sort.Slice(processes, func(i, j int) bool {
			ti := processes[i].NumThreads
			tj := processes[j].NumThreads
			iNull := ti < 0
			jNull := tj < 0
			if iNull != jNull {
				return !iNull
			}
			if !iNull && ti != tj {
				if sortDesc {
					return ti > tj
				}
				return ti < tj
			}
			return processes[i].Pid < processes[j].Pid
		})
	default: // "pid"
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].Pid > processes[j].Pid
			}
			return processes[i].Pid < processes[j].Pid
		})
	}
}

func (impl *ServerImpl) RemoteProcessListCommand(ctx context.Context, data wshrpc.CommandRemoteProcessListData) (*wshrpc.ProcessListResponse, error) {
	if data.KeepAlive {
		if data.WidgetId != "" {
			procCache.touchWidgetPidOrder(data.WidgetId)
		} else {
			procCache.touchLastRequest()
		}
		return nil, nil
	}

	raw, err := procCache.requestAndWait(ctx)
	if err != nil {
		return nil, err
	}

	totalCount := len(raw.Processes)

	// Phase 1: derive the pid order.
	// Use cached order if LastPidOrder is set and a cached order exists; otherwise filter/sort and store.
	var pidOrder []int32
	var filteredCount int
	if data.LastPidOrder {
		var cachedTotal int
		pidOrder, cachedTotal = procCache.getWidgetPidOrder(data.WidgetId)
		if pidOrder != nil {
			filteredCount = len(pidOrder)
			totalCount = cachedTotal
		}
	}
	if pidOrder == nil {
		sortBy := data.SortBy
		sortDesc := data.SortDesc
		if sortBy == "" {
			sortBy = "cpu"
			sortDesc = true
		}
		procs := make([]wshrpc.ProcessInfo, len(raw.Processes))
		copy(procs, raw.Processes)
		procs = filterProcesses(procs, data.TextSearch)
		filteredCount = len(procs)
		sortProcesses(procs, sortBy, sortDesc)
		pidOrder = make([]int32, len(procs))
		for i, p := range procs {
			pidOrder[i] = p.Pid
		}
		if data.WidgetId != "" {
			procCache.storeWidgetPidOrder(data.WidgetId, pidOrder, totalCount)
		}
	}

	// Phase 2: limit and populate process info from the pid order.
	limit := data.Limit
	if limit <= 0 || limit > ProcViewerMaxLimit {
		limit = ProcViewerMaxLimit
	}
	pidMap := make(map[int32]wshrpc.ProcessInfo, len(raw.Processes))
	for _, p := range raw.Processes {
		pidMap[p.Pid] = p
	}
	start := data.Start
	if start >= len(pidOrder) {
		start = len(pidOrder)
	}
	window := pidOrder[start:]
	if limit > 0 && len(window) > limit {
		window = window[:limit]
	}
	processes := make([]wshrpc.ProcessInfo, 0, len(window))
	for _, pid := range window {
		if p, ok := pidMap[pid]; ok {
			processes = append(processes, p)
		} else {
			processes = append(processes, wshrpc.ProcessInfo{Pid: pid, Gone: true})
		}
	}

	return &wshrpc.ProcessListResponse{
		Processes:     processes,
		Summary:       raw.Summary,
		Ts:            raw.Ts,
		HasCPU:        raw.HasCPU,
		Platform:      raw.Platform,
		TotalCount:    totalCount,
		FilteredCount: filteredCount,
	}, nil
}

func (impl *ServerImpl) RemoteProcessSignalCommand(ctx context.Context, data wshrpc.CommandRemoteProcessSignalData) error {
	if runtime.GOOS == "windows" {
		// special case handling for windows. SIGTERM is mapped to "Kill Process" context menu so will do a proc.Kill() on windows
		proc, err := os.FindProcess(int(data.Pid))
		if err != nil {
			return fmt.Errorf("process %d not found: %w", data.Pid, err)
		}
		sig := strings.ToUpper(data.Signal)
		if sig == "SIGINT" {
			return proc.Signal(os.Interrupt)
		}
		if sig == "SIGTERM" || sig == "SIGKILL" {
			return proc.Kill()
		}
		return fmt.Errorf("signal %q is not supported on Windows", data.Signal)
	}
	return unixutil.SendSignalByName(int(data.Pid), data.Signal)
}
