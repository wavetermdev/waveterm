// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var getMetaCmd = &cobra.Command{
	Use:     "getmeta [key...]",
	Short:   "get metadata for an entity",
	Long:    "Get metadata for an entity. Keys can be exact matches or patterns like 'name:*' to get all keys that start with 'name:'",
	Args:    cobra.ArbitraryArgs,
	Run:     getMetaRun,
	PreRunE: preRunSetupRpcClient,
}

var getMetaRawOutput bool
var getMetaClearPrefix bool

func init() {
	rootCmd.AddCommand(getMetaCmd)
	getMetaCmd.Flags().BoolVar(&getMetaRawOutput, "raw", false, "output singleton string values without quotes")
	getMetaCmd.Flags().BoolVar(&getMetaClearPrefix, "clear-prefix", false, "output the special clearing key for prefix queries")
}

func filterMetaKeys(meta map[string]interface{}, keys []string) map[string]interface{} {
	result := make(map[string]interface{})

	// Process each requested key
	for _, key := range keys {
		if strings.HasSuffix(key, ":*") {
			// Handle pattern matching
			prefix := strings.TrimSuffix(key, "*")
			baseKey := strings.TrimSuffix(prefix, ":")

			if getMetaClearPrefix {
				result[key] = true
			}

			// Include the base key without colon if it exists
			if val, exists := meta[baseKey]; exists {
				result[baseKey] = val
			}

			// Include all keys with the prefix
			for k, v := range meta {
				if strings.HasPrefix(k, prefix) {
					result[k] = v
				}
			}
		} else {
			// Handle exact key match
			if val, exists := meta[key]; exists {
				result[key] = val
			} else {
				result[key] = nil
			}
		}
	}

	return result
}

func getMetaRun(cmd *cobra.Command, args []string) {
	oref := blockArg
	if oref == "" {
		WriteStderr("[error] oref is required")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		WriteStderr("[error] %v\n", err)
		return
	}
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		WriteStderr("[error] resolving oref: %v\n", err)
		return
	}
	resp, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *fullORef}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] getting metadata: %v\n", err)
		return
	}

	var output interface{}
	if len(args) > 0 {
		if len(args) == 1 && !strings.HasSuffix(args[0], ":*") {
			// Single key case - output just the value
			output = resp[args[0]]
		} else {
			// Multiple keys or pattern matching case - output object
			output = filterMetaKeys(resp, args)
		}
	} else {
		// No args case - output full metadata
		output = resp
	}

	// Handle raw string output
	if getMetaRawOutput {
		if str, ok := output.(string); ok {
			WriteStdout("%s\n", str)
			return
		}
	}

	outBArr, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		WriteStderr("[error] formatting metadata: %v\n", err)
		return
	}
	outStr := string(outBArr)
	WriteStdout("%s\n", outStr)
}
