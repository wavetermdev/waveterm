package base

import "strings"

type OptsIter struct {
	Pos  int
	Opts []string
}

func MakeOptsIter(opts []string) *OptsIter {
	return &OptsIter{Opts: opts}
}

func IsOption(argStr string) bool {
	return strings.HasPrefix(argStr, "-") && argStr != "-" && !strings.HasPrefix(argStr, "-/")
}

func (iter *OptsIter) HasNext() bool {
	return iter.Pos <= len(iter.Opts)-1
}

func (iter *OptsIter) IsNextPlain() bool {
	if !iter.HasNext() {
		return false
	}
	return !IsOption(iter.Opts[iter.Pos])
}

func (iter *OptsIter) Next() string {
	if iter.Pos >= len(iter.Opts) {
		return ""
	}
	rtn := iter.Opts[iter.Pos]
	iter.Pos++
	return rtn
}

func (iter *OptsIter) Current() string {
	if iter.Pos == 0 {
		return ""
	}
	return iter.Opts[iter.Pos-1]
}

func (iter *OptsIter) Rest() []string {
	return iter.Opts[iter.Pos:]
}
