// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fsutil"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
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

func ensureFile(fileData wshrpc.FileData) (*wshrpc.FileInfo, error) {
	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		err = wshclient.FileCreateCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
		if err != nil {
			return nil, fmt.Errorf("creating file: %w", err)
		}
		info, err = wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
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
	err := wshclient.FileWriteCommand(RpcClient, emptyWrite, &wshrpc.RpcOpts{Timeout: fileTimeout})
	if err != nil {
		return fmt.Errorf("initializing file with empty write: %w", err)
	}

	const chunkSize = wshrpc.FileChunkSize // 32KB chunks
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

func streamReadFromFile(ctx context.Context, fileData wshrpc.FileData, writer io.Writer) error {
	ch := wshclient.FileReadStreamCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	return fsutil.ReadFileStreamToWriter(ctx, ch, writer)
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
