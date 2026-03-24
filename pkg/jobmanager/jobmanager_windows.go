// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package jobmanager

import (
	"fmt"
)

func daemonize(clientId string, jobId string) error {
	return fmt.Errorf("daemonize not supported on windows")
}
