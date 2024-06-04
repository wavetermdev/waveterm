// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// implements incremental json format
package ijson

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
)

// ijson values are built out of standard go building blocks:
// string, float64, bool, nil, []any, map[string]any

// paths are arrays of strings and ints

const (
	SetCommandStr    = "set"
	DelCommandStr    = "del"
	AppendCommandStr = "append"
)

// instead of defining structs for commands, we just define a command shape
// set: type, path, value
// del: type, path
// arrayappend: type, path, value

type PathError struct {
	Err string
}

func (e PathError) Error() string {
	return "PathError: " + e.Err
}

func MakePathTypeError(path []any, index int) error {
	return PathError{fmt.Sprintf("invalid path element type:%T at index:%d (%s)", path[index], index, FormatPath(path))}
}

func MakePathError(errStr string, path []any, index int) error {
	return PathError{fmt.Sprintf("%s at index:%d (%s)", errStr, index, FormatPath(path))}
}

type SetTypeError struct {
	Err string
}

func (e SetTypeError) Error() string {
	return "SetTypeError: " + e.Err
}

func MakeSetTypeError(errStr string, path []any, index int) error {
	return SetTypeError{fmt.Sprintf("%s at index:%d (%s)", errStr, index, FormatPath(path))}
}

type BudgetError struct {
	Err string
}

func (e BudgetError) Error() string {
	return "BudgetError: " + e.Err
}

func MakeBudgetError(errStr string, path []any, index int) error {
	return BudgetError{fmt.Sprintf("%s at index:%d (%s)", errStr, index, FormatPath(path))}
}

var simplePathStrRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

func FormatPath(path []any) string {
	if len(path) == 0 {
		return "$"
	}
	var buf bytes.Buffer
	buf.WriteByte('$')
	for _, elem := range path {
		switch elem := elem.(type) {
		case string:
			if simplePathStrRe.MatchString(elem) {
				buf.WriteByte('.')
				buf.WriteString(elem)
			} else {
				buf.WriteByte('[')
				buf.WriteString(strconv.Quote(elem))
				buf.WriteByte(']')
			}
		case int:
			buf.WriteByte('[')
			buf.WriteString(strconv.Itoa(elem))
			buf.WriteByte(']')
		default:
			// a placeholder for a bad value
			buf.WriteString(".*")
		}
	}
	return buf.String()
}

type pathWithPos struct {
	Path  []any
	Index int
}

func (pp pathWithPos) isLast() bool {
	return pp.Index == len(pp.Path)-1
}

func GetPath(data any, path []any) (any, error) {
	return getPathInternal(data, pathWithPos{Path: path, Index: 0})
}

func getPathInternal(data any, pp pathWithPos) (any, error) {
	if data == nil {
		return nil, nil
	}
	if pp.Index >= len(pp.Path) {
		return data, nil
	}
	pathElemAny := pp.Path[pp.Index]
	switch pathElem := pathElemAny.(type) {
	case string:
		mapVal, ok := data.(map[string]any)
		if !ok {
			return nil, nil
		}
		return getPathInternal(mapVal[pathElem], pathWithPos{Path: pp.Path, Index: pp.Index + 1})
	case int:
		if pathElem < 0 {
			return nil, MakePathError("negative index", pp.Path, pp.Index)
		}
		arrVal, ok := data.([]any)
		if !ok {
			return nil, nil
		}
		if pathElem >= len(arrVal) {
			return nil, nil
		}
		return getPathInternal(arrVal[pathElem], pathWithPos{Path: pp.Path, Index: pp.Index + 1})
	default:
		return nil, MakePathTypeError(pp.Path, pp.Index)
	}
}

type CombiningFunc func(curValue any, newValue any, pp pathWithPos, opts SetPathOpts) (any, error)

type SetPathOpts struct {
	Budget    int // Budget 0 is unlimited (to set a 0 value, use -1)
	Force     bool
	Remove    bool
	CombineFn CombiningFunc
}

func SetPathNoErr(data any, path []any, value any, opts *SetPathOpts) any {
	ret, _ := SetPath(data, path, value, opts)
	return ret
}

func SetPath(data any, path []any, value any, opts *SetPathOpts) (any, error) {
	if opts == nil {
		opts = &SetPathOpts{}
	}
	if opts.Remove && opts.CombineFn != nil {
		return nil, fmt.Errorf("SetPath: Remove and CombineFn are mutually exclusive")
	}
	if opts.Remove && value != nil {
		return nil, fmt.Errorf("SetPath: Remove and value are mutually exclusive")
	}
	return setPathInternal(data, pathWithPos{Path: path, Index: 0}, value, *opts)
}

func checkAndModifyBudget(opts *SetPathOpts, pp pathWithPos, cost int) bool {
	if opts.Budget == 0 {
		return true
	}
	opts.Budget -= cost
	if opts.Budget < 0 {
		return false
	}
	if opts.Budget == 0 {
		// 0 is weird since it means unlimited, so we set it to -1 to fail the next operation
		opts.Budget = -1
	}
	return true
}

