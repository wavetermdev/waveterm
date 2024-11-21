// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"strings"

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

func ensureWaveFile(origName string, fileData wshrpc.CommandFileData) (*wshrpc.WaveFileInfo, error) {
	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		createData := wshrpc.CommandFileCreateData{
			ZoneId:   fileData.ZoneId,
			FileName: fileData.FileName,
		}
		err = wshclient.FileCreateCommand(RpcClient, createData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
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

func streamWriteToWaveFile(fileData wshrpc.CommandFileData, reader io.Reader) error {
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

		err = wshclient.FileAppendCommand(RpcClient, appendData, &wshrpc.RpcOpts{Timeout: fileTimeout})
		if err != nil {
			return fmt.Errorf("appending chunk to file: %w", err)
		}
	}

	return nil
}

func streamReadFromWaveFile(fileData wshrpc.CommandFileData, size int64, writer io.Writer) error {
	const chunkSize = 32 * 1024 // 32KB chunks
	for offset := int64(0); offset < size; offset += chunkSize {
		// Calculate the length of this chunk
		length := chunkSize
		if offset+int64(length) > size {
			length = int(size - offset)
		}

		// Set up the ReadAt request
		fileData.At = &wshrpc.CommandFileDataAt{
			Offset: offset,
			Size:   int64(length),
		}

		// Read the chunk
		content64, err := wshclient.FileReadCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
		if err != nil {
			return fmt.Errorf("reading chunk at offset %d: %w", offset, err)
		}

		// Decode and write the chunk
		chunk, err := base64.StdEncoding.DecodeString(content64)
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
	info *wshrpc.WaveFileInfo
	err  error
}

func streamFileList(zoneId string, path string, recursive bool, filesOnly bool) (<-chan fileListResult, error) {
	resultChan := make(chan fileListResult)

	// If path doesn't end in /, do a single file lookup
	if path != "" && !strings.HasSuffix(path, "/") {
		go func() {
			defer close(resultChan)

			fileData := wshrpc.CommandFileData{
				ZoneId:   zoneId,
				FileName: path,
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
			listData := wshrpc.CommandFileListData{
				ZoneId: zoneId,
				Prefix: prefix,
				All:    recursive,
				Offset: offset,
				Limit:  100,
			}

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
