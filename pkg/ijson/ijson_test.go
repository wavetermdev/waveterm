// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ijson

import "testing"

func TestDeepEqual(t *testing.T) {
	if !DeepEqual(float64(1), float64(1)) {
		t.Errorf("DeepEqual(1, 1) should be true")
	}
	if DeepEqual(float64(1), float64(2)) {
		t.Errorf("DeepEqual(1, 2) should be false")
	}
	if !DeepEqual([]any{"a", 2.8, true, map[string]any{"c": 1.1}}, []any{"a", 2.8, true, map[string]any{"c": 1.1}}) {
		t.Errorf("DeepEqual complex should be true")
	}
}

func TestGetPath(t *testing.T) {
	data := []any{"a", 2.8, true, map[string]any{"c": 1.1}}

	rtn, err := GetPath(data, []any{0})
	if err != nil {
		t.Errorf("GetPath failed: %v", err)
	}
	if rtn != "a" {
		t.Errorf("GetPath failed: %v", rtn)
	}

	rtn, err = GetPath(data, []any{50})
	if err != nil {
		t.Errorf("GetPath failed: %v", err)
	}
	if rtn != nil {
		t.Errorf("GetPath failed: %v", rtn)
	}

	rtn, err = GetPath(data, []any{3, "c"})
	if err != nil {
		t.Errorf("GetPath failed: %v", err)
	}
	if rtn != 1.1 {
		t.Errorf("GetPath failed: %v", rtn)
	}
}

func makeValue() any {
	return []any{"a", 2.8, true, map[string]any{"c": 1.1}}
}

func TestSetPath(t *testing.T) {
	rtn, err := SetPath(makeValue(), []any{0}, "b", nil)
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if rtn.([]any)[0] != "b" {
		t.Errorf("SetPath failed: %v", rtn)
	}
	rtn, err = SetPath(makeValue(), []any{10}, "b", nil)
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if len(rtn.([]any)) != 11 {
		t.Errorf("SetPath failed: %v", rtn)
	}
	rtn, _ = GetPath(rtn, []any{10})
	if rtn != "b" {
		t.Errorf("SetPath failed: %v", rtn)
	}
	_, err = SetPath(makeValue(), []any{"a"}, "b", nil)
	if err == nil {
		t.Errorf("SetPath should have failed")
	}
	rtn, err = SetPath(makeValue(), []any{"a"}, "b", &SetPathOpts{Force: true})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if !DeepEqual(rtn, map[string]any{"a": "b"}) {
		t.Errorf("SetPath failed: %v", rtn)
	}
	rtn, err = SetPath(makeValue(), nil, "c", &SetPathOpts{CombineFn: CombineFn_ArrayAppend})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if !DeepEqual(rtn, []any{"a", 2.8, true, map[string]any{"c": 1.1}, "c"}) {
		t.Errorf("SetPath failed: %v", rtn)
	}
	_, err = SetPath(makeValue(), nil, "c", &SetPathOpts{CombineFn: CombineFn_ArrayAppend, Budget: -1})
	if err == nil {
		t.Errorf("SetPath should have failed")
	}
	rtn, err = SetPath(makeValue(), []any{5000}, "c", nil)
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if len(rtn.([]any)) != 5001 {
		t.Errorf("SetPath failed: %v", rtn)
	}
	_, err = SetPath(makeValue(), []any{5000}, "c", &SetPathOpts{Budget: 1000})
	if err == nil {
		t.Errorf("SetPath should have failed")
	}
	rtn, err = SetPath(makeValue(), []any{3, "c"}, nil, &SetPathOpts{Remove: true})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if !DeepEqual(rtn, []any{"a", 2.8, true}) {
		t.Errorf("SetPath failed: %v", rtn)
	}
	rtn, _ = SetPath(makeValue(), []any{3}, nil, &SetPathOpts{Remove: true})
	rtn, _ = SetPath(rtn, []any{2}, nil, &SetPathOpts{Remove: true})
	rtn, _ = SetPath(rtn, []any{1}, nil, &SetPathOpts{Remove: true})
	rtn, _ = SetPath(rtn, []any{0}, nil, &SetPathOpts{Remove: true})
	if rtn != nil {
		t.Errorf("SetPath failed: %v", rtn)
	}
	rtn, err = SetPath(makeValue(), []any{3, "d"}, 2.2, nil)
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if !DeepEqual(rtn, []any{"a", 2.8, true, map[string]any{"c": 1.1, "d": 2.2}}) {
		t.Errorf("SetPath failed: %v", rtn)
	}

	rtn, err = SetPath(makeValue(), []any{1}, 2.2, &SetPathOpts{CombineFn: CombineFn_Inc})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if !DeepEqual(rtn, []any{"a", 5.0, true, map[string]any{"c": 1.1}}) {
		t.Errorf("SetPath failed: %v", rtn)
	}

	rtn, err = SetPath(makeValue(), []any{1}, 500.0, &SetPathOpts{CombineFn: CombineFn_Min})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if rtn.([]any)[1] != 2.8 {
		t.Errorf("SetPath failed: %v", rtn)
	}

	rtn, err = SetPath(makeValue(), []any{1}, 500.0, &SetPathOpts{CombineFn: CombineFn_Max})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if rtn.([]any)[1] != 500.0 {
		t.Errorf("SetPath failed: %v", rtn)
	}

	rtn, err = SetPath(makeValue(), []any{1}, 500.0, &SetPathOpts{CombineFn: CombineFn_SetUnless})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if rtn.([]any)[1] != 2.8 {
		t.Errorf("SetPath failed: %v", rtn)
	}
	rtn, err = SetPath(makeValue(), []any{8}, 500.0, &SetPathOpts{CombineFn: CombineFn_SetUnless})
	if err != nil {
		t.Errorf("SetPath failed: %v", err)
	}
	if rtn.([]any)[8] != 500.0 {
		t.Errorf("SetPath failed: %v", rtn)
	}
}
