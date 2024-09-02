// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
)

const MaxFileSize = 50 * 1024 * 1024 // 10M
const MaxDirSize = 1024
const FileChunkSize = 16 * 1024
const DirChunkSize = 128

type ServerImpl struct {
	LogWriter io.Writer
}

func (*ServerImpl) WshServerImpl() {}

func (impl *ServerImpl) Log(format string, args ...interface{}) {
	if impl.LogWriter != nil {
		fmt.Fprintf(impl.LogWriter, format, args...)
	} else {
		log.Printf(format, args...)
	}
}

func (impl *ServerImpl) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	impl.Log("[message] %q\n", data.Message)
	return nil
}

func respErr(err error) wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteStreamFileRtnData] {
	return wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteStreamFileRtnData]{Error: err}
}

type ByteRangeType struct {
	All   bool
	Start int64
	End   int64
}

func parseByteRange(rangeStr string) (ByteRangeType, error) {
	if rangeStr == "" {
		return ByteRangeType{All: true}, nil
	}
	var start, end int64
	_, err := fmt.Sscanf(rangeStr, "%d-%d", &start, &end)
	if err != nil {
		return ByteRangeType{}, errors.New("invalid byte range")
	}
	if start < 0 || end < 0 || start > end {
		return ByteRangeType{}, errors.New("invalid byte range")
	}
	return ByteRangeType{Start: start, End: end}, nil
}

func (impl *ServerImpl) remoteStreamFileDir(ctx context.Context, path string, byteRange ByteRangeType, dataCallback func(fileInfo []*wshrpc.FileInfo, data []byte)) error {
	innerFilesEntries, err := os.ReadDir(path)
	if err != nil {
		return fmt.Errorf("cannot open dir %q: %w", path, err)
	}
	if byteRange.All {
		if len(innerFilesEntries) > MaxDirSize {
			innerFilesEntries = innerFilesEntries[:MaxDirSize]
		}
	} else {
		if byteRange.Start >= int64(len(innerFilesEntries)) {
			return nil
		}
		realEnd := byteRange.End
		if realEnd > int64(len(innerFilesEntries)) {
			realEnd = int64(len(innerFilesEntries))
		}
		innerFilesEntries = innerFilesEntries[byteRange.Start:realEnd]
	}
	var fileInfoArr []*wshrpc.FileInfo
	parent := filepath.Dir(path)
	parentFileInfo, err := impl.fileInfoInternal(parent, false)
	if err == nil && parent != path {
		parentFileInfo.Name = ".."
		parentFileInfo.Size = -1
		fileInfoArr = append(fileInfoArr, parentFileInfo)
	}
	for _, innerFileEntry := range innerFilesEntries {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		innerFileInfoInt, err := innerFileEntry.Info()
		if err != nil {
			continue
		}
		innerFileInfo := statToFileInfo(filepath.Join(path, innerFileInfoInt.Name()), innerFileInfoInt)
		fileInfoArr = append(fileInfoArr, innerFileInfo)
		if len(fileInfoArr) >= DirChunkSize {
			dataCallback(fileInfoArr, nil)
			fileInfoArr = nil
		}
	}
	if len(fileInfoArr) > 0 {
		dataCallback(fileInfoArr, nil)
	}
	return nil
}

// TODO make sure the read is in chunks of 3 bytes (so 4 bytes of base64) in order to make decoding more efficient
func (impl *ServerImpl) remoteStreamFileRegular(ctx context.Context, path string, byteRange ByteRangeType, dataCallback func(fileInfo []*wshrpc.FileInfo, data []byte)) error {
	fd, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("cannot open file %q: %w", path, err)
	}
	defer fd.Close()
	var filePos int64
	if !byteRange.All && byteRange.Start > 0 {
		_, err := fd.Seek(byteRange.Start, io.SeekStart)
		if err != nil {
			return fmt.Errorf("seeking file %q: %w", path, err)
		}
		filePos = byteRange.Start
	}
	buf := make([]byte, FileChunkSize)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		n, err := fd.Read(buf)
		if n > 0 {
			if !byteRange.All && filePos+int64(n) > byteRange.End {
				n = int(byteRange.End - filePos)
			}
			filePos += int64(n)
			dataCallback(nil, buf[:n])
		}
		if !byteRange.All && filePos >= byteRange.End {
			break
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("reading file %q: %w", path, err)
		}
	}
	return nil
}

