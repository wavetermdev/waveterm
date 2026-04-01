// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"context"
	"errors"
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var modpsapi = syscall.NewLazyDLL("psapi.dll")
var procGetProcessMemoryInfo = modpsapi.NewProc("GetProcessMemoryInfo")

// processMemoryCounters mirrors PROCESS_MEMORY_COUNTERS from psapi.h.
type processMemoryCounters struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

// snapInfo holds the data collected in a single pass of CreateToolhelp32Snapshot.
type snapInfo struct {
	ppid       uint32
	numThreads uint32
	exeName    string
}

// windowsSnapshot is the concrete type returned by MakeGlobalSnapshot on Windows.
type windowsSnapshot struct {
	procs map[int32]*snapInfo
}

// MakeGlobalSnapshot enumerates all processes once via CreateToolhelp32Snapshot.
func MakeGlobalSnapshot() (any, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, fmt.Errorf("procinfo: CreateToolhelp32Snapshot: %w", err)
	}
	defer windows.CloseHandle(snap)

	procs := make(map[int32]*snapInfo)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))

	if err := windows.Process32First(snap, &entry); err != nil {
		return nil, fmt.Errorf("procinfo: Process32First: %w", err)
	}
	for {
		pid := int32(entry.ProcessID)
		procs[pid] = &snapInfo{
			ppid:       entry.ParentProcessID,
			numThreads: entry.Threads,
			exeName:    windows.UTF16ToString(entry.ExeFile[:]),
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
				break
			}
			return nil, fmt.Errorf("procinfo: Process32Next: %w", err)
		}
	}

	return &windowsSnapshot{procs: procs}, nil
}

// GetProcInfo returns a ProcInfo for the given pid.
// snap must be a non-nil value returned by MakeGlobalSnapshot.
// Returns nil, nil if the pid is not present in the snapshot.
func GetProcInfo(_ context.Context, snap any, pid int32) (*ProcInfo, error) {
	if snap == nil {
		return nil, fmt.Errorf("procinfo: GetProcInfo requires a snapshot on windows")
	}
	ws, ok := snap.(*windowsSnapshot)
	if !ok {
		return nil, fmt.Errorf("procinfo: invalid snapshot type")
	}
	si, found := ws.procs[pid]
	if !found {
		return nil, ErrNotFound
	}

	info := &ProcInfo{
		Pid:        pid,
		Ppid:       int32(si.ppid),
		NumThreads: int32(si.numThreads),
		Command:    si.exeName,
		CpuUser:    -1,
		CpuSys:     -1,
		VmRSS:      -1,
	}

	handle, err := windows.OpenProcess(
		windows.PROCESS_QUERY_LIMITED_INFORMATION,
		false,
		uint32(pid),
	)
	if err != nil {
		// ERROR_INVALID_PARAMETER means the pid no longer exists.
		if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return nil, ErrNotFound
		}
		return info, nil
	}
	defer windows.CloseHandle(handle)

	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err == nil {
		info.CpuUser = filetimeToSeconds(user)
		info.CpuSys = filetimeToSeconds(kernel)
	}

	var mc processMemoryCounters
	mc.CB = uint32(unsafe.Sizeof(mc))
	r, _, _ := procGetProcessMemoryInfo.Call(
		uintptr(handle),
		uintptr(unsafe.Pointer(&mc)),
		uintptr(mc.CB),
	)
	if r != 0 {
		info.VmRSS = int64(mc.WorkingSetSize)
	}

	return info, nil
}

// filetimeToSeconds converts a FILETIME (100-ns intervals) to cumulative seconds.
func filetimeToSeconds(ft windows.Filetime) float64 {
	ns100 := (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
	return float64(ns100) / 1e7
}
