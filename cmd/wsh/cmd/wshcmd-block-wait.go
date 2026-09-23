// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	blockWaitPollInterval   = 200 * time.Millisecond
	blockWaitDefaultTimeout = 60 * time.Second
)

var blockWaitCmd = &cobra.Command{
	Use:   "wait <block_ref>",
	Short: "Wait until a block meets a condition",
	Long: `Wait until a terminal block meets a condition.

Exactly one of --until-exit, --contains, or --idle is required.

  --until-exit     succeed when the block process has exited
  --contains STR   succeed when the scrollback contains STR
  --idle MS        succeed when LastUpdated is unchanged for MS milliseconds

--timeout defaults to 60s. On timeout, the command errors and includes the
last observed status.`,
	Args:                  cobra.MaximumNArgs(1),
	RunE:                  blockWaitRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	blockWaitUntilExit bool
	blockWaitContains  string
	blockWaitIdleMs    int
	blockWaitTimeout   string
	blockWaitJSON      bool
)

func init() {
	blockWaitCmd.Flags().BoolVar(&blockWaitUntilExit, "until-exit", false, "wait until the block process exits")
	blockWaitCmd.Flags().StringVar(&blockWaitContains, "contains", "", "wait until scrollback contains the substring")
	blockWaitCmd.Flags().IntVar(&blockWaitIdleMs, "idle", 0, "wait until scrollback is idle for this many milliseconds")
	blockWaitCmd.Flags().StringVar(&blockWaitTimeout, "timeout", "", "maximum time to wait (default 60s)")
	blockWaitCmd.Flags().BoolVar(&blockWaitJSON, "json", false, "output as JSON")
	blockCmd.AddCommand(blockWaitCmd)
}

// blockWaitJSONOutput is the structured output for `block wait --json`.
type blockWaitJSONOutput struct {
	OK        bool   `json:"ok"`
	Reason    string `json:"reason"`
	ElapsedMs int64  `json:"elapsedms"`
}

// waitCondition is the exclusive wait mode: "exit", "contains", or "idle".
type waitCondition struct {
	Reason   string
	Contains string
	IdleMs   int
}

// validateWaitFlags enforces that exactly one of --until-exit / --contains /
// --idle is set, and that --idle is a positive millisecond count when used.
func validateWaitFlags(untilExit bool, contains string, idleSet bool, idleMs int) error {
	n := 0
	if untilExit {
		n++
	}
	if contains != "" {
		n++
	}
	if idleSet {
		n++
	}
	if n != 1 {
		return fmt.Errorf("exactly one of --until-exit, --contains, or --idle is required")
	}
	if idleSet && idleMs <= 0 {
		return fmt.Errorf("--idle must be a positive number of milliseconds")
	}
	return nil
}

func blockWaitRun(cmd *cobra.Command, args []string) error {
	idleSet := cmd.Flags().Changed("idle")
	if err := validateWaitFlags(blockWaitUntilExit, blockWaitContains, idleSet, blockWaitIdleMs); err != nil {
		return err
	}
	timeout, err := parseDurationFlag(blockWaitTimeout, blockWaitDefaultTimeout)
	if err != nil {
		return fmt.Errorf("invalid --timeout: %w", err)
	}

	blockRef := ""
	if len(args) > 0 {
		blockRef = args[0]
	}

	var blockId string
	if blockWaitUntilExit {
		fullORef, err := resolveBlockArgWithOverride(blockRef)
		if err != nil {
			return err
		}
		blockId = fullORef.OID
	} else {
		fullORef, _, err := getTermBlockMeta(blockRef)
		if err != nil {
			return err
		}
		blockId = fullORef.OID
	}

	cond := waitCondition{}
	switch {
	case blockWaitUntilExit:
		cond.Reason = "exit"
	case blockWaitContains != "":
		cond.Reason = "contains"
		cond.Contains = blockWaitContains
	default:
		cond.Reason = "idle"
		cond.IdleMs = blockWaitIdleMs
	}

	start := time.Now()
	if err := waitForBlockCondition(blockId, cond, timeout); err != nil {
		return err
	}
	elapsedMs := time.Since(start).Milliseconds()

	if blockWaitJSON {
		outBytes, err := json.Marshal(blockWaitJSONOutput{
			OK:        true,
			Reason:    cond.Reason,
			ElapsedMs: elapsedMs,
		})
		if err != nil {
			return fmt.Errorf("marshaling JSON output: %w", err)
		}
		WriteStdout("%s\n", string(outBytes))
		return nil
	}
	WriteStdout("waited %dms (%s)\n", elapsedMs, cond.Reason)
	return nil
}

// waitForBlockCondition polls every 200ms until cond is met or timeout.
func waitForBlockCondition(blockId string, cond waitCondition, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	lastStatus := "unknown"
	idleSince := time.Time{}
	prevLastUpdated := int64(-1)

	for {
		met, status, err := pollWaitCondition(blockId, cond, &idleSince, &prevLastUpdated)
		if status != "" {
			lastStatus = status
		}
		if err == nil && met {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for %s after %s (last status: %s)", cond.Reason, timeout, lastStatus)
		}
		time.Sleep(blockWaitPollInterval)
	}
}

// pollWaitCondition checks the wait condition once. lastStatus is a
// human-readable snapshot for timeout errors. idleSince and prevLastUpdated
// are only used for the idle condition.
func pollWaitCondition(blockId string, cond waitCondition, idleSince *time.Time, prevLastUpdated *int64) (met bool, lastStatus string, err error) {
	switch cond.Reason {
	case "exit":
		status, err := wshclient.BlockControllerStatusCommand(RpcClient, blockId, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return false, err.Error(), nil
		}
		if status == nil {
			return false, "no controller", nil
		}
		if status.ShellProcStatus == "done" {
			return true, status.ShellProcStatus, nil
		}
		return false, status.ShellProcStatus, nil
	case "contains":
		result, err := termGetScrollback(blockId, 0, 0, false)
		if err != nil {
			return false, err.Error(), nil
		}
		if scrollbackContains(result.Lines, cond.Contains) {
			return true, "contains", nil
		}
		return false, "substring not found", nil
	case "idle":
		result, err := termGetScrollback(blockId, 0, 1, false)
		if err != nil {
			return false, err.Error(), nil
		}
		if *prevLastUpdated != result.LastUpdated {
			*prevLastUpdated = result.LastUpdated
			*idleSince = time.Now()
			return false, fmt.Sprintf("lastupdated=%d", result.LastUpdated), nil
		}
		if time.Since(*idleSince) >= time.Duration(cond.IdleMs)*time.Millisecond {
			return true, fmt.Sprintf("lastupdated=%d", result.LastUpdated), nil
		}
		return false, fmt.Sprintf("lastupdated=%d", result.LastUpdated), nil
	default:
		return false, "unknown condition", fmt.Errorf("unknown wait condition %q", cond.Reason)
	}
}

// scrollbackContains reports whether substr appears in the joined scrollback.
func scrollbackContains(lines []string, substr string) bool {
	if substr == "" {
		return true
	}
	return strings.Contains(strings.Join(lines, "\n"), substr)
}
