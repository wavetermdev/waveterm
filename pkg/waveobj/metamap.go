// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

type MetaMapType map[string]any

func (m MetaMapType) GetString(key string, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

func (m MetaMapType) HasKey(key string) bool {
	_, ok := m[key]
	return ok
}

func (m MetaMapType) GetConnectionOverride(connName string) MetaMapType {
	v, ok := m["["+connName+"]"]
	if !ok {
		return nil
	}
	if mval, ok := v.(map[string]any); ok {
		return MetaMapType(mval)
	}
	return nil
}

func (m MetaMapType) GetStringList(key string) []string {
	v, ok := m[key]
	if !ok {
		return nil
	}
	varr, ok := v.([]any)
	if !ok {
		return nil
	}
	rtn := make([]string, 0)
	for _, varrVal := range varr {
		if s, ok := varrVal.(string); ok {
			rtn = append(rtn, s)
		}
	}
	return rtn
}

func (m MetaMapType) GetBool(key string, def bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return def
}

func (m MetaMapType) GetInt(key string, def int) int {
	if v, ok := m[key]; ok {
		if fval, ok := v.(float64); ok {
			return int(fval)
		}
	}
	return def
}

func (m MetaMapType) GetFloat(key string, def float64) float64 {
	if v, ok := m[key]; ok {
		if fval, ok := v.(float64); ok {
			return fval
		}
	}
	return def
}

func (m MetaMapType) GetMap(key string) MetaMapType {
	if v, ok := m[key]; ok {
		if mval, ok := v.(map[string]any); ok {
			return MetaMapType(mval)
		}
	}
	return nil
}

func (m MetaMapType) GetArray(key string) []any {
	if v, ok := m[key]; ok {
		if aval, ok := v.([]any); ok {
			return aval
		}
	}
	return nil
}

func (m MetaMapType) GetStringArray(key string) []string {
	arr := m.GetArray(key)
	if len(arr) == 0 {
		return nil
	}
	rtn := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok {
			rtn = append(rtn, s)
		}
	}
	return rtn
}
