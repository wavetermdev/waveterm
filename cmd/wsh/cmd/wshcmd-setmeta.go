// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var setMetaCmd = &cobra.Command{
	Use:     "setmeta {blockid|blocknum|this} key=value ...",
	Short:   "set metadata for an entity",
	Args:    cobra.MinimumNArgs(1),
	Run:     setMetaRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(setMetaCmd)
}

func parseMetaSets(metaSets []string) (map[string]interface{}, error) {
	meta := make(map[string]interface{})
	for _, metaSet := range metaSets {
		fields := strings.SplitN(metaSet, "=", 2)
		if len(fields) != 2 {
			return nil, fmt.Errorf("invalid meta set: %q", metaSet)
		}
		setVal := fields[1]
		if setVal == "" || setVal == "null" {
			meta[fields[0]] = nil
		} else if setVal == "true" {
			meta[fields[0]] = true
		} else if setVal == "false" {
			meta[fields[0]] = false
		} else if setVal[0] == '[' || setVal[0] == '{' {
			var val interface{}
			err := json.Unmarshal([]byte(setVal), &val)
			if err != nil {
				return nil, fmt.Errorf("invalid json value: %v", err)
			}
			meta[fields[0]] = val
		} else {
			ival, err := strconv.ParseInt(setVal, 0, 64)
			if err == nil {
				meta[fields[0]] = ival
			} else {
				fval, err := strconv.ParseFloat(setVal, 64)
				if err == nil {
					meta[fields[0]] = fval
				} else {
					meta[fields[0]] = setVal
				}
			}
		}
	}
	return meta, nil
}

func setMetaRun(cmd *cobra.Command, args []string) {
	oref := blockArg
	metaSetsStrs := args[:]
	if oref == "" {
		WriteStderr("[error] oref is required\n")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		WriteStderr("[error] %v\n", err)
		return
	}
	meta, err := parseMetaSets(metaSetsStrs)
	if err != nil {
		WriteStderr("[error] %v\n", err)
		return
	}
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		WriteStderr("[error] resolving oref: %v\n", err)
		return
	}
	setMetaWshCmd := &wshrpc.CommandSetMetaData{
		ORef: *fullORef,
		Meta: meta,
	}
	_, err = RpcClient.SendRpcRequest(wshrpc.Command_SetMeta, setMetaWshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		WriteStderr("[error] setting metadata: %v\n", err)
		return
	}
	WriteStdout("metadata set\n")
}
