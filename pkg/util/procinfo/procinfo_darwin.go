// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"context"
	"fmt"
	"syscall"

	goproc "github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/unix"
)


// darwinStatStatus maps P_stat from ExternProc to a human-readable name.
// Values from sys/proc.h: SIDL=1, SRUN=2, SSLEEP=3, SSTOP=4, SZOMB=5, SDEAD=6.
var darwinStatStatus = map[int8]string{
	1: "idle",
	2: "running",
	3: "sleeping",
	4: "stopped",
	5: "zombie",
	6: "dead",
}

func MakeGlobalSnapshot() (any, error) {
	return nil, nil
}

// GetProcInfo reads process information for the given pid.
// Core fields come from kern.proc.pid sysctl; VmRSS and NumThreads are
// fetched via gopsutil (which uses proc_pidinfo internally).
func GetProcInfo(ctx context.Context, _ any, pid int32) (*ProcInfo, error) {
	k, err := unix.SysctlKinfoProc("kern.proc.pid", int(pid))
	if err != nil {
		if err == syscall.ESRCH {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("procinfo: SysctlKinfoProc pid %d: %w", pid, err)
	}

	status, ok := darwinStatStatus[k.Proc.P_stat]
	if !ok {
		status = "unknown"
	}

	// P_uticks and P_sticks are cumulative user/system time in microseconds.
	cpuUser := float64(k.Proc.P_uticks) / 1e6
	cpuSys := float64(k.Proc.P_sticks) / 1e6

	info := &ProcInfo{
		Pid:     int32(k.Proc.P_pid),
		Ppid:    k.Eproc.Ppid,
		Command: unix.ByteSliceToString(k.Proc.P_comm[:]),
		Status:  status,
		CpuUser: cpuUser,
		CpuSys:  cpuSys,
		Uid:     k.Eproc.Ucred.Uid,
	}

	if p, err := goproc.NewProcessWithContext(ctx, pid); err == nil {
		if mi, err := p.MemoryInfoWithContext(ctx); err == nil {
			info.VmRSS = mi.RSS
		}
		if nt, err := p.NumThreadsWithContext(ctx); err == nil {
			info.NumThreads = nt
		}
	}

	return info, nil
}
