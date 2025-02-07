package iterfn

import (
	"cmp"
	"iter"
	"maps"
	"slices"
)

func CollectSeqToSorted[T cmp.Ordered](seq iter.Seq[T]) []T {
	rtn := []T{}
	for v := range seq {
		rtn = append(rtn, v)
	}
	slices.Sort(rtn)
	return rtn
}

func CollectSeq[T any](seq iter.Seq[T]) []T {
	rtn := []T{}
	for v := range seq {
		rtn = append(rtn, v)
	}
	return rtn
}

func MapKeysToSorted[K cmp.Ordered, V any](m map[K]V) []K {
	return CollectSeqToSorted(maps.Keys(m))
}
