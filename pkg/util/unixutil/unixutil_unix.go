// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package unixutil

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

func GetProcessGroupId(pid int) (int, error) {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return 0, err
	}
	return pgid, nil
}

func ParseSignal(sigName string) os.Signal {
	sigName = strings.TrimSpace(sigName)
	sigName = strings.ToUpper(sigName)
	if n, err := strconv.Atoi(sigName); err == nil {
		if n <= 0 {
			return nil
		}
		return syscall.Signal(n)
	}
	if !strings.HasPrefix(sigName, "SIG") {
		sigName = "SIG" + sigName
	}
	sig := unix.SignalNum(sigName)
	if sig == 0 {
		return nil
	}
	return sig
}

func GetSignalName(sig os.Signal) string {
	if sig == nil {
		return ""
	}
	scSig, ok := sig.(syscall.Signal)
	if !ok {
		return sig.String()
	}
	name := unix.SignalName(scSig)
	if name == "" {
		return fmt.Sprintf("%d", int(scSig))
	}
	return name
}

func SetCloseOnExec(fd int) {
	unix.CloseOnExec(fd)
}
