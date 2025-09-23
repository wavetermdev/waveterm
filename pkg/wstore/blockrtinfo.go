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
	blockRTInfoStore = make(map[waveobj.ORef]*waveobj.ObjRTInfo)
	blockRTInfoMutex sync.RWMutex
)

// SetRTInfo merges the provided info map into the BlockRTInfo for the given ORef.
// Only updates fields that exist in the BlockRTInfo struct.
// Removes fields that have nil values.
func SetRTInfo(oref waveobj.ORef, info map[string]any) {
	blockRTInfoMutex.Lock()
	defer blockRTInfoMutex.Unlock()

	rtInfo, exists := blockRTInfoStore[oref]
	if !exists {
		rtInfo = &waveobj.ObjRTInfo{}
		blockRTInfoStore[oref] = rtInfo
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
			} else if fieldValue.Kind() == reflect.Interface {
				// Handle any/interface{} fields
				fieldValue.Set(reflect.ValueOf(value))
			}
		}
	}
}

// GetRTInfo returns the BlockRTInfo for the given ORef, or nil if not found
func GetRTInfo(oref waveobj.ORef) *waveobj.ObjRTInfo {
	blockRTInfoMutex.RLock()
	defer blockRTInfoMutex.RUnlock()

	if rtInfo, exists := blockRTInfoStore[oref]; exists {
		// Return a copy to avoid external modification
		copy := *rtInfo
		return &copy
	}
	return nil
}

// DeleteRTInfo removes the BlockRTInfo for the given ORef
func DeleteRTInfo(oref waveobj.ORef) {
	blockRTInfoMutex.Lock()
	defer blockRTInfoMutex.Unlock()

	delete(blockRTInfoStore, oref)
}
