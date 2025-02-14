package iterfn_test

import (
	"maps"
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/iterfn"
)

func TestCollectSeqToSorted(t *testing.T) {
	t.Parallel()

	// Test code here
	m := map[int]struct{}{1: {}, 3: {}, 2: {}}
	got := iterfn.CollectSeqToSorted(maps.Keys(m))
	want := []int{1, 2, 3}
	if !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestCollectSeq(t *testing.T) {
	t.Parallel()

	// Test code here
	m := map[int]struct{}{1: {}, 3: {}, 2: {}}
	got := iterfn.CollectSeq(maps.Keys(m))
	i := 0
	for _, v := range got {
		if _, ok := m[v]; !ok {
			t.Errorf("collected value %v not in original map", v)
		}
		i++
	}
	if i != len(m) {
		t.Errorf("collected array length %v, want %v", i, len(m))
	}
}

func TestMapKeysToSorted(t *testing.T) {
	t.Parallel()

	// Test code here
	m := map[int]struct{}{1: {}, 3: {}, 2: {}}
	got := iterfn.MapKeysToSorted(m)
	want := []int{1, 2, 3}
	if !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}
