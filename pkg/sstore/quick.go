package sstore

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strconv"
)

func quickSetStr(strVal *string, m map[string]interface{}, name string) {
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
		str = "{}"
	}
	json.Unmarshal([]byte(str), ptr)
}

func quickJson(v interface{}) string {
	if v == nil {
		return "{}"
	}
	barr, _ := json.Marshal(v)
	return string(barr)
}

func quickScanJson(ptr interface{}, val interface{}) error {
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

func quickValueJson(v interface{}) (driver.Value, error) {
	if v == nil {
		return "{}", nil
	}
	barr, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return string(barr), nil
}
