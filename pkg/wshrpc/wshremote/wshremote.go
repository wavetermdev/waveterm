// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"archive/tar"
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/suggestion"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/iochan/iochantypes"
	"github.com/wavetermdev/waveterm/pkg/util/tarcopy"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type ServerImpl struct {
	LogWriter io.Writer
	Router    *wshutil.WshRouter
	RpcClient *wshutil.WshRpc
	IsLocal   bool
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

func (impl *ServerImpl) StreamTestCommand(ctx context.Context) chan wshrpc.RespOrErrorUnion[int] {
	ch := make(chan wshrpc.RespOrErrorUnion[int], 16)
	go func() {
		defer close(ch)
		idx := 0
		for {
			ch <- wshrpc.RespOrErrorUnion[int]{Response: idx}
			idx++
			if idx == 1000 {
				break
			}
		}
	}()
	return ch
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

func (impl *ServerImpl) remoteStreamFileDir(ctx context.Context, path string, byteRange ByteRangeType, dataCallback func(fileInfo []*wshrpc.FileInfo, data []byte, byteRange ByteRangeType)) error {
	innerFilesEntries, err := os.ReadDir(path)
	if err != nil {
		return fmt.Errorf("cannot open dir %q: %w", path, err)
	}
	if byteRange.All {
		if len(innerFilesEntries) > wshrpc.MaxDirSize {
			innerFilesEntries = innerFilesEntries[:wshrpc.MaxDirSize]
		}
	} else {
		if byteRange.Start < int64(len(innerFilesEntries)) {
			realEnd := byteRange.End
			if realEnd > int64(len(innerFilesEntries)) {
				realEnd = int64(len(innerFilesEntries))
			}
			innerFilesEntries = innerFilesEntries[byteRange.Start:realEnd]
		} else {
			innerFilesEntries = []os.DirEntry{}
		}
	}
	var fileInfoArr []*wshrpc.FileInfo
	for _, innerFileEntry := range innerFilesEntries {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		innerFileInfoInt, err := innerFileEntry.Info()
		if err != nil {
			continue
		}
		innerFileInfo := statToFileInfo(filepath.Join(path, innerFileInfoInt.Name()), innerFileInfoInt, false)
		fileInfoArr = append(fileInfoArr, innerFileInfo)
		if len(fileInfoArr) >= wshrpc.DirChunkSize {
			dataCallback(fileInfoArr, nil, byteRange)
			fileInfoArr = nil
		}
	}
	if len(fileInfoArr) > 0 {
		dataCallback(fileInfoArr, nil, byteRange)
	}
	return nil
}

func (impl *ServerImpl) remoteStreamFileRegular(ctx context.Context, path string, byteRange ByteRangeType, dataCallback func(fileInfo []*wshrpc.FileInfo, data []byte, byteRange ByteRangeType)) error {
	fd, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("cannot open file %q: %w", path, err)
	}
	defer utilfn.GracefulClose(fd, "remoteStreamFileRegular", path)
	var filePos int64
	if !byteRange.All && byteRange.Start > 0 {
		_, err := fd.Seek(byteRange.Start, io.SeekStart)
		if err != nil {
			return fmt.Errorf("seeking file %q: %w", path, err)
		}
		filePos = byteRange.Start
	}
	buf := make([]byte, wshrpc.FileChunkSize)
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
			dataCallback(nil, buf[:n], byteRange)
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

func (impl *ServerImpl) remoteStreamFileInternal(ctx context.Context, data wshrpc.CommandRemoteStreamFileData, dataCallback func(fileInfo []*wshrpc.FileInfo, data []byte, byteRange ByteRangeType)) error {
	byteRange, err := parseByteRange(data.ByteRange)
	if err != nil {
		return err
	}
	path, err := wavebase.ExpandHomeDir(data.Path)
	if err != nil {
		return err
	}
	finfo, err := impl.fileInfoInternal(path, true)
	if err != nil {
		return fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	dataCallback([]*wshrpc.FileInfo{finfo}, nil, byteRange)
	if finfo.NotFound {
		return nil
	}
	if finfo.IsDir {
		return impl.remoteStreamFileDir(ctx, path, byteRange, dataCallback)
	} else {
		return impl.remoteStreamFileRegular(ctx, path, byteRange, dataCallback)
	}
}

func (impl *ServerImpl) RemoteStreamFileCommand(ctx context.Context, data wshrpc.CommandRemoteStreamFileData) chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileData], 16)
	go func() {
		defer close(ch)
		firstPk := true
		err := impl.remoteStreamFileInternal(ctx, data, func(fileInfo []*wshrpc.FileInfo, data []byte, byteRange ByteRangeType) {
			resp := wshrpc.FileData{}
			fileInfoLen := len(fileInfo)
			if fileInfoLen > 1 || !firstPk {
				resp.Entries = fileInfo
			} else if fileInfoLen == 1 {
				resp.Info = fileInfo[0]
			}
			if firstPk {
				firstPk = false
			}
			if len(data) > 0 {
				resp.Data64 = base64.StdEncoding.EncodeToString(data)
				resp.At = &wshrpc.FileDataAt{Offset: byteRange.Start, Size: len(data)}
			}
			ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: resp}
		})
		if err != nil {
			ch <- wshutil.RespErr[wshrpc.FileData](err)
		}
	}()
	return ch
}