func CombineFn_ArrayAppend(data any, value any, pp pathWithPos, opts SetPathOpts) (any, error) {
	if !checkAndModifyBudget(&opts, pp, 1) {
		return nil, MakeBudgetError("trying to append to array", pp.Path, pp.Index)
	}
	if data == nil {
		data = make([]any, 0)
	}
	arrVal, ok := data.([]any)
	if !ok && !opts.Force {
		return nil, MakeSetTypeError(fmt.Sprintf("expected array, but got %T", data), pp.Path, pp.Index)
	}
	if !ok {
		arrVal = make([]any, 0)
	}
	arrVal = append(arrVal, value)
	return arrVal, nil
}

func CombineFn_SetUnless(data any, value any, pp pathWithPos, opts SetPathOpts) (any, error) {
	if data != nil {
		return data, nil
	}
	return value, nil
}

func CombineFn_Max(data any, value any, pp pathWithPos, opts SetPathOpts) (any, error) {
	valueFloat, ok := value.(float64)
	if !ok {
		return nil, MakeSetTypeError(fmt.Sprintf("expected float64, but got %T", value), pp.Path, pp.Index)
	}
	if data == nil {
		return value, nil
	}
	dataFloat, ok := data.(float64)
	if !ok && !opts.Force {
		return nil, MakeSetTypeError(fmt.Sprintf("expected float64, but got %T", data), pp.Path, pp.Index)
	}
	if !ok {
		return value, nil
	}
	if dataFloat > valueFloat {
		return data, nil
	}
	return value, nil
}

func CombineFn_Min(data any, value any, pp pathWithPos, opts SetPathOpts) (any, error) {
	valueFloat, ok := value.(float64)
	if !ok {
		return nil, MakeSetTypeError(fmt.Sprintf("expected float64, but got %T", value), pp.Path, pp.Index)
	}
	if data == nil {
		return value, nil
	}
	dataFloat, ok := data.(float64)
	if !ok && !opts.Force {
		return nil, MakeSetTypeError(fmt.Sprintf("expected float64, but got %T", data), pp.Path, pp.Index)
	}
	if !ok {
		return value, nil
	}
	if dataFloat < valueFloat {
		return data, nil
	}
	return value, nil
}

func CombineFn_Inc(data any, value any, pp pathWithPos, opts SetPathOpts) (any, error) {
	valueFloat, ok := value.(float64)
	if !ok {
		return nil, MakeSetTypeError(fmt.Sprintf("expected float64, but got %T", value), pp.Path, pp.Index)
	}
	if data == nil {
		return value, nil
	}
	dataFloat, ok := data.(float64)
	if !ok && !opts.Force {
		return nil, MakeSetTypeError(fmt.Sprintf("expected float64, but got %T", data), pp.Path, pp.Index)
	}
	if !ok {
		return value, nil
	}
	return dataFloat + valueFloat, nil
}

// force will clobber existing values that don't conform to path
// so SetPath(5, ["a"], 6 true) would return {"a": 6}
func setPathInternal(data any, pp pathWithPos, value any, opts SetPathOpts) (any, error) {
	if pp.Index >= len(pp.Path) {
		if opts.CombineFn != nil {
			return opts.CombineFn(data, value, pp, opts)
		}
		return value, nil
	}
	pathElemAny := pp.Path[pp.Index]
	switch pathElem := pathElemAny.(type) {
	case string:
		if data == nil {
			if opts.Remove {
				return nil, nil
			}
			data = make(map[string]any)
		}
		mapVal, ok := data.(map[string]any)
		if !ok && !opts.Force {
			return nil, MakeSetTypeError(fmt.Sprintf("expected map, but got %T", data), pp.Path, pp.Index)
		}
		if !ok {
			mapVal = make(map[string]any)
		}
		if opts.Remove && pp.isLast() {
			delete(mapVal, pathElem)
			if len(mapVal) == 0 {
				return nil, nil
			}
			return mapVal, nil
		}
		if _, ok := mapVal[pathElem]; !ok {
			if opts.Remove {
				return mapVal, nil
			}
			if !checkAndModifyBudget(&opts, pp, 1) {
				return nil, MakeBudgetError("trying to allocate map entry", pp.Path, pp.Index)
			}
		}
		newVal, err := setPathInternal(mapVal[pathElem], pathWithPos{Path: pp.Path, Index: pp.Index + 1}, value, opts)
		if opts.Remove && newVal == nil {
			delete(mapVal, pathElem)
			if len(mapVal) == 0 {
				return nil, nil
			}
			return mapVal, nil
		}
		mapVal[pathElem] = newVal
		return mapVal, err
	case int:
		if pathElem < 0 {
			return nil, MakePathError("negative index", pp.Path, pp.Index)
		}
		if data == nil {
			if opts.Remove {
				return nil, nil
			}
			if !checkAndModifyBudget(&opts, pp, pathElem+1) {
				return nil, MakeBudgetError(fmt.Sprintf("trying to allocate array with %d elements", pathElem+1), pp.Path, pp.Index)
			}
			data = make([]any, pathElem+1)
		}
		arrVal, ok := data.([]any)
		if !ok && !opts.Force {
			return nil, MakeSetTypeError(fmt.Sprintf("expected array, but got %T", data), pp.Path, pp.Index)
		}
		if !ok {
			if opts.Remove {
				return nil, nil
			}
			if !checkAndModifyBudget(&opts, pp, pathElem+1) {
				return nil, MakeBudgetError(fmt.Sprintf("trying to allocate array with %d elements", pathElem+1), pp.Path, pp.Index)
			}
			arrVal = make([]any, pathElem+1)
		}
		if opts.Remove && pp.isLast() {
			if pathElem == len(arrVal)-1 {
				arrVal = arrVal[:pathElem]
				if len(arrVal) == 0 {
					return nil, nil
				}
				return arrVal, nil
			}
			arrVal[pathElem] = nil
			return arrVal, nil
		}
		entriesToAdd := pathElem + 1 - len(arrVal)
		if opts.Remove && entriesToAdd > 0 {
			return nil, nil
		}
		if !checkAndModifyBudget(&opts, pp, entriesToAdd) {
			return nil, MakeBudgetError(fmt.Sprintf("trying to add %d elements to array", entriesToAdd), pp.Path, pp.Index)
		}
		for len(arrVal) <= pathElem {
			arrVal = append(arrVal, nil)
		}
		newVal, err := setPathInternal(arrVal[pathElem], pathWithPos{Path: pp.Path, Index: pp.Index + 1}, value, opts)
		if opts.Remove && newVal == nil && pathElem == len(arrVal)-1 {
			arrVal = arrVal[:pathElem]
			if len(arrVal) == 0 {
				return nil, nil
			}
			return arrVal, nil
		}
		arrVal[pathElem] = newVal
		return arrVal, err
	default:
		return nil, PathError{fmt.Sprintf("invalid path element type %T", pathElem)}
	}
}

