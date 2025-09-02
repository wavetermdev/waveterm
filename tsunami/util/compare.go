// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package util

import (
	"math"
	"reflect"
	"strconv"
)

// this is a shallow equal, but with special handling for numeric types
// it will up convert to float64 and compare
func JsonValEqual(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	typeA := reflect.TypeOf(a)
	typeB := reflect.TypeOf(b)
	if typeA == typeB && typeA.Comparable() {
		return a == b
	}
	if IsNumericType(a) && IsNumericType(b) {
		return CompareAsFloat64(a, b)
	}
	if typeA != typeB {
		return false
	}
	// for slices and maps, compare their pointers
	valA := reflect.ValueOf(a)
	valB := reflect.ValueOf(b)
	switch valA.Kind() {
	case reflect.Slice, reflect.Map:
		return valA.Pointer() == valB.Pointer()
	}
	return false
}

// Helper to check if a value is a numeric type
func IsNumericType(val any) bool {
	switch val.(type) {
	case int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64:
		return true
	default:
		return false
	}
}

// Helper to handle numeric comparisons as float64
func CompareAsFloat64(a, b any) bool {
	valA, okA := ToFloat64(a)
	valB, okB := ToFloat64(b)
	return okA && okB && valA == valB
}

// Convert various numeric types to float64 for comparison
func ToFloat64(val any) (float64, bool) {
	if val == nil {
		return 0, false
	}
	switch v := val.(type) {
	case int:
		return float64(v), true
	case int8:
		return float64(v), true
	case int16:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint:
		return float64(v), true
	case uint8:
		return float64(v), true
	case uint16:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case float32:
		return float64(v), true
	case float64:
		return v, true
	default:
		return 0, false
	}
}

func ToInt64(val any) (int64, bool) {
	if val == nil {
		return 0, false
	}
	switch v := val.(type) {
	case int:
		return int64(v), true
	case int8:
		return int64(v), true
	case int16:
		return int64(v), true
	case int32:
		return int64(v), true
	case int64:
		return v, true
	case uint:
		return int64(v), true
	case uint8:
		return int64(v), true
	case uint16:
		return int64(v), true
	case uint32:
		return int64(v), true
	case uint64:
		return int64(v), true
	case float32:
		return int64(v), true
	case float64:
		return int64(v), true
	default:
		return 0, false
	}
}

func ToInt(val any) (int, bool) {
	i, ok := ToInt64(val)
	if !ok {
		return 0, false
	}
	return int(i), true
}

func NumToString[T any](value T) (string, bool) {
	switch v := any(value).(type) {
	case int:
		return strconv.FormatInt(int64(v), 10), true
	case int8:
		return strconv.FormatInt(int64(v), 10), true
	case int16:
		return strconv.FormatInt(int64(v), 10), true
	case int32:
		return strconv.FormatInt(int64(v), 10), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case uint:
		return strconv.FormatUint(uint64(v), 10), true
	case uint8:
		return strconv.FormatUint(uint64(v), 10), true
	case uint16:
		return strconv.FormatUint(uint64(v), 10), true
	case uint32:
		return strconv.FormatUint(uint64(v), 10), true
	case uint64:
		return strconv.FormatUint(v, 10), true
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32), true
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), true
	default:
		return "", false
	}
}

// FromFloat64 converts a float64 to the specified numeric type T
// Returns the converted value and a bool indicating if the conversion was successful
func FromFloat64[T any](val float64) (T, bool) {
	var zero T
	
	// Check for NaN or infinity
	if math.IsNaN(val) || math.IsInf(val, 0) {
		return zero, false
	}
	
	switch any(zero).(type) {
	case int:
		if val != float64(int64(val)) || val < math.MinInt || val > math.MaxInt {
			return zero, false
		}
		return any(int(val)).(T), true
	case int8:
		if val != float64(int64(val)) || val < math.MinInt8 || val > math.MaxInt8 {
			return zero, false
		}
		return any(int8(val)).(T), true
	case int16:
		if val != float64(int64(val)) || val < math.MinInt16 || val > math.MaxInt16 {
			return zero, false
		}
		return any(int16(val)).(T), true
	case int32:
		if val != float64(int64(val)) || val < math.MinInt32 || val > math.MaxInt32 {
			return zero, false
		}
		return any(int32(val)).(T), true
	case int64:
		if val != float64(int64(val)) || val < math.MinInt64 || val > math.MaxInt64 {
			return zero, false
		}
		return any(int64(val)).(T), true
	case uint:
		if val < 0 || val != float64(uint64(val)) || val > math.MaxUint {
			return zero, false
		}
		return any(uint(val)).(T), true
	case uint8:
		if val < 0 || val != float64(uint64(val)) || val > math.MaxUint8 {
			return zero, false
		}
		return any(uint8(val)).(T), true
	case uint16:
		if val < 0 || val != float64(uint64(val)) || val > math.MaxUint16 {
			return zero, false
		}
		return any(uint16(val)).(T), true
	case uint32:
		if val < 0 || val != float64(uint64(val)) || val > math.MaxUint32 {
			return zero, false
		}
		return any(uint32(val)).(T), true
	case uint64:
		if val < 0 || val != float64(uint64(val)) || val > math.MaxUint64 {
			return zero, false
		}
		return any(uint64(val)).(T), true
	case float32:
		if math.Abs(val) > math.MaxFloat32 {
			return zero, false
		}
		return any(float32(val)).(T), true
	case float64:
		return any(val).(T), true
	default:
		return zero, false
	}
}