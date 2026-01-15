// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package jobmanager

import (
	"fmt"
	"os"
)

func getProcessGroupId(pid int) (int, error) {
	return 0, fmt.Errorf("process group id not supported on windows")
}

func normalizeSignal(sigName string) os.Signal {
	return nil
}

func daemonize(clientId string, jobId string) error {
	return fmt.Errorf("daemonize not supported on windows")
}

func setupJobManagerSignalHandlers() {
}
