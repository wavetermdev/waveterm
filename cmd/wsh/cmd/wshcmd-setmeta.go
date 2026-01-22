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
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
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

func parseMetaValue(setVal string) (any, error) {
	if setVal == "" || setVal == "null" {
		return nil, nil
	}
	if setVal == "true" {
		return true, nil
	}
	if setVal == "false" {
		return false, nil
	}
	if setVal[0] == '[' || setVal[0] == '{' || setVal[0] == '"' {
		var val any
		err := json.Unmarshal([]byte(setVal), &val)
		if err != nil {
			return nil, fmt.Errorf("invalid json value: %v", err)
		}
		return val, nil
	}

	// Try parsing as integer
	ival, err := strconv.ParseInt(setVal, 0, 64)
	if err == nil {
		return ival, nil
	}

	// Try parsing as float
	fval, err := strconv.ParseFloat(setVal, 64)
	if err == nil {
		return fval, nil
	}

	// Fallback to string
	return setVal, nil
}

func setNestedValue(meta map[string]any, path []string, value any) {
	// For single key, just set directly
	if len(path) == 1 {
		meta[path[0]] = value
		return
	}

	// For nested path, traverse or create maps as needed
	current := meta
	for i := 0; i < len(path)-1; i++ {
		key := path[i]
		// If next level doesn't exist or isn't a map, create new map
		next, exists := current[key]
		if !exists {
			nextMap := make(map[string]any)
			current[key] = nextMap
			current = nextMap
		} else if nextMap, ok := next.(map[string]any); ok {
			current = nextMap
		} else {
			// If existing value isn't a map, replace with new map
			nextMap = make(map[string]any)
			current[key] = nextMap
			current = nextMap
		}
	}

	// Set the final value
	current[path[len(path)-1]] = value
}

func parseMetaSets(metaSets []string) (map[string]any, error) {
	meta := make(map[string]any)
	for _, metaSet := range metaSets {
		fields := strings.SplitN(metaSet, "=", 2)
		if len(fields) != 2 {
			return nil, fmt.Errorf("invalid meta set: %q", metaSet)
		}

		val, err := parseMetaValue(fields[1])
		if err != nil {
			return nil, err
		}

		// Split the key path and set nested value
		path := strings.Split(fields[0], "/")
		setNestedValue(meta, path, val)
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
	err = wshclient.SetMetaCommand(RpcClient, *setMetaWshCmd, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("setting metadata: %v", err)
	}
	WriteStdout("metadata set\n")
	return nil
}