func (impl *ServerImpl) RemoteTarStreamCommand(ctx context.Context, data wshrpc.CommandRemoteStreamTarData) <-chan wshrpc.RespOrErrorUnion[iochantypes.Packet] {
	path := data.Path
	opts := data.Opts
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	log.Printf("RemoteTarStreamCommand: path=%s\n", path)
	srcHasSlash := strings.HasSuffix(path, "/")
	path, err := wavebase.ExpandHomeDir(path)
	if err != nil {
		return wshutil.SendErrCh[iochantypes.Packet](fmt.Errorf("cannot expand path %q: %w", path, err))
	}
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDirSafe(path))
	finfo, err := os.Stat(cleanedPath)
	if err != nil {
		return wshutil.SendErrCh[iochantypes.Packet](fmt.Errorf("cannot stat file %q: %w", path, err))
	}

	var pathPrefix string
	singleFile := !finfo.IsDir()
	if !singleFile && srcHasSlash {
		pathPrefix = cleanedPath
	} else {
		pathPrefix = filepath.Dir(cleanedPath)
	}

	timeout := fstype.DefaultTimeout
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	readerCtx, cancel := context.WithTimeout(ctx, timeout)
	rtn, writeHeader, fileWriter, tarClose := tarcopy.TarCopySrc(readerCtx, pathPrefix)

	go func() {
		defer func() {
			tarClose()
			cancel()
		}()
		walkFunc := func(path string, info fs.FileInfo, err error) error {
			if readerCtx.Err() != nil {
				return readerCtx.Err()
			}
			if err != nil {
				return err
			}
			if err = writeHeader(info, path, singleFile); err != nil {
				return err
			}
			// if not a dir, write file content
			if !info.IsDir() {
				data, err := os.Open(path)
				if err != nil {
					return err
				}
				defer utilfn.GracefulClose(data, "RemoteTarStreamCommand", path)
				if _, err := io.Copy(fileWriter, data); err != nil {
					return err
				}
			}
			return nil
		}
		log.Printf("RemoteTarStreamCommand: starting\n")
		err = nil
		if singleFile {
			err = walkFunc(cleanedPath, finfo, nil)
		} else {
			err = filepath.Walk(cleanedPath, walkFunc)
		}
		if err != nil {
			rtn <- wshutil.RespErr[iochantypes.Packet](err)
		}
		log.Printf("RemoteTarStreamCommand: done\n")
	}()
	log.Printf("RemoteTarStreamCommand: returning channel\n")
	return rtn
}

