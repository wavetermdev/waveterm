// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import "errors"

// ErrNotFound is returned by GetProcInfo when the requested pid does not exist.
var ErrNotFound = errors.New("procinfo: process not found")

// LinuxStatStatus maps the single-character state from /proc/[pid]/stat to a human-readable name.
var LinuxStatStatus = map[string]string{
	"R": "running",
	"S": "sleeping",
	"D": "disk-wait",
	"Z": "zombie",
	"T": "stopped",
	"t": "tracing-stop",
	"W": "paging",
	"X": "dead",
	"x": "dead",
	"K": "wakekill",
	"P": "parked",
	"I": "idle",
}

// ProcInfo holds per-process information read from the OS.
// CpuUser and CpuSys are cumulative CPU seconds since process start;
// callers should diff two samples over a known interval to derive a rate.
// CpuUser, CpuSys, and VmRSS are set to -1 when the data is unavailable
// (e.g. permission denied reading another user's process).
type ProcInfo struct {
	Pid        int32
	Ppid       int32
	Command    string
	Status     string
	CpuUser    float64 // cumulative user CPU seconds; -1 if unavailable
	CpuSys     float64 // cumulative system CPU seconds; -1 if unavailable
	VmRSS      int64   // resident set size in bytes; -1 if unavailable
	Uid        uint32
	NumThreads int32 // -1 if unavailable
}
