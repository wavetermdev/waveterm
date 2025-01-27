// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package dbutil

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
)

func QuickSetStr(strVal *string, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		return
	}
	ival, ok := v.(int64)
	if ok {
		*strVal = strconv.FormatInt(ival, 10)
		return
	}
	str, ok := v.(string)
	if !ok {
		return
	}
	*strVal = str
}

func QuickSetInt(ival *int, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		return
	}
	sqlInt, ok := v.(int)
	if ok {
		*ival = sqlInt
		return
	}
	sqlInt64, ok := v.(int64)
	if ok {
		*ival = int(sqlInt64)
		return
	}
}

func QuickSetNullableInt64(ival **int64, m map[string]any, name string) {
	v, ok := m[name]
	if !ok {
		// set to nil
		return
	}
	sqlInt64, ok := v.(int64)
	if ok {
		*ival = &sqlInt64
		return
	}
	sqlInt, ok := v.(int)
	if ok {
		sqlInt64 = int64(sqlInt)
		*ival = &sqlInt64
		return
	}
}

func QuickSetInt64(ival *int64, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		// leave as zero
		return
	}
	sqlInt64, ok := v.(int64)
	if ok {
		*ival = sqlInt64
		return
	}
	sqlInt, ok := v.(int)
	if ok {
		*ival = int64(sqlInt)
		return
	}
}

func QuickSetBool(bval *bool, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		return
	}
	sqlInt, ok := v.(int64)
	if ok {
		if sqlInt > 0 {
			*bval = true
		}
		return
	}
	sqlBool, ok := v.(bool)
	if ok {
		*bval = sqlBool
	}
}

func QuickSetBytes(bval *[]byte, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		return
	}
	sqlBytes, ok := v.([]byte)
	if ok {
		*bval = sqlBytes
	}
}

func getByteArr(m map[string]any, name string, def string) ([]byte, bool) {
	v, ok := m[name]
	if !ok {
		return nil, false
	}
	barr, ok := v.([]byte)
	if !ok {
		str, ok := v.(string)
		if !ok {
			return nil, false
		}
		barr = []byte(str)
	}
	if len(barr) == 0 {
		barr = []byte(def)
	}
	return barr, true
}

func QuickSetJson(ptr interface{}, m map[string]interface{}, name string) {
	barr, ok := getByteArr(m, name, "{}")
	if !ok {
		return
	}
	json.Unmarshal(barr, ptr)
}

func QuickSetNullableJson(ptr interface{}, m map[string]interface{}, name string) {
	barr, ok := getByteArr(m, name, "null")
	if !ok {
		return
	}
	json.Unmarshal(barr, ptr)
}

func QuickSetJsonArr(ptr interface{}, m map[string]interface{}, name string) {
	barr, ok := getByteArr(m, name, "[]")
	if !ok {
		return
	}
	json.Unmarshal(barr, ptr)
}

func CheckNil(v interface{}) bool {
	rv := reflect.ValueOf(v)
	if !rv.IsValid() {
		return true
	}
	switch rv.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return rv.IsNil()

	default:
		return false
	}
}

func QuickNullableJson(v interface{}) string {
	if CheckNil(v) {
		return "null"
	}
	barr, _ := json.Marshal(v)
	return string(barr)
}

func QuickJson(v interface{}) string {
	if CheckNil(v) {
		return "{}"
	}
	barr, _ := json.Marshal(v)
	return string(barr)
}

func QuickJsonBytes(v interface{}) []byte {
	if CheckNil(v) {
		return []byte("{}")
	}
	barr, _ := json.Marshal(v)
	return barr
}

func QuickJsonArr(v interface{}) string {
	if CheckNil(v) {
		return "[]"
	}
	barr, _ := json.Marshal(v)
	return string(barr)
}

func QuickJsonArrBytes(v interface{}) []byte {
	if CheckNil(v) {
		return []byte("[]")
	}
	barr, _ := json.Marshal(v)
	return barr
}

func QuickScanJson(ptr interface{}, val interface{}) error {
	barrVal, ok := val.([]byte)
	if !ok {
		strVal, ok := val.(string)
		if !ok {
			return fmt.Errorf("cannot scan '%T' into '%T'", val, ptr)
		}
		barrVal = []byte(strVal)
	}
	if len(barrVal) == 0 {
		barrVal = []byte("{}")
	}
	return json.Unmarshal(barrVal, ptr)
}

func QuickValueJson(v interface{}) (driver.Value, error) {
	if CheckNil(v) {
		return "{}", nil
	}
	barr, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return string(barr), nil
}
