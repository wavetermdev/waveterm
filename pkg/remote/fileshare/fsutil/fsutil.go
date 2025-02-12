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
    if hostAndPath == "" || hostAndPath == "/" {
        return "/"
    }
    
    // Remove trailing slash if present
    if strings.HasSuffix(hostAndPath, "/") {
        hostAndPath = hostAndPath[:len(hostAndPath)-1]
    }
    
    lastSlash := strings.LastIndex(hostAndPath, "/")
    if lastSlash <= 0 {
        return "/"
    }
    return hostAndPath[:lastSlash+1]
}

const minURILength = 10 // Minimum length for a valid URI (e.g., "s3://bucket")

func GetPathPrefix(conn *connparse.Connection) string {
	fullUri := conn.GetFullURI()
	if fullUri == "" {
		return ""
	}
	pathPrefix := fullUri
	lastSlash := strings.LastIndex(fullUri, "/")
	if lastSlash > minURILength && lastSlash < len(fullUri)-1 {
		pathPrefix = fullUri[:lastSlash+1]
	}
	return pathPrefix
}
