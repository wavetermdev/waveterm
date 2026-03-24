// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpctypes

import (
	"reflect"
	"testing"
)

func TestDiffRenderedElemsPropsAndArrayDiff(t *testing.T) {
	oldElem := &RenderedElem{
		WaveId: "root",
		Tag:    "div",
		Props: map[string]any{
			"class": "old",
			"items": []any{
				map[string]any{"id": "a", "label": "A"},
				map[string]any{"id": "b", "label": "B"},
			},
			"meta":   map[string]any{"enabled": true},
			"remove": "gone",
		},
	}
	newElem := &RenderedElem{
		WaveId: "root",
		Tag:    "div",
		Props: map[string]any{
			"class": "new",
			"items": []any{
				map[string]any{"id": "b", "label": "Bee"},
				map[string]any{"id": "a", "label": "A"},
				map[string]any{"id": "c", "label": "C"},
			},
			"meta": map[string]any{"enabled": false, "extra": "x"},
		},
	}

	patch := DiffRenderedElems(oldElem, newElem)
	expected := VDomPatch{
		{
			Id: "root",
			Props: Diff{
				{Path: "remove", Del: true},
				{Path: "class", Val: "new"},
				{Path: "items", Arr: []any{
					ArrayInsertOp{Idx: 2, Val: map[string]any{"id": "c", "label": "C"}},
					ArrayPatchOp{Idx: 0, Diff: Diff{{Path: "label", Val: "Bee"}}},
					ArraySwapOp{Indices: []int{0, 1}},
				}},
				{Path: []any{"meta", "extra"}, Val: "x"},
				{Path: []any{"meta", "enabled"}, Val: false},
			},
		},
	}

	if !reflect.DeepEqual(patch, expected) {
		t.Fatalf("patch mismatch\nactual: %#v\nexpected: %#v", patch, expected)
	}
}

func TestDiffRenderedElemsChildrenOpsStayFlat(t *testing.T) {
	oldElem := &RenderedElem{
		WaveId: "root",
		Tag:    "div",
		Children: []RenderedElem{
			{WaveId: "a", Tag: "div", Props: map[string]any{"key": "a"}},
			{WaveId: "b", Tag: "div", Props: map[string]any{"key": "b", "label": "old"}},
			{WaveId: "c", Tag: "div", Props: map[string]any{"key": "c"}},
		},
	}
	inserted := RenderedElem{
		WaveId: "x",
		Tag:    "div",
		Props:  map[string]any{"key": "x"},
		Children: []RenderedElem{
			{WaveId: "x-child", Tag: "span", Props: map[string]any{"label": "nested"}},
		},
	}
	newElem := &RenderedElem{
		WaveId: "root",
		Tag:    "div",
		Children: []RenderedElem{
			{WaveId: "b", Tag: "div", Props: map[string]any{"key": "b", "label": "new"}},
			inserted,
			{WaveId: "a", Tag: "div", Props: map[string]any{"key": "a"}},
		},
	}

	patch := DiffRenderedElems(oldElem, newElem)
	expected := VDomPatch{
		{
			Id: "root",
			Children: []any{
				ChildrenInsertOp{Idx: 1, Val: inserted},
				ArrayDeleteOp{Idx: 2},
				ArraySwapOp{Indices: []int{0, 2}},
			},
		},
		{
			Id:    "b",
			Props: Diff{{Path: "label", Val: "new"}},
		},
	}

	if !reflect.DeepEqual(patch, expected) {
		t.Fatalf("patch mismatch\nactual: %#v\nexpected: %#v", patch, expected)
	}
}

func TestDiffRenderedElemsTextChildrenAreOpaque(t *testing.T) {
	oldElem := &RenderedElem{
		WaveId: "root",
		Tag:    "div",
		Children: []RenderedElem{
			{Tag: "#text", Text: "old"},
		},
	}
	newElem := &RenderedElem{
		WaveId: "root",
		Tag:    "div",
		Children: []RenderedElem{
			{Tag: "#text", Text: "new"},
		},
	}

	patch := DiffRenderedElems(oldElem, newElem)
	expected := VDomPatch{
		{
			Id: "root",
			Children: []any{
				ChildrenInsertOp{Idx: 0, Val: RenderedElem{Tag: "#text", Text: "new"}},
				ArrayDeleteOp{Idx: 0},
			},
		},
	}

	if !reflect.DeepEqual(patch, expected) {
		t.Fatalf("patch mismatch\nactual: %#v\nexpected: %#v", patch, expected)
	}
}
