// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"archive/tar"
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
	"time"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/iochan"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

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
		innerFileInfo := statToFileInfo(filepath.Join(path, innerFileInfoInt.Name()), innerFileInfoInt, false)
		fileInfoArr = append(fileInfoArr, innerFileInfo)
		if len(fileInfoArr) >= wshrpc.DirChunkSize {
			log.Printf("sending %d entries\n", len(fileInfoArr))
			dataCallback(fileInfoArr, nil, byteRange)
			fileInfoArr = nil
		}
	}
	if len(fileInfoArr) > 0 {
		log.Printf("sending %d entries\n", len(fileInfoArr))
		dataCallback(fileInfoArr, nil, byteRange)
	}
	return nil
}

func (impl *ServerImpl) remoteStreamFileRegular(ctx context.Context, path string, byteRange ByteRangeType, dataCallback func(fileInfo []*wshrpc.FileInfo, data []byte, byteRange ByteRangeType)) error {
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
	finfo, err := impl.fileInfoInternal(data.Path, true)
	if err != nil {
		return fmt.Errorf("cannot stat file %q: %w", data.Path, err)
	}
	dataCallback([]*wshrpc.FileInfo{finfo}, nil, byteRange)
	if finfo.NotFound {
		return nil
	}
	if finfo.Size > wshrpc.MaxFileSize {
		return fmt.Errorf("file %q is too large to read, use /wave/stream-file", finfo.Path)
	}
	if finfo.IsDir {
		return impl.remoteStreamFileDir(ctx, finfo.Path, byteRange, dataCallback)
	} else {
		return impl.remoteStreamFileRegular(ctx, finfo.Path, byteRange, dataCallback)
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
			log.Printf("callback -- sending response %d\n", len(resp.Data64))
			ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: resp}
		})
		if err != nil {
			ch <- wshutil.RespErr[wshrpc.FileData](err)
		}
	}()
	return ch
}

func (impl *ServerImpl) RemoteTarStreamCommand(ctx context.Context, data wshrpc.CommandRemoteStreamTarData) <-chan wshrpc.RespOrErrorUnion[[]byte] {
	path := data.Path
	opts := data.Opts
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	recursive := opts.Recursive
	log.Printf("RemoteTarStreamCommand: path=%s\n", path)
	path, err := wavebase.ExpandHomeDir(path)
	if err != nil {
		return wshutil.SendErrCh[[]byte](fmt.Errorf("cannot expand path %q: %w", path, err))
	}
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDirSafe(path))
	finfo, err := os.Stat(cleanedPath)
	if err != nil {
		return wshutil.SendErrCh[[]byte](fmt.Errorf("cannot stat file %q: %w", path, err))
	}
	pipeReader, pipeWriter := io.Pipe()
	tarWriter := tar.NewWriter(pipeWriter)
	timeout := time.Millisecond * 100
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	readerCtx, _ := context.WithTimeout(context.Background(), timeout)
	rtn := iochan.ReaderChan(readerCtx, pipeReader, wshrpc.FileChunkSize, func() {
		pipeReader.Close()
		pipeWriter.Close()
	})

	var pathPrefix string
	if finfo.IsDir() && strings.HasSuffix(cleanedPath, "/") {
		pathPrefix = cleanedPath
	} else {
		pathPrefix = filepath.Dir(cleanedPath)
	}
	go func() {
		if readerCtx.Err() != nil {
			return
		}
		defer tarWriter.Close()
		log.Printf("creating tar stream for %q\n", path)
		if finfo.IsDir() {
			log.Printf("%q is a directory, recursive: %v\n", path, recursive)
			if !recursive {
				rtn <- wshutil.RespErr[[]byte](fmt.Errorf("cannot create tar stream for %q: %w", path, errors.New("directory copy requires recursive option")))
				return
			}
		}
		err := filepath.Walk(path, func(file string, fi os.FileInfo, err error) error {
			// generate tar header
			header, err := tar.FileInfoHeader(fi, file)
			if err != nil {
				return err
			}

			header.Name = strings.TrimPrefix(file, pathPrefix)
			if header.Name == "" {
				return nil
			}

			// write header
			if err := tarWriter.WriteHeader(header); err != nil {
				return err
			}
			// if not a dir, write file content
			if !fi.IsDir() {
				data, err := os.Open(file)
				if err != nil {
					return err
				}
				if n, err := io.Copy(tarWriter, data); err != nil {
					log.Printf("error copying file %q: %v\n", file, err)
					return err
				} else {
					log.Printf("wrote %d bytes to tar stream\n", n)
				}
			}
			time.Sleep(time.Millisecond * 10)
			return nil
		})
		if err != nil {
			rtn <- wshutil.RespErr[[]byte](fmt.Errorf("cannot create tar stream for %q: %w", path, err))
		}
		log.Printf("returning tar stream\n")
	}()
	log.Printf("returning channel\n")
	return rtn
}

