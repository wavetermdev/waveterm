// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
)

const MaxFileSize = 50 * 1024 * 1024 // 10M

var serverCmd = &cobra.Command{
	Use:   "server",
	Short: "remote server to power wave blocks",
	Args:  cobra.NoArgs,
	Run:   serverRun,
}

type ServerImpl struct{}

func (*ServerImpl) WshServerImpl() {}

func (*ServerImpl) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	WriteStderr("[message] %q\n", data.Message)
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

func (impl *ServerImpl) remoteStreamFileDir(ctx context.Context, path string, byteRange ByteRangeType, dataCallback func(fileInfo *wshrpc.FileInfo, data []byte)) error {
	innerFilesEntries, err := os.ReadDir(path)
	if err != nil {
		return fmt.Errorf("cannot open dir %q: %w", path, err)
	}
	if byteRange.All {
		if len(innerFilesEntries) > 1000 {
			innerFilesEntries = innerFilesEntries[:1000]
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
	parent := filepath.Dir(path)
	parentFileInfo, err := impl.RemoteFileInfoCommand(ctx, parent)
	if err == nil && parent != path {
		parentFileInfo.Name = ".."
		parentFileInfo.Size = -1
		dataCallback(parentFileInfo, nil)
	}
	for _, innerFileEntry := range innerFilesEntries {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		innerFileInfoInt, err := innerFileEntry.Info()
		if err != nil {
			continue
		}
		mimeType := utilfn.DetectMimeType(filepath.Join(path, innerFileInfoInt.Name()))
		var fileSize int64
		if mimeType == "directory" {
			fileSize = -1
		} else {
			fileSize = innerFileInfoInt.Size()
		}
		innerFileInfo := wshrpc.FileInfo{
			Path:     filepath.Join(path, innerFileInfoInt.Name()),
			Name:     innerFileInfoInt.Name(),
			Size:     fileSize,
			Mode:     innerFileInfoInt.Mode(),
			ModeStr:  innerFileInfoInt.Mode().String(),
			ModTime:  innerFileInfoInt.ModTime().UnixMilli(),
			IsDir:    innerFileInfoInt.IsDir(),
			MimeType: mimeType,
		}
		dataCallback(&innerFileInfo, nil)
	}
	return nil
}

func (impl *ServerImpl) remoteStreamFileRegular(ctx context.Context, path string, byteRange ByteRangeType, dataCallback func(fileInfo *wshrpc.FileInfo, data []byte)) error {
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
	buf := make([]byte, 4096)
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
		if filePos >= byteRange.End {
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

func (impl *ServerImpl) remoteStreamFileInternal(ctx context.Context, data wshrpc.CommandRemoteStreamFileData, dataCallback func(fileInfo *wshrpc.FileInfo, data []byte)) error {
	byteRange, err := parseByteRange(data.ByteRange)
	if err != nil {
		return err
	}
	path := data.Path
	path = wavebase.ExpandHomeDir(path)
	finfo, err := impl.RemoteFileInfoCommand(ctx, path)
	if err != nil {
		return fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	dataCallback(finfo, nil)
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
	err := impl.remoteStreamFileInternal(ctx, data, func(fileInfo *wshrpc.FileInfo, data []byte) {
		resp := wshrpc.CommandRemoteStreamFileRtnData{}
		resp.FileInfo = fileInfo
		if len(data) > 0 {
			resp.Data64 = base64.RawStdEncoding.EncodeToString(data)
		}
		ch <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteStreamFileRtnData]{Response: resp}
	})
	if err != nil {
		ch <- respErr(err)
	}
	return ch
}

func (*ServerImpl) RemoteFileInfoCommand(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDir(path))
	finfo, err := os.Stat(cleanedPath)
	if os.IsNotExist(err) {
		return &wshrpc.FileInfo{Path: wavebase.ReplaceHomeDir(path), NotFound: true}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	mimeType := utilfn.DetectMimeType(cleanedPath)
	return &wshrpc.FileInfo{
		Path:     cleanedPath,
		Name:     finfo.Name(),
		Size:     finfo.Size(),
		Mode:     finfo.Mode(),
		ModeStr:  finfo.Mode().String(),
		ModTime:  finfo.ModTime().UnixMilli(),
		IsDir:    finfo.IsDir(),
		MimeType: mimeType,
	}, nil
}

func init() {
	rootCmd.AddCommand(serverCmd)
}

func serverRun(cmd *cobra.Command, args []string) {
	WriteStdout("running wsh server\n")
	RpcClient.SetServerImpl(&ServerImpl{})
	err := wshclient.TestCommand(RpcClient, "hello", nil)
	WriteStdout("got test rtn: %v\n", err)

	select {} // run forever
}
