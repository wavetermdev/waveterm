// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Manage additional options for ephemeral commands (commands that are not saved to the history).
package ephemeral

import (
	"io"
	"sync/atomic"
	"time"
)

const (
	DefaultEphemeralTimeoutMs       = 5000                                         // The default timeout for ephemeral commands in milliseconds.
	DefaultEphemeralTimeoutDuration = DefaultEphemeralTimeoutMs * time.Millisecond // The default timeout for ephemeral commands as a time.Duration.
)

// Options specific to ephemeral commands (commands that are not saved to the history)
type EphemeralRunOpts struct {
	Env             map[string]string `json:"env,omitempty"`         // Environment variables to set for the command.
	OverrideCwd     string            `json:"overridecwd,omitempty"` // A directory to use as the current working directory. Defaults to the last set shell state.
	UsePty          bool              `json:"usepty"`                // If set, the command is run in a pseudo-terminal and all output will be written to the StdoutWriter. If not set, the command is run in a normal shell and the output is written to the StdoutWriter and StderrWriter.
	TimeoutMs       int64             `json:"timeoutms"`             // The maximum time to wait for the command to complete. If the command does not complete within this time, it is killed.
	ExpectsResponse bool              `json:"expectsresponse"`       // If set, the command is expected to return a response. If this is false, ResposeWriter is not set.
	StdoutWriter    io.WriteCloser    `json:"-"`                     // A writer to receive the command's stdout. If not set, the command's output is discarded. (set by remote.go)
	StderrWriter    io.WriteCloser    `json:"-"`                     // A writer to receive the command's stderr. If not set, the command's output is discarded. (set by remote.go)
	Canceled        atomic.Bool       `json:"canceled,omitempty"`    // If set, the command was canceled before it completed.
}
