package fsutil

import (
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
)

var slashRe = regexp.MustCompile(`/`)

func GetParentPath(conn *connparse.Connection) string {
	hostAndPath := conn.GetPathWithHost()
	return GetParentPathString(hostAndPath)
}

func GetParentPathString(hostAndPath string) string {
	parentPath := "/"
	slashIndices := slashRe.FindAllStringIndex(hostAndPath, -1)
	if slashIndices != nil && len(slashIndices) > 0 {
		if slashIndices[len(slashIndices)-1][0] != len(hostAndPath)-1 {
			parentPath = hostAndPath[:slashIndices[len(slashIndices)-1][0]+1]
		} else if len(slashIndices) > 1 {
			parentPath = hostAndPath[:slashIndices[len(slashIndices)-2][0]+1]
		}
	}
	return parentPath
}

func GetPathPrefix(conn *connparse.Connection) string {
	fullUri := conn.GetFullURI()
	pathPrefix := fullUri
	lastSlash := strings.LastIndex(fullUri, "/")
	if lastSlash > 10 && lastSlash < len(fullUri)-1 {
		pathPrefix = fullUri[:lastSlash+1]
	}
	return pathPrefix
}
