// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package unixutil

import (
	"fmt"
	"os"
)

func GetProcessGroupId(pid int) (int, error) {
	return 0, fmt.Errorf("process group id not supported on windows")
}

func ParseSignal(sigName string) os.Signal {
	return nil
}

func GetSignalName(sig os.Signal) string {
	if sig == nil {
		return ""
	}
	return sig.String()
}

func SetCloseOnExec(fd int) {
}
