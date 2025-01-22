// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshfs

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	ThirtySeconds = 30 * 1000
)

// This needs to be set by whoever initializes the client, either main-server or wshcmd-connserver
var RpcClient *wshutil.WshRpc

type WshClient struct{}

var _ fstype.FileShareClient = WshClient{}

func NewWshClient() *WshClient {
	return &WshClient{}
}

func (c WshClient) Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error) {
	rtnCh := c.ReadStream(ctx, conn, data)
	var fileData *wshrpc.FileData
	firstPk := true
	isDir := false
	var fileBuf bytes.Buffer
	for respUnion := range rtnCh {
		if respUnion.Error != nil {
			return nil, respUnion.Error
		}
		resp := respUnion.Response
		if firstPk {
			firstPk = false
			// first packet has the fileinfo
			if resp.Info == nil {
				return nil, fmt.Errorf("stream file protocol error, first pk fileinfo is empty")
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
			fileData.Entries = append(fileData.Entries, resp.Entries...)
		} else {
			if resp.Data64 == "" {
				continue
			}
			decoder := base64.NewDecoder(base64.StdEncoding, bytes.NewReader([]byte(resp.Data64)))
			_, err := io.Copy(&fileBuf, decoder)
			if err != nil {
				return nil, fmt.Errorf("stream file, failed to decode base64 data: %w", err)
			}
		}
	}
	if !isDir {
		fileData.Data64 = base64.StdEncoding.EncodeToString(fileBuf.Bytes())
	}
	return fileData, nil
}

func (c WshClient) ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	byteRange := ""
	if data.At != nil && data.At.Size > 0 {
		byteRange = fmt.Sprintf("%d-%d", data.At.Offset, data.At.Offset+int64(data.At.Size))
	}
	streamFileData := wshrpc.CommandRemoteStreamFileData{Path: conn.Path, ByteRange: byteRange}
	return wshclient.RemoteStreamFileCommand(RpcClient, streamFileData, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) ReadTarStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileCopyOpts) <-chan wshrpc.RespOrErrorUnion[[]byte] {
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = ThirtySeconds
	}
	return wshclient.RemoteTarStreamCommand(RpcClient, wshrpc.CommandRemoteStreamTarData{Path: conn.Path, Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host), Timeout: timeout})
}

func (c WshClient) ListEntries(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	var entries []*wshrpc.FileInfo
	rtnCh := c.ListEntriesStream(ctx, conn, opts)
	for respUnion := range rtnCh {
		if respUnion.Error != nil {
			return nil, respUnion.Error
		}
		resp := respUnion.Response
		entries = append(entries, resp.FileInfo...)
	}
	return entries, nil
}

func (c WshClient) ListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	return wshclient.RemoteListEntriesCommand(RpcClient, wshrpc.CommandRemoteListEntriesData{Path: conn.Path, Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	return wshclient.RemoteFileInfoCommand(RpcClient, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) PutFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	info := data.Info
	if info == nil {
		info = &wshrpc.FileInfo{Opts: &wshrpc.FileOpts{}}
	} else if info.Opts == nil {
		info.Opts = &wshrpc.FileOpts{}
	}
	info.Path = conn.Path
	info.Opts.Truncate = true
	data.Info = info
	return wshclient.RemoteWriteFileCommand(RpcClient, data, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) AppendFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	info := data.Info
	if info == nil {
		info = &wshrpc.FileInfo{Path: conn.Path, Opts: &wshrpc.FileOpts{}}
	} else if info.Opts == nil {
		info.Opts = &wshrpc.FileOpts{}
	}
	info.Path = conn.Path
	info.Opts.Append = true
	data.Info = info
	return wshclient.RemoteWriteFileCommand(RpcClient, data, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Mkdir(ctx context.Context, conn *connparse.Connection) error {
	return wshclient.RemoteMkdirCommand(RpcClient, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Move(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = ThirtySeconds
	}
	return wshclient.RemoteFileMoveCommand(RpcClient, wshrpc.CommandRemoteFileCopyData{SrcUri: srcConn.GetFullURI(), DestUri: destConn.GetFullURI(), Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(destConn.Host), Timeout: timeout})
}

func (c WshClient) Copy(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = ThirtySeconds
	}
	return wshclient.RemoteFileCopyCommand(RpcClient, wshrpc.CommandRemoteFileCopyData{SrcUri: srcConn.GetFullURI(), DestUri: destConn.GetFullURI(), Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(destConn.Host), Timeout: timeout})
}

func (c WshClient) Delete(ctx context.Context, conn *connparse.Connection) error {
	return wshclient.RemoteFileDeleteCommand(RpcClient, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Join(ctx context.Context, conn *connparse.Connection, parts ...string) (string, error) {
	finfo, err := wshclient.RemoteFileJoinCommand(RpcClient, append([]string{conn.Path}, parts...), &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
	if err != nil {
		return "", err
	}
	return finfo.Path, nil
}

func (c WshClient) GetConnectionType() string {
	return connparse.ConnectionTypeWsh
}
