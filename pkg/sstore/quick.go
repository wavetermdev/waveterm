package sstore

import "encoding/json"

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
