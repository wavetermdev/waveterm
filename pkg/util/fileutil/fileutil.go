package fileutil

import (
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func FixPath(path string) (string, error) {
	if strings.HasPrefix(path, "~") {
		return filepath.Join(wavebase.GetHomeDir(), path[1:]), nil
	} else if !filepath.IsAbs(path) {
		log.Printf("FixPath: path is not absolute: %s", path)
		path, err := filepath.Abs(path)
		if err != nil {
			return "", err
		}
		log.Printf("FixPath: fixed path: %s", path)
		return path, nil
	} else {
		return path, nil
	}
}

const (
	winFlagSoftlink = uint32(0x8000) // FILE_ATTRIBUTE_REPARSE_POINT
	winFlagJunction = uint32(0x80)   // FILE_ATTRIBUTE_JUNCTION
)

func WinSymlinkDir(path string, bits os.FileMode) bool {
	// Windows compatibility layer doesn't expose symlink target type through fileInfo
	// so we need to check file attributes and extension patterns
	isFileSymlink := func(filepath string) bool {
		if len(filepath) == 0 {
			return false
		}
		return strings.LastIndex(filepath, ".") > strings.LastIndex(filepath, "/")
	}

	flags := uint32(bits >> 12)

	if flags == winFlagSoftlink {
		return !isFileSymlink(path)
	} else if flags == winFlagJunction {
		return true
	} else {
		return false
	}
}

// on error just returns ""
// does not return "application/octet-stream" as this is considered a detection failure
// can pass an existing fileInfo to avoid re-statting the file
// falls back to text/plain for 0 byte files

func DetectMimeType(path string, fileInfo fs.FileInfo, extended bool) string {
	if fileInfo == nil {
		statRtn, err := os.Stat(path)
		if err != nil {
			return ""
		}
		fileInfo = statRtn
	}

	if fileInfo.IsDir() || WinSymlinkDir(path, fileInfo.Mode()) {
		return "directory"
	}
	if fileInfo.Mode()&os.ModeNamedPipe == os.ModeNamedPipe {
		return "pipe"
	}
	charDevice := os.ModeDevice | os.ModeCharDevice
	if fileInfo.Mode()&charDevice == charDevice {
		return "character-special"
	}
	if fileInfo.Mode()&os.ModeDevice == os.ModeDevice {
		return "block-special"
	}
	ext := filepath.Ext(path)
	if mimeType, ok := StaticMimeTypeMap[ext]; ok {
		return mimeType
	}
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return mimeType
	}
	if fileInfo.Size() == 0 {
		return "text/plain"
	}
	if !extended {
		return ""
	}
	fd, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer fd.Close()
	buf := make([]byte, 512)
	// ignore the error (EOF / UnexpectedEOF is fine, just process how much we got back)
	n, _ := io.ReadAtLeast(fd, buf, 512)
	if n == 0 {
		return ""
	}
	buf = buf[:n]
	rtn := http.DetectContentType(buf)
	if rtn == "application/octet-stream" {
		return ""
	}
	return rtn
}
