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

// FirstLevelDir returns the first level directory of a path and a boolean indicating if the path has more than one level.
func FirstLevelDir(path string) (string, bool) {
	if strings.Count(path, Separator) > 0 {
		path = strings.SplitN(path, Separator, 2)[0]
		return path, true
	}
	return path, false
}

// FirstLevelDirPrefix returns the first level directory of a path with a prefix and a boolean indicating if the path has more than one level.
func FirstLevelDirPrefix(path, prefix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	path, hasMoreLevels := FirstLevelDir(strings.TrimPrefix(path, prefix))
	return Join(prefix, path), hasMoreLevels
}

func ToSlash(path string) string {
	return strings.ReplaceAll(path, "\\", Separator)
}