func (impl *ServerImpl) RemoteFileCopyCommand(ctx context.Context, data wshrpc.CommandFileCopyData) (bool, error) {
	log.Printf("RemoteFileCopyCommand: src=%s, dest=%s\n", data.SrcUri, data.DestUri)
	opts := data.Opts
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	destUri := data.DestUri
	srcUri := data.SrcUri
	merge := opts.Merge
	overwrite := opts.Overwrite
	if overwrite && merge {
		return false, fmt.Errorf("cannot specify both overwrite and merge")
	}

	destConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, destUri)
	if err != nil {
		return false, fmt.Errorf("cannot parse destination URI %q: %w", destUri, err)
	}
	destPathCleaned := filepath.Clean(wavebase.ExpandHomeDirSafe(destConn.Path))
	destinfo, err := os.Stat(destPathCleaned)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return false, fmt.Errorf("cannot stat destination %q: %w", destPathCleaned, err)
		}
	}

	destExists := destinfo != nil
	destIsDir := destExists && destinfo.IsDir()
	destHasSlash := strings.HasSuffix(destUri, "/")

	if destExists && !destIsDir {
		if !overwrite {
			return false, fmt.Errorf(fstype.OverwriteRequiredError, destPathCleaned)
		} else {
			err := os.Remove(destPathCleaned)
			if err != nil {
				return false, fmt.Errorf("cannot remove file %q: %w", destPathCleaned, err)
			}
		}
	}
	srcConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, srcUri)
	if err != nil {
		return false, fmt.Errorf("cannot parse source URI %q: %w", srcUri, err)
	}

	copyFileFunc := func(path string, finfo fs.FileInfo, srcFile io.Reader) (int64, error) {
		nextinfo, err := os.Stat(path)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return 0, fmt.Errorf("cannot stat file %q: %w", path, err)
		}

		if nextinfo != nil {
			if nextinfo.IsDir() {
				if !finfo.IsDir() {
					// try to create file in directory
					path = filepath.Join(path, filepath.Base(finfo.Name()))
					newdestinfo, err := os.Stat(path)
					if err != nil && !errors.Is(err, fs.ErrNotExist) {
						return 0, fmt.Errorf("cannot stat file %q: %w", path, err)
					}
					if newdestinfo != nil && !overwrite {
						return 0, fmt.Errorf(fstype.OverwriteRequiredError, path)
					}
				} else if overwrite {
					err := os.RemoveAll(path)
					if err != nil {
						return 0, fmt.Errorf("cannot remove directory %q: %w", path, err)
					}
				} else if !merge {
					return 0, fmt.Errorf(fstype.MergeRequiredError, path)
				}
			} else {
				if !overwrite {
					return 0, fmt.Errorf(fstype.OverwriteRequiredError, path)
				} else if finfo.IsDir() {
					err := os.RemoveAll(path)
					if err != nil {
						return 0, fmt.Errorf("cannot remove directory %q: %w", path, err)
					}
				}
			}
		}

		if finfo.IsDir() {
			err := os.MkdirAll(path, finfo.Mode())
			if err != nil {
				return 0, fmt.Errorf("cannot create directory %q: %w", path, err)
			}
			return 0, nil
		} else {
			err := os.MkdirAll(filepath.Dir(path), 0755)
			if err != nil {
				return 0, fmt.Errorf("cannot create parent directory %q: %w", filepath.Dir(path), err)
			}
		}

		file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, finfo.Mode())
		if err != nil {
			return 0, fmt.Errorf("cannot create new file %q: %w", path, err)
		}
		defer utilfn.GracefulClose(file, "RemoteFileCopyCommand", path)
		_, err = io.Copy(file, srcFile)
		if err != nil {
			return 0, fmt.Errorf("cannot write file %q: %w", path, err)
		}

		return finfo.Size(), nil
	}

	srcIsDir := false
	if srcConn.Host == destConn.Host {
		srcPathCleaned := filepath.Clean(wavebase.ExpandHomeDirSafe(srcConn.Path))

		srcFileStat, err := os.Stat(srcPathCleaned)
		if err != nil {
			return false, fmt.Errorf("cannot stat file %q: %w", srcPathCleaned, err)
		}

		if srcFileStat.IsDir() {
			srcIsDir = true
			var srcPathPrefix string
			if destIsDir {
				srcPathPrefix = filepath.Dir(srcPathCleaned)
			} else {
				srcPathPrefix = srcPathCleaned
			}
			err = filepath.Walk(srcPathCleaned, func(path string, info fs.FileInfo, err error) error {
				if err != nil {
					return err
				}
				srcFilePath := path
				destFilePath := filepath.Join(destPathCleaned, strings.TrimPrefix(path, srcPathPrefix))
				var file *os.File
				if !info.IsDir() {
					file, err = os.Open(srcFilePath)
					if err != nil {
						return fmt.Errorf("cannot open file %q: %w", srcFilePath, err)
					}
					defer utilfn.GracefulClose(file, "RemoteFileCopyCommand", srcFilePath)
				}
				_, err = copyFileFunc(destFilePath, info, file)
				return err
			})
			if err != nil {
				return false, fmt.Errorf("cannot copy %q to %q: %w", srcUri, destUri, err)
			}
		} else {
			file, err := os.Open(srcPathCleaned)
			if err != nil {
				return false, fmt.Errorf("cannot open file %q: %w", srcPathCleaned, err)
			}
			defer utilfn.GracefulClose(file, "RemoteFileCopyCommand", srcPathCleaned)
			var destFilePath string
			if destHasSlash {
				destFilePath = filepath.Join(destPathCleaned, filepath.Base(srcPathCleaned))
			} else {
				destFilePath = destPathCleaned
			}
			_, err = copyFileFunc(destFilePath, srcFileStat, file)
			if err != nil {
				return false, fmt.Errorf("cannot copy %q to %q: %w", srcUri, destUri, err)
			}
		}
	} else {
		timeout := fstype.DefaultTimeout
		if opts.Timeout > 0 {
			timeout = time.Duration(opts.Timeout) * time.Millisecond
		}
		readCtx, cancel := context.WithCancelCause(ctx)
		readCtx, timeoutCancel := context.WithTimeoutCause(readCtx, timeout, fmt.Errorf("timeout copying file %q to %q", srcUri, destUri))
		defer timeoutCancel()
		copyStart := time.Now()
		ioch := wshclient.FileStreamTarCommand(wshfs.RpcClient, wshrpc.CommandRemoteStreamTarData{Path: srcUri, Opts: opts}, &wshrpc.RpcOpts{Timeout: opts.Timeout})
		numFiles := 0
		numSkipped := 0
		totalBytes := int64(0)

		err := tarcopy.TarCopyDest(readCtx, cancel, ioch, func(next *tar.Header, reader *tar.Reader, singleFile bool) error {
			numFiles++
			nextpath := filepath.Join(destPathCleaned, next.Name)
			srcIsDir = !singleFile
			if singleFile && !destHasSlash {
				// custom flag to indicate that the source is a single file, not a directory the contents of a directory
				nextpath = destPathCleaned
			}
			finfo := next.FileInfo()
			n, err := copyFileFunc(nextpath, finfo, reader)
			if err != nil {
				return fmt.Errorf("cannot copy file %q: %w", next.Name, err)
			}
			totalBytes += n
			return nil
		})
		if err != nil {
			return false, fmt.Errorf("cannot copy %q to %q: %w", srcUri, destUri, err)
		}
		totalTime := time.Since(copyStart).Seconds()
		totalMegaBytes := float64(totalBytes) / 1024 / 1024
		rate := float64(0)
		if totalTime > 0 {
			rate = totalMegaBytes / totalTime
		}
		log.Printf("RemoteFileCopyCommand: done; %d files copied in %.3fs, total of %.4f MB, %.2f MB/s, %d files skipped\n", numFiles, totalTime, totalMegaBytes, rate, numSkipped)
	}
	return srcIsDir, nil
}

