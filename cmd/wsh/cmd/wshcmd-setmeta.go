// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

var setMetaCmd = &cobra.Command{
	Use:   "setmeta",
	Short: "set metadata for an entity",
	Args:  cobra.MinimumNArgs(2),
	Run:   setMetaRun,
}

func init() {
	rootCmd.AddCommand(setMetaCmd)
}

func parseMetaSets(metaSets []string) (map[string]interface{}, error) {
	meta := make(map[string]interface{})
	for _, metaSet := range metaSets {
		fields := strings.Split(metaSet, "=")
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
			ival, err := strconv.ParseInt(setVal, 10, 64)
			if err == nil {
				meta[fields[0]] = ival
			} else {
				meta[fields[0]] = setVal
			}
		}
	}
	return meta, nil
}

func setMetaRun(cmd *cobra.Command, args []string) {
	oref := args[0]
	metaSetsStrs := args[1:]
	if oref == "" {
		fmt.Println("oref is required")
		return
	}
	err := validateEasyORef(oref)
	if err != nil {
		fmt.Printf("%v\n", err)
		return
	}
	meta, err := parseMetaSets(metaSetsStrs)
	if err != nil {
		fmt.Printf("%v\n", err)
		return
	}
	setTermRawMode()
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		fmt.Printf("error resolving oref: %v\n", err)
		return
	}
	setMetaWshCmd := &wshutil.BlockSetMetaCommand{
		Command: wshutil.BlockCommand_SetMeta,
		ORef:    fullORef,
		Meta:    meta,
	}
	_, err = RpcClient.SendRpcRequest(setMetaWshCmd, 2000)
	if err != nil {
		fmt.Printf("error setting metadata: %v\n", err)
		return
	}
	fmt.Print("metadata set\r\n")
}
