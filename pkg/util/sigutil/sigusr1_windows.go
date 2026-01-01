//go:build windows

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sigutil

import "io"

func InstallSIGUSR1Handler(w io.Writer) {
	// do nothing
}
