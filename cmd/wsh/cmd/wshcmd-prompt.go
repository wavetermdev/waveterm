// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	defaultPromptTimeout  = 60 * time.Second
	promptRpcTimeoutSlack = 30 * time.Second
)

var (
	promptOptions string
	promptTimeout string
	promptDefault string
	promptTitle   string
)

var promptCmd = &cobra.Command{
	Use:   "prompt <question> [--options \"a,b\"] [--timeout 60s] [--default no] [--title \"...\"]",
	Short: "ask the user a question in a modal and wait for the answer",
	Long: `Ask the user a question via a UI modal and block until answered, printing
the answer to stdout. Works from hidden/background blocks.

Without --options the modal shows a free-text input and returns the typed answer.
With --options the modal shows one button per option and returns the clicked one.
If --default is set and the prompt times out, that value is printed and the command exits 0.
Cancel still returns an error.`,
	Example: "  wsh prompt \"Deploy to production?\" --options \"yes,no\" --default no --timeout 60s\n  wsh prompt \"What is your name?\" --title \"Name\"",
	Args:    cobra.MinimumNArgs(1),
	RunE:    promptRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	promptCmd.Flags().StringVar(&promptOptions, "options", "", "comma-separated list of options")
	promptCmd.Flags().StringVar(&promptTimeout, "timeout", "60s", "how long to wait for an answer (e.g. 30s, 5m)")
	promptCmd.Flags().StringVar(&promptDefault, "default", "", "value returned on timeout instead of error")
	promptCmd.Flags().StringVar(&promptTitle, "title", "", "modal title")
	rootCmd.AddCommand(promptCmd)
}

// parseOptionsFlag splits a comma-separated options string, trimming whitespace
// and dropping nothing (empty options are an error). An empty/whitespace-only
// flag yields nil (no options, i.e. free-text prompt).
func parseOptionsFlag(optionsFlag string) ([]string, error) {
	if strings.TrimSpace(optionsFlag) == "" {
		return nil, nil
	}
	parts := strings.Split(optionsFlag, ",")
	options := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			return nil, fmt.Errorf("invalid --options value %q: empty option", optionsFlag)
		}
		options = append(options, trimmed)
	}
	return options, nil
}

func promptTimeouts(timeoutFlag string) (timeoutMs int, rpcTimeoutMs int64, err error) {
	d, err := parseDurationFlag(timeoutFlag, defaultPromptTimeout)
	if err != nil {
		return 0, 0, err
	}
	return int(d.Milliseconds()), (d + promptRpcTimeoutSlack).Milliseconds(), nil
}

func makePromptData(question string, options []string, title, defaultOption string, timeoutMs int) wshrpc.CommandPromptData {
	return wshrpc.CommandPromptData{
		Question:      question,
		Options:       options,
		Title:         title,
		TimeoutMs:     timeoutMs,
		DefaultOption: defaultOption,
	}
}

func promptRun(cmd *cobra.Command, args []string) (rtnErr error) {
	question := strings.Join(args, " ")
	options, err := parseOptionsFlag(promptOptions)
	if err != nil {
		return err
	}
	timeoutMs, rpcTimeoutMs, err := promptTimeouts(promptTimeout)
	if err != nil {
		return err
	}
	data := makePromptData(question, options, promptTitle, promptDefault, timeoutMs)
	answer, err := wshclient.PromptCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: rpcTimeoutMs})
	if err != nil {
		return fmt.Errorf("prompt: %w", err)
	}
	WriteStdout("%s\n", answer)
	return nil
}