func (impl *ServerImpl) remoteStreamFileInternal(ctx context.Context, data wshrpc.CommandRemoteStreamFileData, dataCallback func(fileInfo []*wshrpc.FileInfo, data []byte)) error {
	byteRange, err := parseByteRange(data.ByteRange)
	if err != nil {
		return err
	}
	path := data.Path
	path = wavebase.ExpandHomeDir(path)
	finfo, err := impl.fileInfoInternal(path, true)
	if err != nil {
		return fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	dataCallback([]*wshrpc.FileInfo{finfo}, nil)
	if finfo.NotFound {
		return nil
	}
	if finfo.Size > MaxFileSize {
		return fmt.Errorf("file %q is too large to read, use /wave/stream-file", path)
	}
	if finfo.IsDir {
		return impl.remoteStreamFileDir(ctx, path, byteRange, dataCallback)
	} else {
		return impl.remoteStreamFileRegular(ctx, path, byteRange, dataCallback)
	}
}

func (impl *ServerImpl) RemoteStreamFileCommand(ctx context.Context, data wshrpc.CommandRemoteStreamFileData) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteStreamFileRtnData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteStreamFileRtnData], 16)
	defer close(ch)
	err := impl.remoteStreamFileInternal(ctx, data, func(fileInfo []*wshrpc.FileInfo, data []byte) {
		resp := wshrpc.CommandRemoteStreamFileRtnData{}
		resp.FileInfo = fileInfo
		if len(data) > 0 {
			resp.Data64 = base64.StdEncoding.EncodeToString(data)
		}
		ch <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteStreamFileRtnData]{Response: resp}
	})
	if err != nil {
		ch <- respErr(err)
	}
	return ch
}

func statToFileInfo(fullPath string, finfo fs.FileInfo) *wshrpc.FileInfo {
	mimeType := utilfn.DetectMimeType(fullPath, finfo)
	rtn := &wshrpc.FileInfo{
		Path:     wavebase.ReplaceHomeDir(fullPath),
		Dir:      computeDirPart(fullPath, finfo.IsDir()),
		Name:     finfo.Name(),
		Size:     finfo.Size(),
		Mode:     finfo.Mode(),
		ModeStr:  finfo.Mode().String(),
		ModTime:  finfo.ModTime().UnixMilli(),
		IsDir:    finfo.IsDir(),
		MimeType: mimeType,
	}
	if finfo.IsDir() {
		rtn.Size = -1
	}
	return rtn
}

// fileInfo might be null
func checkIsReadOnly(path string, fileInfo fs.FileInfo, exists bool) bool {
	if !exists || fileInfo.Mode().IsDir() {
		dirName := filepath.Dir(path)
		randHexStr, err := utilfn.RandomHexString(12)
		if err != nil {
			// we're not sure, just return false
			return false
		}
		tmpFileName := filepath.Join(dirName, "wsh-tmp-"+randHexStr)
		_, err = os.Create(tmpFileName)
		if err != nil {
			return true
		}
		os.Remove(tmpFileName)
		return false
	}
	// try to open for writing, if this fails then it is read-only
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		return true
	}
	file.Close()
	return false
}

func computeDirPart(path string, isDir bool) string {
	path = filepath.Clean(wavebase.ExpandHomeDir(path))
	path = filepath.ToSlash(path)
	if path == "/" {
		return "/"
	}
	path = strings.TrimSuffix(path, "/")
	if isDir {
		return path
	}
	return filepath.Dir(path)
}

func (*ServerImpl) fileInfoInternal(path string, extended bool) (*wshrpc.FileInfo, error) {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDir(path))
	finfo, err := os.Stat(cleanedPath)
	if os.IsNotExist(err) {
		return &wshrpc.FileInfo{
			Path:     wavebase.ReplaceHomeDir(path),
			Dir:      computeDirPart(path, false),
			NotFound: true,
			ReadOnly: checkIsReadOnly(cleanedPath, finfo, false),
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	rtn := statToFileInfo(cleanedPath, finfo)
	if extended {
		rtn.ReadOnly = checkIsReadOnly(cleanedPath, finfo, true)
	}
	return rtn, nil
}

func (impl *ServerImpl) RemoteFileInfoCommand(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	return impl.fileInfoInternal(path, true)
}

func (*ServerImpl) RemoteWriteFileCommand(ctx context.Context, data wshrpc.CommandRemoteWriteFileData) error {
	path := wavebase.ExpandHomeDir(data.Path)
	createMode := data.CreateMode
	if createMode == 0 {
		createMode = 0644
	}
	dataSize := base64.StdEncoding.DecodedLen(len(data.Data64))
	dataBytes := make([]byte, dataSize)
	n, err := base64.StdEncoding.Decode(dataBytes, []byte(data.Data64))
	if err != nil {
		return fmt.Errorf("cannot decode base64 data: %w", err)
	}
	err = os.WriteFile(path, dataBytes[:n], createMode)
	if err != nil {
		return fmt.Errorf("cannot write file %q: %w", path, err)
	}
	return nil
}

func (*ServerImpl) RemoteFileDeleteCommand(ctx context.Context, path string) error {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDir(path))
	err := os.Remove(cleanedPath)
	if err != nil {
		return fmt.Errorf("cannot delete file %q: %w", path, err)
	}
	return nil
}
