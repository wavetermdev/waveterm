package fspath

import (
	pathpkg "path"
	"strings"
)

const (
	// Separator is the path separator
	Separator = "/"
)

func Dir(path string) string {
	return pathpkg.Dir(ToSlash(path))
}

func Base(path string) string {
	return pathpkg.Base(ToSlash(path))
}

func Join(elem ...string) string {
	joined := pathpkg.Join(elem...)
	return ToSlash(joined)
}

func ToSlash(path string) string {
	return strings.ReplaceAll(path, "\\", Separator)
}