func (impl *ServerImpl) RemoteListEntriesCommand(ctx context.Context, data wshrpc.CommandRemoteListEntriesData) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 16)
	go func() {
		defer close(ch)
		path, err := wavebase.ExpandHomeDir(data.Path)
		if err != nil {
			ch <- wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err)
			return
		}
		innerFilesEntries := []os.DirEntry{}
		seen := 0
		if data.Opts.Limit == 0 {
			data.Opts.Limit = wshrpc.MaxDirSize
		}
		if data.Opts.All {
			fs.WalkDir(os.DirFS(path), ".", func(path string, d fs.DirEntry, err error) error {
				defer func() {
					seen++
				}()
				if seen < data.Opts.Offset {
					return nil
				}
				if seen >= data.Opts.Offset+data.Opts.Limit {
					return io.EOF
				}
				if err != nil {
					return err
				}
				if d.IsDir() {
					return nil
				}
				innerFilesEntries = append(innerFilesEntries, d)
				return nil
			})
		} else {
			innerFilesEntries, err = os.ReadDir(path)
			if err != nil {
				ch <- wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](fmt.Errorf("cannot open dir %q: %w", path, err))
				return
			}
		}
		var fileInfoArr []*wshrpc.FileInfo
		for _, innerFileEntry := range innerFilesEntries {
			if ctx.Err() != nil {
				ch <- wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](ctx.Err())
				return
			}
			innerFileInfoInt, err := innerFileEntry.Info()
			if err != nil {
				log.Printf("cannot stat file %q: %v\n", innerFileEntry.Name(), err)
				continue
			}
			innerFileInfo := statToFileInfo(filepath.Join(path, innerFileInfoInt.Name()), innerFileInfoInt, false)
			fileInfoArr = append(fileInfoArr, innerFileInfo)
			if len(fileInfoArr) >= wshrpc.DirChunkSize {
				resp := wshrpc.CommandRemoteListEntriesRtnData{FileInfo: fileInfoArr}
				ch <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: resp}
				fileInfoArr = nil
			}
		}
		if len(fileInfoArr) > 0 {
			resp := wshrpc.CommandRemoteListEntriesRtnData{FileInfo: fileInfoArr}
			ch <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: resp}
		}
	}()
	return ch
}