func NormalizeNumbers(v any) any {
	switch v := v.(type) {
	case int:
		return float64(v)
	case float32:
		return float64(v)
	case int8:
		return float64(v)
	case int16:
		return float64(v)
	case int32:
		return float64(v)
	case int64:
		return float64(v)
	case uint:
		return float64(v)
	case uint8:
		return float64(v)
	case uint16:
		return float64(v)
	case uint32:
		return float64(v)
	case uint64:
		return float64(v)
	case []any:
		for i, elem := range v {
			v[i] = NormalizeNumbers(elem)
		}
	case map[string]any:
		for k, elem := range v {
			v[k] = NormalizeNumbers(elem)
		}
	}
	return v

}

func DeepEqual(v1 any, v2 any) bool {
	if v1 == nil && v2 == nil {
		return true
	}
	if v1 == nil || v2 == nil {
		return false
	}
	switch v1 := v1.(type) {
	case bool:
		v2, ok := v2.(bool)
		return ok && v1 == v2
	case float64:
		v2, ok := v2.(float64)
		return ok && v1 == v2
	case string:
		v2, ok := v2.(string)
		return ok && v1 == v2
	case []any:
		v2, ok := v2.([]any)
		if !ok || len(v1) != len(v2) {
			return false
		}
		for i := range v1 {
			if !DeepEqual(v1[i], v2[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		v2, ok := v2.(map[string]any)
		if !ok || len(v1) != len(v2) {
			return false
		}
		for k, v := range v1 {
			if !DeepEqual(v, v2[k]) {
				return false
			}
		}
		return true
	default:
		// invalid data type, so just return false
		return false
	}
}

func getCommandType(command map[string]any) string {
	typeVal, ok := command["type"]
	if !ok {
		return ""
	}
	typeStr, ok := typeVal.(string)
	if !ok {
		return ""
	}
	return typeStr
}

func getCommandPath(command map[string]any) []any {
	pathVal, ok := command["path"]
	if !ok {
		return nil
	}
	path, ok := pathVal.([]any)
	if !ok {
		return nil
	}
	return path
}

func ApplyCommand(data any, command any, budget int) (any, error) {
	mapVal, ok := command.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("ApplyCommand: expected map, but got %T", command)
	}
	commandType := getCommandType(mapVal)
	if commandType == "" {
		return nil, fmt.Errorf("ApplyCommand: missing type field")
	}
	switch commandType {
	case SetCommandStr:
		path := getCommandPath(mapVal)
		return SetPath(data, path, mapVal["data"], &SetPathOpts{Budget: budget})
	case DelCommandStr:
		path := getCommandPath(mapVal)
		return SetPath(data, path, nil, &SetPathOpts{Remove: true, Budget: budget})
	case AppendCommandStr:
		path := getCommandPath(mapVal)
		return SetPath(data, path, mapVal["data"], &SetPathOpts{CombineFn: CombineFn_ArrayAppend, Budget: budget})
	default:
		return nil, fmt.Errorf("ApplyCommand: unknown command type %q", commandType)
	}
}
