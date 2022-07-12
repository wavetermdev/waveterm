package sstore

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

func quickSetStr(strVal *string, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		return
	}
	str, ok := v.(string)
	if !ok {
		return
	}
	*strVal = str
}

func quickSetInt64(ival *int64, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		return
	}
	sqlInt, ok := v.(int64)
	if !ok {
		return
	}
	*ival = sqlInt
}

func quickSetBool(bval *bool, m map[string]interface{}, name string) {
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

func quickSetJson(ptr interface{}, m map[string]interface{}, name string) {
	v, ok := m[name]
	if !ok {
		return
	}
	str, ok := v.(string)
	if !ok {
		return
	}
	if str == "" {
		return
	}
	json.Unmarshal([]byte(str), ptr)
}

func quickJson(v interface{}) string {
	if v == nil {
		return ""
	}
	barr, _ := json.Marshal(v)
	return string(barr)
}

func quickScanJson(ptr interface{}, val interface{}) error {
	strVal, ok := val.(string)
	if !ok {
		return fmt.Errorf("cannot scan '%T' into '%T'", val, ptr)
	}
	if strVal == "" {
		return nil
	}
	return json.Unmarshal([]byte(strVal), ptr)
}

func quickValueJson(v interface{}) (driver.Value, error) {
	if v == nil {
		return "", nil
	}
	return json.Marshal(v)
}
