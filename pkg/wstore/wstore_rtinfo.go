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

		if value == nil {
			// Set to zero value (empty string for string fields)
			fieldValue.Set(reflect.Zero(fieldValue.Type()))
		} else {
			// Convert and set the value
			if valueStr, ok := value.(string); ok && fieldValue.Kind() == reflect.String {
				fieldValue.SetString(valueStr)
			} else if valueBool, ok := value.(bool); ok && fieldValue.Kind() == reflect.Bool {
				fieldValue.SetBool(valueBool)
			} else if fieldValue.Kind() == reflect.Int {
				// Handle int fields - need to convert from various numeric types
				switch v := value.(type) {
				case int:
					fieldValue.SetInt(int64(v))
				case int64:
					fieldValue.SetInt(v)
				case float64:
					fieldValue.SetInt(int64(v))
				}
			} else if fieldValue.Kind() == reflect.Interface {
				// Handle any/interface{} fields
				fieldValue.Set(reflect.ValueOf(value))
			}
		}
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
