// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig/defaultconfig"
	"github.com/wavetermdev/waveterm/pkg/wconfigtypes"
)

const SettingsFile = "settings.json"

func goBackWS(barr []byte, offset int) int {
	if offset >= len(barr) {
		offset = offset - 1
	}
	for i := offset - 1; i >= 0; i-- {
		if barr[i] == ' ' || barr[i] == '\t' || barr[i] == '\n' || barr[i] == '\r' {
			continue
		}
		return i
	}
	return 0
}

func isTrailingCommaError(barr []byte, offset int) bool {
	if offset >= len(barr) {
		offset = offset - 1
	}
	offset = goBackWS(barr, offset)
	if barr[offset] == '}' {
		offset = goBackWS(barr, offset)
		if barr[offset] == ',' {
			return true
		}
	}
	return false
}

func readConfigHelper(fileName string, barr []byte, readErr error) (waveobj.MetaMapType, []wconfigtypes.ConfigError) {
	var cerrs []wconfigtypes.ConfigError
	if readErr != nil && !os.IsNotExist(readErr) {
		cerrs = append(cerrs, wconfigtypes.ConfigError{File: fileName, Err: readErr.Error()})
	}
	if len(barr) == 0 {
		return nil, cerrs
	}
	var rtn waveobj.MetaMapType
	err := json.Unmarshal(barr, &rtn)
	if err != nil {
		if syntaxErr, ok := err.(*json.SyntaxError); ok {
			offset := syntaxErr.Offset
			if offset > 0 {
				offset = offset - 1
			}
			lineNum, colNum := utilfn.GetLineColFromOffset(barr, int(offset))
			isTrailingComma := isTrailingCommaError(barr, int(offset))
			if isTrailingComma {
				err = fmt.Errorf("json syntax error at line %d, col %d: probably an extra trailing comma: %v", lineNum, colNum, syntaxErr)
			} else {
				err = fmt.Errorf("json syntax error at line %d, col %d: %v", lineNum, colNum, syntaxErr)
			}
		}
		cerrs = append(cerrs, wconfigtypes.ConfigError{File: fileName, Err: err.Error()})
	}
	return rtn, cerrs
}

func ReadDefaultsConfigFile(fileName string) (waveobj.MetaMapType, []wconfigtypes.ConfigError) {
	barr, readErr := defaultconfig.ConfigFS.ReadFile(fileName)
	return readConfigHelper("defaults:"+fileName, barr, readErr)
}

func ReadWaveHomeConfigFile(fileName string) (waveobj.MetaMapType, []wconfigtypes.ConfigError) {
	fullFileName := filepath.Join(configDirAbsPath, fileName)
	barr, err := os.ReadFile(fullFileName)
	return readConfigHelper(fullFileName, barr, err)
}

func WriteWaveHomeConfigFile(fileName string, m waveobj.MetaMapType) error {
	fullFileName := filepath.Join(configDirAbsPath, fileName)
	barr, err := jsonMarshalConfigInOrder(m)
	if err != nil {
		return err
	}
	return os.WriteFile(fullFileName, barr, 0644)
}

// simple merge that overwrites
func mergeMetaMapSimple(m waveobj.MetaMapType, toMerge waveobj.MetaMapType) waveobj.MetaMapType {
	if m == nil {
		return toMerge
	}
	if toMerge == nil {
		return m
	}
	for k, v := range toMerge {
		if v == nil {
			delete(m, k)
			continue
		}
		m[k] = v
	}
	if len(m) == 0 {
		return nil
	}
	return m
}

func ReadConfigPart(partName string, simpleMerge bool) (waveobj.MetaMapType, []wconfigtypes.ConfigError) {
	defConfig, cerrs1 := ReadDefaultsConfigFile(partName)
	userConfig, cerrs2 := ReadWaveHomeConfigFile(partName)
	allErrs := append(cerrs1, cerrs2...)
	if simpleMerge {
		return mergeMetaMapSimple(defConfig, userConfig), allErrs
	} else {
		return waveobj.MergeMeta(defConfig, userConfig, true), allErrs
	}
}

func ReadFullConfig() wconfigtypes.FullConfigType {
	var fullConfig wconfigtypes.FullConfigType
	configRType := reflect.TypeOf(fullConfig)
	configRVal := reflect.ValueOf(&fullConfig).Elem()
	for fieldIdx := 0; fieldIdx < configRType.NumField(); fieldIdx++ {
		field := configRType.Field(fieldIdx)
		if field.PkgPath != "" {
			continue
		}
		configFile := field.Tag.Get("configfile")
		if configFile == "-" {
			continue
		}
		jsonTag := utilfn.GetJsonTag(field)
		if jsonTag == "-" || jsonTag == "" {
			continue
		}
		simpleMerge := field.Tag.Get("merge") == ""
		fileName := jsonTag + ".json"
		configPart, cerrs := ReadConfigPart(fileName, simpleMerge)
		fullConfig.ConfigErrors = append(fullConfig.ConfigErrors, cerrs...)
		if configPart != nil {
			fieldPtr := configRVal.Field(fieldIdx).Addr().Interface()
			utilfn.ReUnmarshal(fieldPtr, configPart)
		}
	}
	return fullConfig
}

