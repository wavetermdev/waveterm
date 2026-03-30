// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// userHz is USER_HZ, the kernel's timer frequency used in /proc/[pid]/stat CPU fields.
// On Linux this is always 100.
const userHz = 100.0

// pageSize is cached at init since it never changes at runtime.
var pageSize int64

func init() {
	pageSize = int64(os.Getpagesize())
	if pageSize <= 0 {
		pageSize = 4096
	}
}

func MakeGlobalSnapshot() (any, error) {
	return nil, nil
}

// GetProcInfo reads process information for the given pid from /proc.
// It reads /proc/[pid]/stat for most fields and /proc/[pid]/status for the UID.
func GetProcInfo(_ context.Context, _ any, pid int32) (*ProcInfo, error) {
	info, err := readStat(pid)
	if err != nil {
		return nil, err
	}
	if uid, err := readUid(pid); err == nil {
		info.Uid = uid
	} else if errors.Is(err, ErrNotFound) {
		return nil, ErrNotFound
	}
	return info, nil
}

// readStat parses /proc/[pid]/stat.
//
// The comm field (field 2) is enclosed in parentheses and may contain spaces
// and even parentheses itself, so we locate the last ')' to find the field
// boundary rather than splitting on whitespace naively.
func readStat(pid int32) (*ProcInfo, error) {
	path := fmt.Sprintf("/proc/%d/stat", pid)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("procinfo: read %s: %w", path, err)
	}
	s := strings.TrimRight(string(data), "\n")

	// Locate comm: everything between first '(' and last ')'.
	lp := strings.Index(s, "(")
	rp := strings.LastIndex(s, ")")
	if lp < 0 || rp < 0 || rp <= lp {
		return nil, fmt.Errorf("procinfo: malformed stat for pid %d", pid)
	}

	pidStr := strings.TrimSpace(s[:lp])
	comm := s[lp+1 : rp]
	rest := strings.Fields(s[rp+1:])

	// rest[0] = field 3 (state), rest[1] = field 4 (ppid), ...
	// Fields after comm are numbered starting at 3, so rest[i] = field (i+3).
	// We need:
	//   rest[0]  = field  3  state
	//   rest[1]  = field  4  ppid
	//   rest[11] = field 14  utime
	//   rest[12] = field 15  stime
	//   rest[17] = field 20  num_threads
	//   rest[21] = field 24  rss (pages)
	if len(rest) < 22 {
		return nil, fmt.Errorf("procinfo: too few fields in stat for pid %d", pid)
	}

	parsedPid, err := strconv.ParseInt(pidStr, 10, 32)
	if err != nil {
		return nil, fmt.Errorf("procinfo: parse pid: %w", err)
	}

	statusChar := rest[0]
	status, ok := LinuxStatStatus[statusChar]
	if !ok {
		status = "unknown"
	}

	info := &ProcInfo{
		Pid:        int32(parsedPid),
		Command:    comm,
		Status:     status,
		CpuUser:    -1,
		CpuSys:     -1,
		VmRSS:      -1,
		NumThreads: -1,
	}

	if ppid, err := strconv.ParseInt(rest[1], 10, 32); err == nil {
		info.Ppid = int32(ppid)
	}
	if utime, err := strconv.ParseUint(rest[11], 10, 64); err == nil {
		info.CpuUser = float64(utime) / userHz
	}
	if stime, err := strconv.ParseUint(rest[12], 10, 64); err == nil {
		info.CpuSys = float64(stime) / userHz
	}
	if numThreads, err := strconv.ParseInt(rest[17], 10, 32); err == nil {
		info.NumThreads = int32(numThreads)
	}
	if rssPages, err := strconv.ParseInt(rest[21], 10, 64); err == nil {
		info.VmRSS = rssPages * pageSize
	}

	return info, nil
}

// readUid reads the real UID from /proc/[pid]/status.
// The Uid line looks like:  Uid:	1000	1000	1000	1000
func readUid(pid int32) (uint32, error) {
	path := fmt.Sprintf("/proc/%d/status", pid)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("procinfo: read %s: %w", path, err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "Uid:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			break
		}
		uid, err := strconv.ParseUint(fields[1], 10, 32)
		if err != nil {
			break
		}
		return uint32(uid), nil
	}
	return 0, fmt.Errorf("procinfo: Uid line not found in %s", path)
}