func statToFileInfo(fullPath string, finfo fs.FileInfo, extended bool) *wshrpc.FileInfo {
	mimeType := fileutil.DetectMimeType(fullPath, finfo, extended)
	rtn := &wshrpc.FileInfo{
		Path:          wavebase.ReplaceHomeDir(fullPath),
		Dir:           computeDirPart(fullPath),
		Name:          finfo.Name(),
		Size:          finfo.Size(),
		Mode:          finfo.Mode(),
		ModeStr:       finfo.Mode().String(),
		ModTime:       finfo.ModTime().UnixMilli(),
		IsDir:         finfo.IsDir(),
		MimeType:      mimeType,
		SupportsMkdir: true,
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
		fd, err := os.Create(tmpFileName)
		if err != nil {
			return true
		}
		utilfn.GracefulClose(fd, "checkIsReadOnly", tmpFileName)
		os.Remove(tmpFileName)
		return false
	}
	// try to open for writing, if this fails then it is read-only
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		return true
	}
	utilfn.GracefulClose(file, "checkIsReadOnly", path)
	return false
}

func computeDirPart(path string) string {
	path = filepath.Clean(wavebase.ExpandHomeDirSafe(path))
	path = filepath.ToSlash(path)
	if path == "/" {
		return "/"
	}
	return filepath.Dir(path)
}

func (*ServerImpl) fileInfoInternal(path string, extended bool) (*wshrpc.FileInfo, error) {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDirSafe(path))
	finfo, err := os.Stat(cleanedPath)
	if os.IsNotExist(err) {
		return &wshrpc.FileInfo{
			Path:          wavebase.ReplaceHomeDir(path),
			Dir:           computeDirPart(path),
			NotFound:      true,
			ReadOnly:      checkIsReadOnly(cleanedPath, finfo, false),
			SupportsMkdir: true,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	rtn := statToFileInfo(cleanedPath, finfo, extended)
	if extended {
		rtn.ReadOnly = checkIsReadOnly(cleanedPath, finfo, true)
	}
	return rtn, nil
}

func resolvePaths(paths []string) string {
	if len(paths) == 0 {
		return wavebase.ExpandHomeDirSafe("~")
	}
	rtnPath := wavebase.ExpandHomeDirSafe(paths[0])
	for _, path := range paths[1:] {
		path = wavebase.ExpandHomeDirSafe(path)
		if filepath.IsAbs(path) {
			rtnPath = path
			continue
		}
		rtnPath = filepath.Join(rtnPath, path)
	}
	return rtnPath
}

func (impl *ServerImpl) RemoteFileJoinCommand(ctx context.Context, paths []string) (*wshrpc.FileInfo, error) {
	rtnPath := resolvePaths(paths)
	return impl.fileInfoInternal(rtnPath, true)
}

func (impl *ServerImpl) RemoteFileInfoCommand(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	return impl.fileInfoInternal(path, true)
}

func (impl *ServerImpl) RemoteFileTouchCommand(ctx context.Context, path string) error {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDirSafe(path))
	if _, err := os.Stat(cleanedPath); err == nil {
		return fmt.Errorf("file %q already exists", path)
	}
	if err := os.MkdirAll(filepath.Dir(cleanedPath), 0755); err != nil {
		return fmt.Errorf("cannot create directory %q: %w", filepath.Dir(cleanedPath), err)
	}
	if err := os.WriteFile(cleanedPath, []byte{}, 0644); err != nil {
		return fmt.Errorf("cannot create file %q: %w", cleanedPath, err)
	}
	return nil
}

