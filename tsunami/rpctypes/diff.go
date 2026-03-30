// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpctypes

import (
	"fmt"
	"reflect"
	"sort"

	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// Json is any JSON-compatible value
type Json = any

// Path is string | number | []any
type Path = any

// Diff is a list of Ops applied to a map/object
type Diff []Op

// Op represents a single diff operation on a map/object.
// Exactly one logical operation per Op:
//
//	{p, v}   - set/replace value at path
//	{p, d}   - recursive patch at path
//	{p, del} - delete key at path
//	{p, a}   - array diff at path
type Op struct {
	Path Path  `json:"p,omitempty"`
	Val  any   `json:"v,omitempty"`
	Diff Diff  `json:"d,omitempty"`
	Del  bool  `json:"del,omitempty"`
	Arr  []any `json:"a,omitempty"` // []ArrayInsertOp | []ArrayDeleteOp | []ArrayReplaceOp | []ArrayPatchOp | []ArraySwapOp
}

// Array ops -- must be emitted in phase order:
//
//	Phase 1 (original index space, ordered by index): ArrayInsertOp, ArrayDeleteOp
//	Phase 2 (new index space): ArrayReplaceOp, ArrayPatchOp, ArraySwapOp
type ArrayInsertOp struct {
	Idx int `json:"i"`
	Val any `json:"v"`
}

type ArrayDeleteOp struct {
	Idx int `json:"x"`
}

type ArrayReplaceOp struct {
	Idx int `json:"r"`
	Val any `json:"v"`
}

type ArrayPatchOp struct {
	Idx  int  `json:"p"`
	Diff Diff `json:"d"`
}

type ArraySwapOp struct {
	Indices []int `json:"s"` // pairs: [from, to, from, to, ...]
}

// ChildrenInsertOp is the only children-specific op type.
// Delete and swap reuse ArrayDeleteOp and ArraySwapOp.
// No replace or patch -- child updates are separate NodePatches.
type ChildrenInsertOp struct {
	Idx int          `json:"i"`
	Val RenderedElem `json:"v"`
}

type ElemPatch struct {
	Id       string `json:"id"`
	Props    Diff   `json:"props,omitempty"`
	Children []any  `json:"children,omitempty"` // []ChildrenInsertOp | []ArrayDeleteOp | []ArraySwapOp
}

type VDomPatch []ElemPatch

type childMatch struct {
	oldIdx  int
	newIdx  int
	newElem *RenderedElem
}

func DiffRenderedElems(oldElem, newElem *RenderedElem) VDomPatch {
	if oldElem == nil || newElem == nil || newElem.WaveId == "" {
		return nil
	}
	oldIndex := make(map[string]*RenderedElem)
	indexRenderedElem(oldElem, oldIndex)
	if oldIndex[newElem.WaveId] == nil {
		return nil
	}
	var patch VDomPatch
	diffRenderedElemWalk(oldIndex, newElem, &patch)
	return patch
}

func indexRenderedElem(elem *RenderedElem, index map[string]*RenderedElem) {
	if elem == nil {
		return
	}
	if elem.WaveId != "" {
		index[elem.WaveId] = elem
	}
	for idx := range elem.Children {
		indexRenderedElem(&elem.Children[idx], index)
	}
}

func diffRenderedElemWalk(oldIndex map[string]*RenderedElem, newElem *RenderedElem, patch *VDomPatch) {
	if newElem == nil || newElem.WaveId == "" {
		return
	}
	oldElem := oldIndex[newElem.WaveId]
	if oldElem == nil || oldElem.Tag != newElem.Tag {
		return
	}
	childrenOps, matchedChildren := diffRenderedChildren(oldElem.Children, newElem.Children)
	elemPatch := ElemPatch{
		Id:       newElem.WaveId,
		Props:    DiffJson(oldElem.Props, newElem.Props, nil),
		Children: childrenOps,
	}
	if len(elemPatch.Props) != 0 || len(elemPatch.Children) != 0 {
		*patch = append(*patch, elemPatch)
	}
	for _, match := range matchedChildren {
		diffRenderedElemWalk(oldIndex, match.newElem, patch)
	}
}

func DiffJson(old, new any, path Path) []Op {
	return diffJson(old, new, pathToSegments(path))
}

func diffJson(old, new any, path []any) []Op {
	if jsonDeepEqual(old, new) {
		return nil
	}
	oldMap, oldIsMap := old.(map[string]any)
	newMap, newIsMap := new.(map[string]any)
	if oldIsMap && newIsMap {
		return diffJsonMap(oldMap, newMap, path)
	}
	oldArr, oldIsArr := old.([]any)
	newArr, newIsArr := new.([]any)
	if oldIsArr && newIsArr && arrayHasKeys(oldArr) && arrayHasKeys(newArr) {
		arrOps := diffArray(oldArr, newArr)
		if len(arrOps) == 0 {
			return nil
		}
		return Diff{{Path: pathFromSegments(path), Arr: arrOps}}
	}
	return Diff{{Path: pathFromSegments(path), Val: new}}
}

func diffJsonMap(oldMap, newMap map[string]any, path []any) []Op {
	var diff Diff
	oldKeys := sortedMapKeys(oldMap)
	newKeys := sortedMapKeys(newMap)
	for _, key := range oldKeys {
		if _, ok := newMap[key]; ok {
			continue
		}
		diff = append(diff, Op{Path: pathFromSegments(appendPath(path, key)), Del: true})
	}
	for _, key := range newKeys {
		if _, ok := oldMap[key]; ok {
			continue
		}
		diff = append(diff, Op{Path: pathFromSegments(appendPath(path, key)), Val: newMap[key]})
	}
	for _, key := range intersectSortedKeys(oldKeys, newKeys) {
		diff = append(diff, diffJson(oldMap[key], newMap[key], appendPath(path, key))...)
	}
	return diff
}

func diffArray(oldArr, newArr []any) []any {
	matches, oldMatched, newMatched := matchKeyedArrayElems(oldArr, newArr)
	var ops []any
	ops = append(ops, buildPhase1ArrayOps(oldArr, newArr, matches, oldMatched, newMatched)...)

	matchesByNew := append([]childMatch(nil), matches...)
	sort.Slice(matchesByNew, func(i, j int) bool {
		return matchesByNew[i].newIdx < matchesByNew[j].newIdx
	})
	for _, match := range matchesByNew {
		diff := DiffJson(oldArr[match.oldIdx], newArr[match.newIdx], nil)
		if len(diff) == 0 {
			continue
		}
		if isRootReplaceDiff(diff) {
			ops = append(ops, ArrayReplaceOp{Idx: match.newIdx, Val: newArr[match.newIdx]})
			continue
		}
		ops = append(ops, ArrayPatchOp{Idx: match.newIdx, Diff: diff})
	}
	if swap := buildArraySwapOp(matches); len(swap.Indices) != 0 {
		ops = append(ops, swap)
	}
	return ops
}

func diffRenderedChildren(oldChildren, newChildren []RenderedElem) ([]any, []childMatch) {
	oldBuckets := make(map[string][]int)
	for idx := range oldChildren {
		key := renderedChildKey(oldChildren[idx], idx)
		oldBuckets[key] = append(oldBuckets[key], idx)
	}

	var matches []childMatch
	oldMatched := make(map[int]bool)
	newMatched := make(map[int]bool)
	for newIdx := range newChildren {
		key := renderedChildKey(newChildren[newIdx], newIdx)
		oldIndices := oldBuckets[key]
		if len(oldIndices) == 0 {
			continue
		}
		oldIdx := oldIndices[0]
		oldBuckets[key] = oldIndices[1:]
		if !renderedChildrenMatch(&oldChildren[oldIdx], &newChildren[newIdx]) {
			continue
		}
		matches = append(matches, childMatch{
			oldIdx:  oldIdx,
			newIdx:  newIdx,
			newElem: &newChildren[newIdx],
		})
		oldMatched[oldIdx] = true
		newMatched[newIdx] = true
	}

	var ops []any
	ops = append(ops, buildPhase1ChildOps(oldChildren, newChildren, matches, oldMatched, newMatched)...)
	if swap := buildArraySwapOp(matches); len(swap.Indices) != 0 {
		ops = append(ops, swap)
	}

	matchesByNew := append([]childMatch(nil), matches...)
	sort.Slice(matchesByNew, func(i, j int) bool {
		return matchesByNew[i].newIdx < matchesByNew[j].newIdx
	})
	return ops, matchesByNew
}

func matchKeyedArrayElems(oldArr, newArr []any) ([]childMatch, map[int]bool, map[int]bool) {
	oldBuckets := make(map[string][]int)
	for idx, value := range oldArr {
		key, ok := jsonArrayElemKey(value)
		if !ok {
			continue
		}
		oldBuckets[key] = append(oldBuckets[key], idx)
	}

	var matches []childMatch
	oldMatched := make(map[int]bool)
	newMatched := make(map[int]bool)
	for newIdx, value := range newArr {
		key, ok := jsonArrayElemKey(value)
		if !ok {
			continue
		}
		oldIndices := oldBuckets[key]
		if len(oldIndices) == 0 {
			continue
		}
		oldIdx := oldIndices[0]
		oldBuckets[key] = oldIndices[1:]
		matches = append(matches, childMatch{oldIdx: oldIdx, newIdx: newIdx})
		oldMatched[oldIdx] = true
		newMatched[newIdx] = true
	}
	return matches, oldMatched, newMatched
}

func buildPhase1ArrayOps(oldArr, newArr []any, matches []childMatch, oldMatched, newMatched map[int]bool) []any {
	insertions, deletions := computePhase1ArrayChanges(len(oldArr), len(newArr), matches, oldMatched, newMatched)
	var ops []any
	for idx := 0; idx <= len(oldArr); idx++ {
		for _, newIdx := range insertions[idx] {
			ops = append(ops, ArrayInsertOp{Idx: idx, Val: newArr[newIdx]})
		}
		if idx < len(oldArr) && deletions[idx] {
			ops = append(ops, ArrayDeleteOp{Idx: idx})
		}
	}
	return ops
}

func buildPhase1ChildOps(oldChildren, newChildren []RenderedElem, matches []childMatch, oldMatched, newMatched map[int]bool) []any {
	insertions, deletions := computePhase1ArrayChanges(len(oldChildren), len(newChildren), matches, oldMatched, newMatched)
	var ops []any
	for idx := 0; idx <= len(oldChildren); idx++ {
		for _, newIdx := range insertions[idx] {
			ops = append(ops, ChildrenInsertOp{Idx: idx, Val: newChildren[newIdx]})
		}
		if idx < len(oldChildren) && deletions[idx] {
			ops = append(ops, ArrayDeleteOp{Idx: idx})
		}
	}
	return ops
}

func computePhase1ArrayChanges(oldLen, newLen int, matches []childMatch, oldMatched, newMatched map[int]bool) (map[int][]int, map[int]bool) {
	insertions := make(map[int][]int)
	deletions := make(map[int]bool)

	matchesByOld := append([]childMatch(nil), matches...)
	sort.Slice(matchesByOld, func(i, j int) bool {
		return matchesByOld[i].oldIdx < matchesByOld[j].oldIdx
	})

	oldPtr := 0
	oldCursor := 0
	for newIdx := 0; newIdx < newLen; newIdx++ {
		if newMatched[newIdx] {
			if oldCursor < len(matchesByOld) {
				oldPtr = matchesByOld[oldCursor].oldIdx + 1
				oldCursor++
			}
			continue
		}
		insertions[oldPtr] = append(insertions[oldPtr], newIdx)
	}

	for oldIdx := 0; oldIdx < oldLen; oldIdx++ {
		if oldMatched[oldIdx] {
			continue
		}
		deletions[oldIdx] = true
	}
	return insertions, deletions
}

func buildArraySwapOp(matches []childMatch) ArraySwapOp {
	if len(matches) < 2 {
		return ArraySwapOp{}
	}
	matchesByOld := append([]childMatch(nil), matches...)
	sort.Slice(matchesByOld, func(i, j int) bool {
		return matchesByOld[i].oldIdx < matchesByOld[j].oldIdx
	})
	matchesByNew := append([]childMatch(nil), matches...)
	sort.Slice(matchesByNew, func(i, j int) bool {
		return matchesByNew[i].newIdx < matchesByNew[j].newIdx
	})

	current := make([]string, 0, len(matches))
	target := make([]string, 0, len(matches))
	indices := make([]int, 0, len(matches))
	for _, match := range matchesByOld {
		current = append(current, fmt.Sprintf("o:%d", match.oldIdx))
	}
	for _, match := range matchesByNew {
		target = append(target, fmt.Sprintf("o:%d", match.oldIdx))
		indices = append(indices, match.newIdx)
	}
	swapIndices := buildSwapIndices(current, target, indices)
	if len(swapIndices) == 0 {
		return ArraySwapOp{}
	}
	return ArraySwapOp{Indices: swapIndices}
}

func buildSwapIndices(current, target []string, fullIndices []int) []int {
	if len(current) != len(target) || len(current) != len(fullIndices) {
		return nil
	}
	currentCopy := append([]string(nil), current...)
	posMap := make(map[string]int)
	for idx, key := range currentCopy {
		posMap[key] = idx
	}

	var swaps []int
	for idx, want := range target {
		if currentCopy[idx] == want {
			continue
		}
		swapIdx := posMap[want]
		swaps = append(swaps, fullIndices[idx], fullIndices[swapIdx])
		curKey := currentCopy[idx]
		currentCopy[idx], currentCopy[swapIdx] = currentCopy[swapIdx], currentCopy[idx]
		posMap[curKey] = swapIdx
		posMap[want] = idx
	}
	return swaps
}

func renderedChildKey(elem RenderedElem, idx int) string {
	if elem.Props != nil {
		if keyVal, ok := elem.Props[vdom.KeyPropKey]; ok {
			return fmt.Sprintf("key:%v", keyVal)
		}
	}
	return fmt.Sprintf("idx:%s:%d", elem.Tag, idx)
}

func renderedChildrenMatch(oldElem, newElem *RenderedElem) bool {
	if oldElem == nil || newElem == nil {
		return false
	}
	if oldElem.Tag == vdom.TextTag || newElem.Tag == vdom.TextTag {
		return oldElem.Tag == vdom.TextTag && newElem.Tag == vdom.TextTag && oldElem.Text == newElem.Text
	}
	if oldElem.WaveId == "" || newElem.WaveId == "" {
		return false
	}
	return oldElem.WaveId == newElem.WaveId && oldElem.Tag == newElem.Tag
}

func arrayHasKeys(arr []any) bool {
	for _, value := range arr {
		if _, ok := jsonArrayElemKey(value); !ok {
			return false
		}
	}
	return true
}

func jsonArrayElemKey(value any) (string, bool) {
	m, ok := value.(map[string]any)
	if !ok {
		return "", false
	}
	if idVal, ok := m["id"]; ok {
		return fmt.Sprintf("id:%v", idVal), true
	}
	if keyVal, ok := m["key"]; ok {
		return fmt.Sprintf("key:%v", keyVal), true
	}
	return "", false
}

func jsonDeepEqual(old, new any) bool {
	if old == nil || new == nil {
		return old == nil && new == nil
	}
	if util.IsNumericType(old) && util.IsNumericType(new) {
		return util.CompareAsFloat64(old, new)
	}
	oldMap, oldIsMap := old.(map[string]any)
	newMap, newIsMap := new.(map[string]any)
	if oldIsMap || newIsMap {
		if !oldIsMap || !newIsMap || len(oldMap) != len(newMap) {
			return false
		}
		for key, oldVal := range oldMap {
			newVal, ok := newMap[key]
			if !ok || !jsonDeepEqual(oldVal, newVal) {
				return false
			}
		}
		return true
	}
	oldArr, oldIsArr := old.([]any)
	newArr, newIsArr := new.([]any)
	if oldIsArr || newIsArr {
		if !oldIsArr || !newIsArr || len(oldArr) != len(newArr) {
			return false
		}
		for idx := range oldArr {
			if !jsonDeepEqual(oldArr[idx], newArr[idx]) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(old, new)
}

func pathToSegments(path Path) []any {
	switch val := path.(type) {
	case nil:
		return nil
	case []any:
		return append([]any(nil), val...)
	default:
		return []any{val}
	}
}

func appendPath(path []any, segment any) []any {
	newPath := make([]any, len(path)+1)
	copy(newPath, path)
	newPath[len(path)] = segment
	return newPath
}

func pathFromSegments(path []any) Path {
	switch len(path) {
	case 0:
		return nil
	case 1:
		return path[0]
	default:
		pathCopy := make([]any, len(path))
		copy(pathCopy, path)
		return pathCopy
	}
}

func sortedMapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func intersectSortedKeys(oldKeys, newKeys []string) []string {
	var keys []string
	oldPos := 0
	newPos := 0
	for oldPos < len(oldKeys) && newPos < len(newKeys) {
		switch {
		case oldKeys[oldPos] == newKeys[newPos]:
			keys = append(keys, oldKeys[oldPos])
			oldPos++
			newPos++
		case oldKeys[oldPos] < newKeys[newPos]:
			oldPos++
		default:
			newPos++
		}
	}
	return keys
}

func isRootReplaceDiff(diff Diff) bool {
	if len(diff) != 1 {
		return false
	}
	op := diff[0]
	return op.Path == nil && !op.Del && len(op.Diff) == 0 && len(op.Arr) == 0
}
