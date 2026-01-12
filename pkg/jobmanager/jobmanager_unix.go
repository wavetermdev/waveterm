// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package jobmanager

import (
	"os"
	"strings"
	"syscall"
)

func getProcessGroupId(pid int) (int, error) {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return 0, err
	}
	return pgid, nil
}

func normalizeSignal(sigName string) os.Signal {
	sigName = strings.ToUpper(sigName)
	sigName = strings.TrimPrefix(sigName, "SIG")

	switch sigName {
	case "HUP":
		return syscall.SIGHUP
	case "INT":
		return syscall.SIGINT
	case "QUIT":
		return syscall.SIGQUIT
	case "KILL":
		return syscall.SIGKILL
	case "TERM":
		return syscall.SIGTERM
	case "USR1":
		return syscall.SIGUSR1
	case "USR2":
		return syscall.SIGUSR2
	case "STOP":
		return syscall.SIGSTOP
	case "CONT":
		return syscall.SIGCONT
	default:
		return nil
	}
}
