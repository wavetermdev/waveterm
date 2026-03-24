// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"reflect"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var (
	rtInfoStore = make(map[waveobj.ORef]*waveobj.ObjRTInfo)
	rtInfoMutex sync.RWMutex
)

func setFieldValue(fieldValue reflect.Value, value any) {
	if value == nil {
		fieldValue.Set(reflect.Zero(fieldValue.Type()))
		return
	}

	if valueStr, ok := value.(string); ok && fieldValue.Kind() == reflect.String {
		fieldValue.SetString(valueStr)
		return
	}

	if valueBool, ok := value.(bool); ok && fieldValue.Kind() == reflect.Bool {
		fieldValue.SetBool(valueBool)
		return
	}

	if fieldValue.Kind() == reflect.Int {
		switch v := value.(type) {
		case int:
			fieldValue.SetInt(int64(v))
		case int64:
			fieldValue.SetInt(v)
		case float64:
			fieldValue.SetInt(int64(v))
		}
		return
	}

	if fieldValue.Kind() == reflect.Map {
		if fieldValue.Type().Key().Kind() == reflect.String && fieldValue.Type().Elem().Kind() == reflect.Float64 {
			if inputMap, ok := value.(map[string]any); ok {
				outputMap := make(map[string]float64)
				for k, v := range inputMap {
					if floatVal, ok := v.(float64); ok {
						outputMap[k] = floatVal
					}
				}
				fieldValue.Set(reflect.ValueOf(outputMap))
			}
			return
		}

		if fieldValue.Type().Key().Kind() == reflect.String && fieldValue.Type().Elem().Kind() == reflect.String {
			if inputMap, ok := value.(map[string]any); ok {
				outputMap := make(map[string]string)
				for k, v := range inputMap {
					if strVal, ok := v.(string); ok {
						outputMap[k] = strVal
					}
				}
				fieldValue.Set(reflect.ValueOf(outputMap))
			}
			return
		}
		return
	}

	if fieldValue.Kind() == reflect.Interface {
		fieldValue.Set(reflect.ValueOf(value))
	}
}

// SetRTInfo merges the provided info map into the ObjRTInfo for the given ORef.
// Only updates fields that exist in the ObjRTInfo struct.
// Removes fields that have nil values.
func SetRTInfo(oref waveobj.ORef, info map[string]any) {
	rtInfoMutex.Lock()
	defer rtInfoMutex.Unlock()

	rtInfo, exists := rtInfoStore[oref]
	if !exists {
		rtInfo = &waveobj.ObjRTInfo{}
		rtInfoStore[oref] = rtInfo
	}

	rtInfoValue := reflect.ValueOf(rtInfo).Elem()
	rtInfoType := rtInfoValue.Type()

	// Build a map of json tags to field indices for quick lookup
	jsonTagToField := make(map[string]int)
	for i := 0; i < rtInfoType.NumField(); i++ {
		field := rtInfoType.Field(i)
		jsonTag := field.Tag.Get("json")
		if jsonTag != "" {
			// Remove omitempty and other options
			tagParts := strings.Split(jsonTag, ",")
			if len(tagParts) > 0 && tagParts[0] != "" {
				jsonTagToField[tagParts[0]] = i
			}
		}
	}

	// Merge the info map into the struct
	for key, value := range info {
		fieldIndex, exists := jsonTagToField[key]
		if !exists {
			continue // Skip keys that don't exist in the struct
		}

		fieldValue := rtInfoValue.Field(fieldIndex)
		if !fieldValue.CanSet() {
			continue
		}

		setFieldValue(fieldValue, value)
	}
}

// GetRTInfo returns the ObjRTInfo for the given ORef, or nil if not found
func GetRTInfo(oref waveobj.ORef) *waveobj.ObjRTInfo {
	rtInfoMutex.RLock()
	defer rtInfoMutex.RUnlock()

	if rtInfo, exists := rtInfoStore[oref]; exists {
		// Return a copy to avoid external modification
		copy := *rtInfo
		return &copy
	}
	return nil
}

// DeleteRTInfo removes the ObjRTInfo for the given ORef
func DeleteRTInfo(oref waveobj.ORef) {
	rtInfoMutex.Lock()
	defer rtInfoMutex.Unlock()

	delete(rtInfoStore, oref)
}