func (impl *ServerImpl) RemoteFileCopyCommand(ctx context.Context, data wshrpc.CommandRemoteFileCopyData) error {
	log.Printf("RemoteFileCopyCommand: src=%s, dest=%s\n", data.SrcUri, data.DestUri)
	opts := data.Opts
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	destUri := data.DestUri
	srcUri := data.SrcUri
	// merge :=  opts.Merge
	overwrite := opts.Overwrite

	destConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, destUri)
	if err != nil {
		return fmt.Errorf("cannot parse destination URI %q: %w", srcUri, err)
	}
	destPathCleaned := filepath.Clean(wavebase.ExpandHomeDirSafe(destConn.Path))
	destinfo, err := os.Stat(destPathCleaned)
	if err == nil {
		if !destinfo.IsDir() {
			if !overwrite {
				return fmt.Errorf("destination %q already exists, use overwrite option", destPathCleaned)
			} else {
				err := os.Remove(destPathCleaned)
				if err != nil {
					return fmt.Errorf("cannot remove file %q: %w", destPathCleaned, err)
				}
			}
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("cannot stat destination %q: %w", destPathCleaned, err)
	}
	log.Printf("copying %q to %q\n", srcUri, destUri)
	srcConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, srcUri)
	if err != nil {
		return fmt.Errorf("cannot parse source URI %q: %w", srcUri, err)
	}
	if srcConn.Host == destConn.Host {
		log.Printf("same host, copying file\n")
		srcPathCleaned := filepath.Clean(wavebase.ExpandHomeDirSafe(srcConn.Path))
		err := os.Rename(srcPathCleaned, destPathCleaned)
		if err != nil {
			return fmt.Errorf("cannot copy file %q to %q: %w", srcPathCleaned, destPathCleaned, err)
		}
	} else {
		return fmt.Errorf("cannot copy file %q to %q: source and destination must be on the same host", srcUri, destPathCleaned)
	}
	/* TODO: uncomment once ready for cross-connection copy
	timeout := time.Millisecond * 100
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	readCtx, _ := context.WithTimeout(ctx, timeout)
	readCtx, cancel := context.WithCancelCause(readCtx)
	ioch := fileshare.ReadTarStream(readCtx, wshrpc.CommandRemoteStreamTarData{Path: srcUri, Opts: opts})
	pipeReader, pipeWriter := io.Pipe()
	iochan.WriterChan(readCtx, pipeWriter, ioch, func() {
		log.Printf("closing pipe writer\n")
		pipeWriter.Close()
		pipeReader.Close()
	}, cancel)
	defer cancel(nil)
	tarReader := tar.NewReader(pipeReader)
	for {
		select {
		case <-readCtx.Done():
			if readCtx.Err() != nil {
				return context.Cause(readCtx)
			}
			return nil
		default:
			next, err := tarReader.Next()
			if err != nil {
				if errors.Is(err, io.EOF) {
					// Do one more check for context error before returning
					if readCtx.Err() != nil {
						return context.Cause(readCtx)
					}
					return nil
				}
				return fmt.Errorf("cannot read tar stream: %w", err)
			}
			// Check for directory traversal
			if strings.Contains(next.Name, "..") {
				log.Printf("skipping file with unsafe path: %q\n", next.Name)
				continue
			}
			finfo := next.FileInfo()
			nextPath := filepath.Join(destPathCleaned, next.Name)
			destinfo, err = os.Stat(nextPath)
			if err != nil && !errors.Is(err, fs.ErrNotExist) {
				return fmt.Errorf("cannot stat file %q: %w", nextPath, err)
			}
			log.Printf("new file: name %q; dest %q\n", next.Name, nextPath)

			if destinfo != nil {
				if destinfo.IsDir() {
					if !finfo.IsDir() {
						if !overwrite {
							return fmt.Errorf("cannot create directory %q, file exists at path, overwrite not specified", nextPath)
						} else {
							err := os.Remove(nextPath)
							if err != nil {
								return fmt.Errorf("cannot remove file %q: %w", nextPath, err)
							}
						}
					} else if !merge && !overwrite {
						return fmt.Errorf("cannot create directory %q, directory exists at path, neither overwrite nor merge specified", nextPath)
					} else if overwrite {
						err := os.RemoveAll(nextPath)
						if err != nil {
							return fmt.Errorf("cannot remove directory %q: %w", nextPath, err)
						}
					}
				} else {
					if finfo.IsDir() {
						if !overwrite {
							return fmt.Errorf("cannot create file %q, directory exists at path, overwrite not specified", nextPath)
						} else {
							err := os.RemoveAll(nextPath)
							if err != nil {
								return fmt.Errorf("cannot remove directory %q: %w", nextPath, err)
							}
						}
					} else if !overwrite {
						return fmt.Errorf("cannot create file %q, file exists at path, overwrite not specified", nextPath)
					} else {
						err := os.Remove(nextPath)
						if err != nil {
							return fmt.Errorf("cannot remove file %q: %w", nextPath, err)
						}
					}
				}
			} else {
				if finfo.IsDir() {
					log.Printf("creating directory %q\n", nextPath)
					err := os.MkdirAll(nextPath, finfo.Mode())
					if err != nil {
						return fmt.Errorf("cannot create directory %q: %w", nextPath, err)
					}
				} else {
					err := os.MkdirAll(filepath.Dir(nextPath), 0755)
					if err != nil {
						return fmt.Errorf("cannot create parent directory %q: %w", filepath.Dir(nextPath), err)
					}
					file, err := os.Create(nextPath)
					if err != nil {
						return fmt.Errorf("cannot create new file %q: %w", nextPath, err)
					}
					_, err = io.Copy(file, tarReader)
					if err != nil {
						return fmt.Errorf("cannot write file %q: %w", nextPath, err)
					}
					file.Chmod(finfo.Mode())
					file.Close()
				}
			}
		}
	}*/
	return nil
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
		Dir:           computeDirPart(fullPath, finfo.IsDir()),
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
		fd.Close()
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
	path = filepath.Clean(wavebase.ExpandHomeDirSafe(path))
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
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDirSafe(path))
	finfo, err := os.Stat(cleanedPath)
	if os.IsNotExist(err) {
		return &wshrpc.FileInfo{
			Path:          wavebase.ReplaceHomeDir(path),
			Dir:           computeDirPart(path, false),
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

func (impl *ServerImpl) RemoteFileMoveCommand(ctx context.Context, data wshrpc.CommandRemoteFileCopyData) error {
	log.Printf("RemoteFileCopyCommand: src=%s, dest=%s\n", data.SrcUri, data.DestUri)
	opts := data.Opts
	destUri := data.DestUri
	srcUri := data.SrcUri
	overwrite := opts != nil && opts.Overwrite

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
	log.Printf("moving %q to %q\n", srcUri, destUri)
	srcConn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, srcUri)
	if err != nil {
		return fmt.Errorf("cannot parse source URI %q: %w", srcUri, err)
	}
	log.Printf("source host: %q, destination host: %q\n", srcConn.Host, destConn.Host)
	if srcConn.Host == destConn.Host {
		log.Printf("moving file on same host\n")
		srcPathCleaned := filepath.Clean(wavebase.ExpandHomeDirSafe(srcConn.Path))
		log.Printf("moving %q to %q\n", srcPathCleaned, destPathCleaned)
		err := os.Rename(srcPathCleaned, destPathCleaned)
		if err != nil {
			return fmt.Errorf("cannot move file %q to %q: %w", srcPathCleaned, destPathCleaned, err)
		}
	} else {
		return fmt.Errorf("cannot move file %q to %q: source and destination must be on the same host", srcUri, destUri)
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
	path, err := wavebase.ExpandHomeDir(data.Info.Path)
	if err != nil {
		return err
	}
	createMode := data.Info.Mode
	if createMode == 0 {
		createMode = 0644
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
	offset := fileSize
	if data.At != nil {
		if data.At.Offset > 0 {
			offset = min(data.At.Offset, fileSize)
		}
	}

	openFlags := os.O_CREATE | os.O_WRONLY
	if data.Info.Opts.Truncate {
		openFlags |= os.O_TRUNC
	}
	if data.Info.Opts.Append {
		openFlags |= os.O_APPEND
	}

	file, err := os.OpenFile(path, openFlags, createMode)
	if err != nil {
		return fmt.Errorf("cannot open file %q: %w", path, err)
	}
	if offset > 0 && !data.Info.Opts.Append {
		n, err = file.WriteAt(dataBytes[:n], offset)
	} else {
		n, err = file.Write(dataBytes[:n])
	}
	if err != nil {
		return fmt.Errorf("cannot write to file %q: %w", path, err)
	}
	log.Printf("wrote %d bytes to file %q at offset %q\n", n, path, offset)
	return nil
}

func (*ServerImpl) RemoteFileDeleteCommand(ctx context.Context, path string) error {
	expandedPath, err := wavebase.ExpandHomeDir(path)
	if err != nil {
		return fmt.Errorf("cannot delete file %q: %w", path, err)
	}
	cleanedPath := filepath.Clean(expandedPath)
	err = os.Remove(cleanedPath)
	if err != nil {
		return fmt.Errorf("cannot delete file %q: %w", path, err)
	}
	return nil
}

func (*ServerImpl) RemoteGetInfoCommand(ctx context.Context) (wshrpc.RemoteInfo, error) {
	return wshutil.GetInfo(), nil
}

func (*ServerImpl) RemoteInstallRcFilesCommand(ctx context.Context) error {
	return wshutil.InstallRcFiles()
}
