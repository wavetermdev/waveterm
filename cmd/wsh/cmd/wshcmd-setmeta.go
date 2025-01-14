// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var setMetaCmd = &cobra.Command{
	Use:     "setmeta [-b {blockid|blocknum|this}] [--json file.json] key=value ...",
	Short:   "set metadata for an entity",
	Args:    cobra.MinimumNArgs(0),
	RunE:    setMetaRun,
	PreRunE: preRunSetupRpcClient,
}

var setMetaJsonFilePath string

func init() {
	rootCmd.AddCommand(setMetaCmd)
	setMetaCmd.Flags().StringVar(&setMetaJsonFilePath, "json", "", "JSON file containing metadata to apply (use '-' for stdin)")
}

func loadJSONFile(filepath string) (map[string]interface{}, error) {
	var data []byte
	var err error

	if filepath == "-" {
		data, err = io.ReadAll(os.Stdin)
		if err != nil {
			return nil, fmt.Errorf("reading from stdin: %v", err)
		}
	} else {
		data, err = os.ReadFile(filepath)
		if err != nil {
			return nil, fmt.Errorf("reading JSON file: %v", err)
		}
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("parsing JSON file: %v", err)
	}

	if result == nil {
		return nil, fmt.Errorf("JSON file must contain an object, not null")
	}

	return result, nil
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
		} else if setVal[0] == '[' || setVal[0] == '{' || setVal[0] == '"' {
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

func simpleMergeMeta(meta map[string]interface{}, metaUpdate map[string]interface{}) map[string]interface{} {
	for k, v := range metaUpdate {
		if v == nil {
			delete(meta, k)
		} else {
			meta[k] = v
		}
	}
	return meta
}

func setMetaRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("setmeta", rtnErr == nil)
	}()
	var jsonMeta map[string]interface{}
	if setMetaJsonFilePath != "" {
		var err error
		jsonMeta, err = loadJSONFile(setMetaJsonFilePath)
		if err != nil {
			return err
		}
	}

	cmdMeta, err := parseMetaSets(args)
	if err != nil {
		return err
	}

	// Merge JSON metadata with command-line metadata, with command-line taking precedence
	var fullMeta map[string]any
	if len(jsonMeta) > 0 {
		fullMeta = simpleMergeMeta(jsonMeta, cmdMeta)
	} else {
		fullMeta = cmdMeta
	}
	if len(fullMeta) == 0 {
		return fmt.Errorf("no metadata keys specified")
	}
	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}

	setMetaWshCmd := &wshrpc.CommandSetMetaData{
		ORef: *fullORef,
		Meta: fullMeta,
	}
	_, err = RpcClient.SendRpcRequest(wshrpc.Command_SetMeta, setMetaWshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("setting metadata: %v", err)
	}
	WriteStdout("metadata set\n")
	return nil
}