func getConfigKeyType(configKey string) reflect.Type {
	ctype := reflect.TypeOf(wconfigtypes.SettingsType{})
	for i := 0; i < ctype.NumField(); i++ {
		field := ctype.Field(i)
		jsonTag := utilfn.GetJsonTag(field)
		if jsonTag == configKey {
			return field.Type
		}
	}
	return nil
}

func getConfigKeyNamespace(key string) string {
	colonIdx := strings.Index(key, ":")
	if colonIdx == -1 {
		return ""
	}
	return key[:colonIdx]
}

func orderConfigKeys(m waveobj.MetaMapType) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		k1 := keys[i]
		k2 := keys[j]
		k1ns := getConfigKeyNamespace(k1)
		k2ns := getConfigKeyNamespace(k2)
		if k1ns != k2ns {
			return k1ns < k2ns
		}
		return k1 < k2
	})
	return keys
}

func reindentJson(barr []byte, indentStr string) []byte {
	if len(barr) < 2 {
		return barr
	}
	if barr[0] != '{' && barr[0] != '[' {
		return barr
	}
	if bytes.Contains(barr, []byte("\n")) {
		return barr
	}
	outputLines := bytes.Split(barr, []byte("\n"))
	for i, line := range outputLines {
		if i == 0 || i == len(outputLines)-1 {
			continue
		}
		outputLines[i] = append([]byte(indentStr), line...)
	}
	return bytes.Join(outputLines, []byte("\n"))
}

func jsonMarshalConfigInOrder(m waveobj.MetaMapType) ([]byte, error) {
	if len(m) == 0 {
		return []byte("{}"), nil
	}
	var buf bytes.Buffer
	orderedKeys := orderConfigKeys(m)
	buf.WriteString("{\n")
	for idx, key := range orderedKeys {
		val := m[key]
		keyBarr, err := json.Marshal(key)
		if err != nil {
			return nil, err
		}
		valBarr, err := json.MarshalIndent(val, "", "  ")
		if err != nil {
			return nil, err
		}
		valBarr = reindentJson(valBarr, "  ")
		buf.WriteString("  ")
		buf.Write(keyBarr)
		buf.WriteString(": ")
		buf.Write(valBarr)
		if idx < len(orderedKeys)-1 {
			buf.WriteString(",")
		}
		buf.WriteString("\n")
	}
	buf.WriteString("}")
	return buf.Bytes(), nil
}

var dummyNumber json.Number

func convertJsonNumber(num json.Number, ctype reflect.Type) (interface{}, error) {
	// ctype might be int64, float64, string, *int64, *float64, *string
	// switch on ctype first
	if ctype.Kind() == reflect.Pointer {
		ctype = ctype.Elem()
	}
	if reflect.Int64 == ctype.Kind() {
		if ival, err := num.Int64(); err == nil {
			return ival, nil
		}
		return nil, fmt.Errorf("invalid number for int64: %s", num)
	}
	if reflect.Float64 == ctype.Kind() {
		if fval, err := num.Float64(); err == nil {
			return fval, nil
		}
		return nil, fmt.Errorf("invalid number for float64: %s", num)
	}
	if reflect.String == ctype.Kind() {
		return num.String(), nil
	}
	return nil, fmt.Errorf("cannot convert number to %s", ctype)
}

func SetBaseConfigValue(toMerge waveobj.MetaMapType) error {
	m, cerrs := ReadWaveHomeConfigFile(SettingsFile)
	if len(cerrs) > 0 {
		return fmt.Errorf("error reading config file: %v", cerrs[0])
	}
	if m == nil {
		m = make(waveobj.MetaMapType)
	}
	for configKey, val := range toMerge {
		ctype := getConfigKeyType(configKey)
		if ctype == nil {
			return fmt.Errorf("invalid config key: %s", configKey)
		}
		if val == nil {
			delete(m, configKey)
		} else {
			rtype := reflect.TypeOf(val)
			if rtype == reflect.TypeOf(dummyNumber) {
				convertedVal, err := convertJsonNumber(val.(json.Number), ctype)
				if err != nil {
					return fmt.Errorf("cannot convert %s: %v", configKey, err)
				}
				val = convertedVal
				rtype = reflect.TypeOf(val)
			}
			if rtype != ctype {
				if ctype == reflect.PointerTo(rtype) {
					m[configKey] = &val
				} else {
					return fmt.Errorf("invalid value type for %s: %T", configKey, val)
				}
			}
			m[configKey] = val
		}
	}
	return WriteWaveHomeConfigFile(SettingsFile, m)
}
