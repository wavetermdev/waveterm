// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	runWaitPollInterval   = 200 * time.Millisecond
	runWaitDefaultTimeout = 5 * time.Minute
	runWaitOutputSettle   = 2 * time.Second
)

// runJSONOutput is the machine-readable result of `wsh run --wait --json`.
type runJSONOutput struct {
	Stdout       string `json:"stdout"`
	Stderr       string `json:"stderr"`
	ExitCode     int    `json:"exitcode"`
	DurationMs   int64  `json:"durationms"`
	BlockId      string `json:"blockid,omitempty"`
	OutputMerged bool   `json:"outputmerged"`
}

// waitForRunBlock blocks until the spawned cmd block completes, then prints its
// output (and exit code/duration) either as a JSON object (--json) or as a
// human-readable summary.
func waitForRunBlock(blockId, connName string, jsonOut bool, timeout time.Duration) error {
	startTime := time.Now()

	// Best-effort pre-flight check: a non-local connection that is definitively
	// down yields an immediate, clear error instead of hanging until the poll
	// timeout. A connection that is connected, or one that has never been
	// attempted, is left to the frontend's on-mount ConnEnsure.
	if err := checkConnectionForWait(connName); err != nil {
		return err
	}

	exitCode, err := pollForBlockExit(blockId, timeout)
	if err != nil {
		return err
	}
	durationMs := time.Since(startTime).Milliseconds()

	rawOutput, err := readRunOutput(blockId, exitCode)
	if err != nil {
		return err
	}
	stdout := cleanCmdOutput(rawOutput, exitCode)

	if jsonOut {
		out := runJSONOutput{
			Stdout:       stdout,
			Stderr:       "",
			ExitCode:     exitCode,
			DurationMs:   durationMs,
			BlockId:      blockId,
			OutputMerged: true,
		}
		outBytes, err := json.Marshal(out)
		if err != nil {
			return fmt.Errorf("marshaling JSON output: %w", err)
		}
		WriteStdout("%s\n", string(outBytes))
		return nil
	}

	WriteStdout("exit code: %d\n", exitCode)
	WriteStdout("duration: %dms\n", durationMs)
	if stdout != "" {
		WriteStdout("%s", stdout)
		if !strings.HasSuffix(stdout, "\n") {
			WriteStdout("\n")
		}
	}
	return nil
}

// pollForBlockExit polls the block controller status until the cmd block reports
// ShellProcStatus == "done", then returns its exit code.
func pollForBlockExit(blockId string, timeout time.Duration) (int, error) {
	if timeout <= 0 {
		timeout = runWaitDefaultTimeout
	}
	deadline := time.Now().Add(timeout)
	for {
		status, err := wshclient.BlockControllerStatusCommand(RpcClient, blockId, &wshrpc.RpcOpts{Timeout: 2000})
		if err == nil && status != nil && status.ShellProcStatus == "done" {
			return status.ShellProcExitCode, nil
		}
		if time.Now().After(deadline) {
			lastStatus := "unknown"
			if status != nil {
				lastStatus = status.ShellProcStatus
			}
			return 0, runWaitTimeoutError(blockId, lastStatus)
		}
		time.Sleep(runWaitPollInterval)
	}
}

func runWaitTimeoutError(blockId, lastStatus string) error {
	return fmt.Errorf("timed out waiting for command to complete in block %s (last block status: %s)", blockId, lastStatus)
}

// readRunOutput reads the block term file, polling briefly until the synthetic
// "process finished with exit code = N" trailer appears (or the settle timeout
// elapses). Waiting for the trailer avoids reading the term file before the pty
// read loop has flushed the final output bytes and appended the trailer.
func readRunOutput(blockId string, exitCode int) (string, error) {
	deadline := time.Now().Add(runWaitOutputSettle)
	var lastContent string
	for {
		content, err := wshclient.BlockReadTermFileCommand(RpcClient, blockId, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			return "", fmt.Errorf("reading command output: %w", err)
		}
		lastContent = content
		if strings.Contains(content, trailerMarker(exitCode)) {
			break
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	return lastContent, nil
}

// checkConnectionForWait performs a best-effort reachability check for a
// non-local connection before blocking on --wait. If the connection is present
// in the status list and not connected, return a clear error. If it is not
// present (never attempted), the frontend's on-mount ConnEnsure will handle it.
func checkConnectionForWait(connName string) error {
	if !isNonLocalConnName(connName) {
		return nil
	}
	connStatuses, err := wshclient.ConnStatusCommand(RpcClient, nil)
	if err != nil {
		return fmt.Errorf("checking connection status: %w", err)
	}
	for _, cs := range connStatuses {
		if cs.Connection == connName {
			if cs.Connected {
				return nil
			}
			return fmt.Errorf("connection %q is not connected (status: %s)", connName, cs.Status)
		}
	}
	return nil
}

// isNonLocalConnName reports whether connName refers to an SSH connection
// (matching conncontroller.IsLocalConnName/IsWslConnName, which the CLI avoids
// importing to stay a thin client).
func isNonLocalConnName(connName string) bool {
	if connName == "" || connName == "local" {
		return false
	}
	if strings.HasPrefix(connName, "local:") || strings.HasPrefix(connName, "wsl://") {
		return false
	}
	return true
}

var (
	// ansiRegexp matches CSI sequences (ESC [ params intermediates final, where
	// final is @-~). This covers SGR colors, cursor movement, and the terminal
	// reset sequence appended by the shell controller.
	ansiRegexp = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
	// oscRegexp matches OSC sequences (ESC ] ... BEL/ST), e.g. window-title
	// updates emitted by some shells.
	oscRegexp = regexp.MustCompile(`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)
	// mutedMsgRegexp removes the synthetic "[... - press enter to close]" line the
	// shell controller appends after a cmd block exits.
	mutedMsgRegexp = regexp.MustCompile(`(?m)^[^\r\n]*press enter to close[^\r\n]*\r?\n?`)
)

// trailerMarker returns the exact synthetic trailer the shell controller appends
// to the term file when a cmd block exits (see pkg/blockcontroller/shellcontroller.go).
func trailerMarker(exitCode int) string {
	return fmt.Sprintf("\r\nprocess finished with exit code = %d\r\n\r\n", exitCode)
}

// cleanCmdOutput turns raw block term-file content into clean command output:
// strips ANSI escape sequences, the synthetic exit trailer, and the muted
// "[... - press enter to close]" line, then trims trailing newlines.
func cleanCmdOutput(raw string, exitCode int) string {
	out := ansiRegexp.ReplaceAllString(raw, "")
	out = oscRegexp.ReplaceAllString(out, "")
	out = mutedMsgRegexp.ReplaceAllString(out, "")
	out = stripCmdTrailer(out, exitCode)
	return strings.TrimRight(out, "\r\n")
}

// stripCmdTrailer removes the synthetic exit trailer (and anything after it)
// using the exact trailer string for the known exit code. If the trailer is not
// present (e.g. the settle timeout expired before it was flushed), the output is
// returned unchanged.
func stripCmdTrailer(out string, exitCode int) string {
	if idx := strings.Index(out, trailerMarker(exitCode)); idx >= 0 {
		return out[:idx]
	}
	return out
}