func (impl *ServerImpl) RemoteFileMoveCommand(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	opts := data.Opts
	destUri := data.DestUri
	srcUri := data.SrcUri
	overwrite := opts != nil && opts.Overwrite
	recursive := opts != nil && opts.Recursive

	destConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, destUri)
	if err != nil {
		return fmt.Errorf("cannot parse destination URI %q: %w", srcUri, err)
	}
	destPathCleaned := filepath.Clean(wavebase.ExpandHomeDirSafe(destConn.Path))
	destinfo, err := os.Stat(destPathCleaned)
	if err == nil {
		if !destinfo.IsDir() {
			if !overwrite {
				return fmt.Errorf("destination %q already exists, use overwrite option", destUri)
			} else {
				err := os.Remove(destPathCleaned)
				if err != nil {
					return fmt.Errorf("cannot remove file %q: %w", destUri, err)
				}
			}
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("cannot stat destination %q: %w", destUri, err)
	}
	srcConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, srcUri)
	if err != nil {
		return fmt.Errorf("cannot parse source URI %q: %w", srcUri, err)
	}
	if srcConn.Host == destConn.Host {
		srcPathCleaned := filepath.Clean(wavebase.ExpandHomeDirSafe(srcConn.Path))
		finfo, err := os.Stat(srcPathCleaned)
		if err != nil {
			return fmt.Errorf("cannot stat file %q: %w", srcPathCleaned, err)
		}
		if finfo.IsDir() && !recursive {
			return fmt.Errorf(fstype.RecursiveRequiredError)
		}
		err = os.Rename(srcPathCleaned, destPathCleaned)
		if err != nil {
			return fmt.Errorf("cannot move file %q to %q: %w", srcPathCleaned, destPathCleaned, err)
		}
	} else {
		return fmt.Errorf("cannot move file %q to %q: different hosts", srcUri, destUri)
	}
	return nil
}

