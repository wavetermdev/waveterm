// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/wavefileutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

func convertNotFoundErr(err error) error {
	if err == nil {
		return nil
	}
	if strings.HasPrefix(err.Error(), "NOTFOUND:") {
		return fs.ErrNotExist
	}
	return err
}

func ensureFile(origName string, fileData wshrpc.FileData) (*wshrpc.FileInfo, error) {
	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		err = wshclient.FileCreateCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
		if err != nil {
			return nil, fmt.Errorf("creating file: %w", err)
		}
		info, err = wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
		if err != nil {
			return nil, fmt.Errorf("getting file info: %w", err)
		}
		return info, err
	}
	if err != nil {
		return nil, fmt.Errorf("getting file info: %w", err)
	}
	return info, nil
}

func streamWriteToFile(fileData wshrpc.FileData, reader io.Reader) error {
	// First truncate the file with an empty write
	emptyWrite := fileData
	emptyWrite.Data64 = ""
	err := wshclient.FileWriteCommand(RpcClient, emptyWrite, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
	if err != nil {
		return fmt.Errorf("initializing file with empty write: %w", err)
	}

	const chunkSize = 32 * 1024 // 32KB chunks
	buf := make([]byte, chunkSize)
	totalWritten := int64(0)

	for {
		n, err := reader.Read(buf)
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("reading input: %w", err)
		}

		// Check total size
		totalWritten += int64(n)
		if totalWritten > MaxFileSize {
			return fmt.Errorf("input exceeds maximum file size of %d bytes", MaxFileSize)
		}

		// Prepare and send chunk
		chunk := buf[:n]
		appendData := fileData
		appendData.Data64 = base64.StdEncoding.EncodeToString(chunk)

		err = wshclient.FileAppendCommand(RpcClient, appendData, &wshrpc.RpcOpts{Timeout: int64(fileTimeout)})
		if err != nil {
			return fmt.Errorf("appending chunk to file: %w", err)
		}
	}

	return nil
}

func streamReadFromFile(fileData wshrpc.FileData, size int64, writer io.Writer) error {
	const chunkSize = 32 * 1024 // 32KB chunks
	for offset := int64(0); offset < size; offset += chunkSize {
		// Calculate the length of this chunk
		length := chunkSize
		if offset+int64(length) > size {
			length = int(size - offset)
		}

		// Set up the ReadAt request
		fileData.At = &wshrpc.FileDataAt{
			Offset: offset,
			Size:   length,
		}

		// Read the chunk
		data, err := wshclient.FileReadCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: int64(fileTimeout)})
		if err != nil {
			return fmt.Errorf("reading chunk at offset %d: %w", offset, err)
		}

		// Decode and write the chunk
		chunk, err := base64.StdEncoding.DecodeString(data.Data64)
		if err != nil {
			return fmt.Errorf("decoding chunk at offset %d: %w", offset, err)
		}

		_, err = writer.Write(chunk)
		if err != nil {
			return fmt.Errorf("writing chunk at offset %d: %w", offset, err)
		}
	}

	return nil
}

type fileListResult struct {
	info *wshrpc.FileInfo
	err  error
}

func streamFileList(zoneId string, path string, recursive bool, filesOnly bool) (<-chan fileListResult, error) {
	resultChan := make(chan fileListResult)

	// If path doesn't end in /, do a single file lookup
	if path != "" && !strings.HasSuffix(path, "/") {
		go func() {
			defer close(resultChan)

			fileData := wshrpc.FileData{
				Info: &wshrpc.FileInfo{
					Path: fmt.Sprintf(wavefileutil.WaveFilePathPattern, zoneId, path)},
			}

			info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
			err = convertNotFoundErr(err)
			if err == fs.ErrNotExist {
				resultChan <- fileListResult{err: fmt.Errorf("%s: No such file or directory", path)}
				return
			}
			if err != nil {
				resultChan <- fileListResult{err: err}
				return
			}
			resultChan <- fileListResult{info: info}
		}()
		return resultChan, nil
	}

	// Directory listing case
	go func() {
		defer close(resultChan)

		prefix := path
		prefixLen := len(prefix)
		offset := 0
		foundAny := false

		for {
			listData := wshrpc.FileListData{
				Path: fmt.Sprintf(wavefileutil.WaveFilePathPattern, zoneId, prefix),
				Opts: &wshrpc.FileListOpts{
					All:    recursive,
					Offset: offset,
					Limit:  100}}

			files, err := wshclient.FileListCommand(RpcClient, listData, &wshrpc.RpcOpts{Timeout: 2000})
			if err != nil {
				resultChan <- fileListResult{err: err}
				return
			}

			if len(files) == 0 {
				if !foundAny && prefix != "" {
					resultChan <- fileListResult{err: fmt.Errorf("%s: No such file or directory", path)}
				}
				return
			}

			for _, f := range files {
				if filesOnly && f.IsDir {
					continue
				}
				foundAny = true
				if prefixLen > 0 {
					f.Name = f.Name[prefixLen:]
				}
				resultChan <- fileListResult{info: f}
			}

			if len(files) < 100 {
				return
			}
			offset += len(files)
		}
	}()

	return resultChan, nil
}

func fixRelativePaths(path string) (string, error) {
	conn, err := connparse.ParseURI(path)
	if err != nil {
		return "", err
	}
	if conn.Scheme == connparse.ConnectionTypeWsh {
		if conn.Host == connparse.ConnHostCurrent {
			conn.Host = RpcContext.Conn
			fixedPath, err := fileutil.FixPath(conn.Path)
			if err != nil {
				return "", err
			}
			conn.Path = fixedPath
		}
		if conn.Host == "" {
			conn.Host = wshrpc.LocalConnName
		}
	}
	return conn.GetFullURI(), nil
}
