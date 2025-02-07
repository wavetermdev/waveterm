// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileutil

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func FixPath(path string) (string, error) {
	var err error
	if strings.HasPrefix(path, "~") {
		path = filepath.Join(wavebase.GetHomeDir(), path[1:])
	} else if !filepath.IsAbs(path) {
		path, err = filepath.Abs(path)
		if err != nil {
			return "", err
		}
	}
	return path, nil
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

func DetectMimeTypeWithDirEnt(path string, dirEnt fs.DirEntry) string {
	if dirEnt != nil {
		if dirEnt.IsDir() {
			return "directory"
		}
		mode := dirEnt.Type()
		if mode&os.ModeNamedPipe == os.ModeNamedPipe {
			return "pipe"
		}
		charDevice := os.ModeDevice | os.ModeCharDevice
		if mode&charDevice == charDevice {
			return "character-special"
		}
		if mode&os.ModeDevice == os.ModeDevice {
			return "block-special"
		}
	}
	ext := filepath.Ext(path)
	if mimeType, ok := StaticMimeTypeMap[ext]; ok {
		return mimeType
	}
	return ""
}

var (
	systemBinDirs = []string{
		"/bin/",
		"/usr/bin/",
		"/usr/local/bin/",
		"/opt/bin/",
		"/sbin/",
		"/usr/sbin/",
	}
	suspiciousPattern = regexp.MustCompile(`[:;#!&$\t%="|>{}]`)
	flagPattern       = regexp.MustCompile(` --?[a-zA-Z0-9]`)
)

// IsInitScriptPath tries to determine if the input string is a path to a script
// rather than an inline script content.
func IsInitScriptPath(input string) bool {
	if len(input) == 0 || strings.Contains(input, "\n") {
		return false
	}

	if suspiciousPattern.MatchString(input) {
		return false
	}

	if flagPattern.MatchString(input) {
		return false
	}

	// Check for home directory path
	if strings.HasPrefix(input, "~/") {
		return true
	}

	// Path must be absolute (if not home directory)
	if !filepath.IsAbs(input) {
		return false
	}

	// Check if path starts with system binary directories
	normalizedPath := filepath.ToSlash(input)
	for _, binDir := range systemBinDirs {
		if strings.HasPrefix(normalizedPath, binDir) {
			return false
		}
	}

	return true
}

type FsFileInfo struct {
	NameInternal    string
	ModeInternal    os.FileMode
	SizeInternal    int64
	ModTimeInternal int64
	IsDirInternal   bool
}

func (f FsFileInfo) Name() string {
	return f.NameInternal
}

func (f FsFileInfo) Size() int64 {
	return f.SizeInternal
}

func (f FsFileInfo) Mode() os.FileMode {
	return f.ModeInternal
}

func (f FsFileInfo) ModTime() time.Time {
	return time.Unix(0, f.ModTimeInternal)
}

func (f FsFileInfo) IsDir() bool {
	return f.IsDirInternal
}

func (f FsFileInfo) Sys() interface{} {
	return nil
}

var _ fs.FileInfo = FsFileInfo{}

// ToFsFileInfo converts wshrpc.FileInfo to FsFileInfo.
// It panics if fi is nil.
func ToFsFileInfo(fi *wshrpc.FileInfo) FsFileInfo {
	if fi == nil {
		panic("ToFsFileInfo: nil FileInfo")
	}
	return FsFileInfo{
		NameInternal:    fi.Name,
		ModeInternal:    fi.Mode,
		SizeInternal:    fi.Size,
		ModTimeInternal: fi.ModTime,
		IsDirInternal:   fi.IsDir,
	}
}

func ReadFileStream(ctx context.Context, readCh <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData], fileInfoCallback func(finfo wshrpc.FileInfo), dirCallback func(entries []*wshrpc.FileInfo) error, fileCallback func(data io.Reader) error) error {
	var fileData *wshrpc.FileData
	firstPk := true
	isDir := false
	drain := true
	defer func() {
		if drain {
			go func() {
				for range readCh {
				}
			}()
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("context cancelled: %v", context.Cause(ctx))
		case respUnion, ok := <-readCh:
			if !ok {
				drain = false
				return nil
			}
			if respUnion.Error != nil {
				return respUnion.Error
			}
			resp := respUnion.Response
			if firstPk {
				firstPk = false
				// first packet has the fileinfo
				if resp.Info == nil {
					return fmt.Errorf("stream file protocol error, first pk fileinfo is empty")
				}
				fileData = &resp
				if fileData.Info.IsDir {
					isDir = true
				}
				continue
			}
			if isDir {
				if len(resp.Entries) == 0 {
					continue
				}
				if resp.Data64 != "" {
					return fmt.Errorf("stream file protocol error, directory entry has data")
				}
				if err := dirCallback(resp.Entries); err != nil {
					return err
				}
			} else {
				if resp.Data64 == "" {
					continue
				}
				decoder := base64.NewDecoder(base64.StdEncoding, bytes.NewReader([]byte(resp.Data64)))
				if err := fileCallback(decoder); err != nil {
					return err
				}
			}
		}
	}
}

func ReadStreamToFileData(ctx context.Context, readCh <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData]) (*wshrpc.FileData, error) {
	var fileData *wshrpc.FileData
	var dataBuf bytes.Buffer
	var entries []*wshrpc.FileInfo
	err := ReadFileStream(ctx, readCh, func(finfo wshrpc.FileInfo) {
		fileData = &wshrpc.FileData{
			Info: &finfo,
		}
	}, func(fileEntries []*wshrpc.FileInfo) error {
		entries = append(entries, fileEntries...)
		return nil
	}, func(data io.Reader) error {
		if _, err := io.Copy(&dataBuf, data); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if fileData == nil {
		return nil, fmt.Errorf("stream file protocol error, no file info")
	}
	if !fileData.Info.IsDir {
		fileData.Data64 = base64.StdEncoding.EncodeToString(dataBuf.Bytes())
	} else {
		fileData.Entries = entries
	}
	return fileData, nil
}

func ReadFileStreamToWriter(ctx context.Context, readCh <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData], writer io.Writer) error {
	return ReadFileStream(ctx, readCh, func(finfo wshrpc.FileInfo) {
	}, func(entries []*wshrpc.FileInfo) error {
		return nil
	}, func(data io.Reader) error {
		_, err := io.Copy(writer, data)
		return err
	})
}