func (impl *ServerImpl) RemoteMkdirCommand(ctx context.Context, path string) error {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDirSafe(path))
	if stat, err := os.Stat(cleanedPath); err == nil {
		if stat.IsDir() {
			return fmt.Errorf("directory %q already exists", path)
		} else {
			return fmt.Errorf("cannot create directory %q, file exists at path", path)
		}
	}
	if err := os.MkdirAll(cleanedPath, 0755); err != nil {
		return fmt.Errorf("cannot create directory %q: %w", cleanedPath, err)
	}
	return nil
}
func (*ServerImpl) RemoteWriteFileCommand(ctx context.Context, data wshrpc.FileData) error {
	var truncate, append bool
	var atOffset int64
	if data.Info != nil && data.Info.Opts != nil {
		truncate = data.Info.Opts.Truncate
		append = data.Info.Opts.Append
	}
	if data.At != nil {
		atOffset = data.At.Offset
	}
	if truncate && atOffset > 0 {
		return fmt.Errorf("cannot specify non-zero offset with truncate option")
	}
	if append && atOffset > 0 {
		return fmt.Errorf("cannot specify non-zero offset with append option")
	}
	path, err := wavebase.ExpandHomeDir(data.Info.Path)
	if err != nil {
		return err
	}
	createMode := os.FileMode(0644)
	if data.Info != nil && data.Info.Mode > 0 {
		createMode = data.Info.Mode
	}
	dataSize := base64.StdEncoding.DecodedLen(len(data.Data64))
	dataBytes := make([]byte, dataSize)
	n, err := base64.StdEncoding.Decode(dataBytes, []byte(data.Data64))
	if err != nil {
		return fmt.Errorf("cannot decode base64 data: %w", err)
	}
	finfo, err := os.Stat(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	fileSize := int64(0)
	if finfo != nil {
		fileSize = finfo.Size()
	}
	if atOffset > fileSize {
		return fmt.Errorf("cannot write at offset %d, file size is %d", atOffset, fileSize)
	}
	openFlags := os.O_CREATE | os.O_WRONLY
	if truncate {
		openFlags |= os.O_TRUNC
	}
	if append {
		openFlags |= os.O_APPEND
	}

	file, err := os.OpenFile(path, openFlags, createMode)
	if err != nil {
		return fmt.Errorf("cannot open file %q: %w", path, err)
	}
	defer utilfn.GracefulClose(file, "RemoteWriteFileCommand", path)
	if atOffset > 0 && !append {
		n, err = file.WriteAt(dataBytes[:n], atOffset)
	} else {
		n, err = file.Write(dataBytes[:n])
	}
	if err != nil {
		return fmt.Errorf("cannot write to file %q: %w", path, err)
	}
	return nil
}

func (*ServerImpl) RemoteFileDeleteCommand(ctx context.Context, data wshrpc.CommandDeleteFileData) error {
	expandedPath, err := wavebase.ExpandHomeDir(data.Path)
	if err != nil {
		return fmt.Errorf("cannot delete file %q: %w", data.Path, err)
	}
	cleanedPath := filepath.Clean(expandedPath)

	err = os.Remove(cleanedPath)
	if err != nil {
		finfo, _ := os.Stat(cleanedPath)
		if finfo != nil && finfo.IsDir() {
			if !data.Recursive {
				return fmt.Errorf(fstype.RecursiveRequiredError)
			}
			err = os.RemoveAll(cleanedPath)
			if err != nil {
				return fmt.Errorf("cannot delete directory %q: %w", data.Path, err)
			}
		} else {
			return fmt.Errorf("cannot delete file %q: %w", data.Path, err)
		}
	}
	return nil
}

func (*ServerImpl) RemoteGetInfoCommand(ctx context.Context) (wshrpc.RemoteInfo, error) {
	return wshutil.GetInfo(), nil
}

func (*ServerImpl) RemoteInstallRcFilesCommand(ctx context.Context) error {
	return wshutil.InstallRcFiles()
}

func (*ServerImpl) FetchSuggestionsCommand(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	return suggestion.FetchSuggestions(ctx, data)
}

func (*ServerImpl) DisposeSuggestionsCommand(ctx context.Context, widgetId string) error {
	suggestion.DisposeSuggestions(ctx, widgetId)
	return nil
}

func (impl *ServerImpl) getWshPath() (string, error) {
	if impl.IsLocal {
		return filepath.Join(wavebase.GetWaveDataDir(), "bin", "wsh"), nil
	}
	wshPath, err := wavebase.ExpandHomeDir("~/.waveterm/bin/wsh")
	if err != nil {
		return "", fmt.Errorf("cannot expand wsh path: %w", err)
	}
	return wshPath, nil
}

func (impl *ServerImpl) RemoteStartJobCommand(ctx context.Context, data wshrpc.CommandRemoteStartJobData) (*wshrpc.CommandStartJobRtnData, error) {
	log.Printf("RemoteStartJobCommand: starting, jobid=%s, clientid=%s\n", data.JobId, data.ClientId)
	if impl.Router == nil {
		return nil, fmt.Errorf("cannot start remote job: no router available")
	}
	
	wshPath, err := impl.getWshPath()
	if err != nil {
		return nil, err
	}
	log.Printf("RemoteStartJobCommand: wshPath=%s\n", wshPath)

	cmd := exec.Command(wshPath, "jobmanager", "--jobid", data.JobId, "--clientid", data.ClientId)
	if data.PublicKeyBase64 != "" {
		cmd.Env = append(os.Environ(), "WAVETERM_PUBLICKEY="+data.PublicKeyBase64)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("cannot create stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("cannot create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("cannot create stderr pipe: %w", err)
	}
	log.Printf("RemoteStartJobCommand: created pipes\n")

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("cannot start job manager: %w", err)
	}
	log.Printf("RemoteStartJobCommand: job manager process started\n")

	jobAuthTokenLine := fmt.Sprintf("Wave-JobAccessToken:%s\n", data.JobAuthToken)
	if _, err := stdin.Write([]byte(jobAuthTokenLine)); err != nil {
		cmd.Process.Kill()
		return nil, fmt.Errorf("cannot write job auth token: %w", err)
	}
	stdin.Close()
	log.Printf("RemoteStartJobCommand: wrote auth token to stdin\n")

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("RemoteStartJobCommand: stderr: %s\n", line)
		}
		if err := scanner.Err(); err != nil {
			log.Printf("RemoteStartJobCommand: error reading stderr: %v\n", err)
		} else {
			log.Printf("RemoteStartJobCommand: stderr EOF\n")
		}
	}()

	startCh := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("RemoteStartJobCommand: stdout line: %s\n", line)
			if strings.Contains(line, "Wave-JobManagerStart") {
				startCh <- nil
				return
			}
		}
		if err := scanner.Err(); err != nil {
			startCh <- fmt.Errorf("error reading stdout: %w", err)
		} else {
			log.Printf("RemoteStartJobCommand: stdout EOF\n")
			startCh <- fmt.Errorf("job manager exited without start signal")
		}
	}()

	timeoutCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	log.Printf("RemoteStartJobCommand: waiting for start signal\n")
	select {
	case err := <-startCh:
		if err != nil {
			cmd.Process.Kill()
			log.Printf("RemoteStartJobCommand: error from start signal: %v\n", err)
			return nil, err
		}
		log.Printf("RemoteStartJobCommand: received start signal\n")
	case <-timeoutCtx.Done():
		cmd.Process.Kill()
		log.Printf("RemoteStartJobCommand: timeout waiting for start signal\n")
		return nil, fmt.Errorf("timeout waiting for job manager to start")
	}

	go func() {
		cmd.Wait()
	}()

	socketPath := filepath.Join(wavebase.GetHomeDir(), ".waveterm", "jobs", data.ClientId, fmt.Sprintf("%s.sock", data.JobId))
	log.Printf("RemoteStartJobCommand: connecting to socket: %s\n", socketPath)
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		log.Printf("RemoteStartJobCommand: error connecting to socket: %v\n", err)
		return nil, fmt.Errorf("cannot connect to job manager socket: %w", err)
	}
	log.Printf("RemoteStartJobCommand: connected to socket\n")

	proxy := wshutil.MakeRpcProxy("jobmanager")
	go func() {
		writeErr := wshutil.AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("RemoteStartJobCommand: error writing to job manager socket: %v\n", writeErr)
		}
	}()
	go func() {
		defer func() {
			conn.Close()
			close(proxy.FromRemoteCh)
		}()
		wshutil.AdaptStreamToMsgCh(conn, proxy.FromRemoteCh)
	}()

	linkId := impl.Router.RegisterUntrustedLink(proxy)

	routeId := wshutil.MakeLinkRouteId(linkId)
	authData := wshrpc.CommandAuthenticateToJobData{
		JobAccessToken: data.JobAuthToken,
	}
	err = wshclient.AuthenticateToJobManagerCommand(impl.RpcClient, authData, &wshrpc.RpcOpts{Route: routeId})
	if err != nil {
		conn.Close()
		impl.Router.UnregisterLink(linkId)
		return nil, fmt.Errorf("authentication to job manager failed: %w", err)
	}

	jobRouteId := wshutil.MakeJobRouteId(data.JobId)
	waitCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	err = impl.Router.WaitForRegister(waitCtx, jobRouteId)
	if err != nil {
		conn.Close()
		impl.Router.UnregisterLink(linkId)
		return nil, fmt.Errorf("timeout waiting for job route to register: %w", err)
	}

	startJobData := wshrpc.CommandStartJobData{
		Cmd:        data.Cmd,
		Args:       data.Args,
		Env:        data.Env,
		TermSize:   data.TermSize,
		StreamMeta: data.StreamMeta,
	}
	rtnData, err := wshclient.StartJobCommand(impl.RpcClient, startJobData, &wshrpc.RpcOpts{Route: jobRouteId})
	if err != nil {
		conn.Close()
		impl.Router.UnregisterLink(linkId)
		return nil, fmt.Errorf("failed to start job: %w", err)
	}

	return rtnData, nil
}
