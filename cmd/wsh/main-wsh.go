// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"github.com/woveterm/wove/cmd/wsh/cmd"
	"github.com/woveterm/wove/pkg/wavebase"
)

// set by main-server.go
var WaveVersion = "0.0.0"
var BuildTime = "0"

func main() {
	wavebase.WaveVersion = WaveVersion
	wavebase.BuildTime = BuildTime
	cmd.Execute()
}
