// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshfs

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fsutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const RemoteFileTransferSizeLimit = 32 * 1024 * 1024

// This needs to be set by whoever initializes the client, either main-server or wshcmd-connserver
var RpcClient *wshutil.WshRpc

type WshClient struct{}

var _ fstype.FileShareClient = WshClient{}

func NewWshClient() *WshClient {
	return &WshClient{}
}

func (c WshClient) Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error) {
	rtnCh := c.ReadStream(ctx, conn, data)
	return fsutil.ReadStreamToFileData(ctx, rtnCh)
}

func (c WshClient) ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	byteRange := ""
	if data.At != nil && data.At.Size > 0 {
		byteRange = fmt.Sprintf("%d-%d", data.At.Offset, data.At.Offset+int64(data.At.Size))
	}
	streamFileData := wshrpc.CommandRemoteStreamFileData{Path: conn.Path, ByteRange: byteRange}
	return wshclient.RemoteStreamFileCommand(RpcClient, streamFileData, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
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
	dataSize := base64.StdEncoding.DecodedLen(len(data.Data64))
	if dataSize > RemoteFileTransferSizeLimit {
		return fmt.Errorf("file data size %d exceeds transfer limit of %d bytes", dataSize, RemoteFileTransferSizeLimit)
	}
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
	dataSize := base64.StdEncoding.DecodedLen(len(data.Data64))
	if dataSize > RemoteFileTransferSizeLimit {
		return fmt.Errorf("file data size %d exceeds transfer limit of %d bytes", dataSize, RemoteFileTransferSizeLimit)
	}
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

func (c WshClient) MoveInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	if srcConn.Host != destConn.Host {
		return fmt.Errorf("move internal, src and dest hosts do not match")
	}
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = fstype.DefaultTimeout.Milliseconds()
	}
	return wshclient.RemoteFileMoveCommand(RpcClient, wshrpc.CommandFileCopyData{SrcUri: srcConn.GetFullURI(), DestUri: destConn.GetFullURI(), Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(destConn.Host), Timeout: timeout})
}

func (c WshClient) CopyRemote(ctx context.Context, srcConn, destConn *connparse.Connection, _ fstype.FileShareClient, opts *wshrpc.FileCopyOpts) (bool, error) {
	return c.CopyInternal(ctx, srcConn, destConn, opts)
}

func (c WshClient) CopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) (bool, error) {
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = fstype.DefaultTimeout.Milliseconds()
	}
	return wshclient.RemoteFileCopyCommand(RpcClient, wshrpc.CommandFileCopyData{SrcUri: srcConn.GetFullURI(), DestUri: destConn.GetFullURI(), Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(destConn.Host), Timeout: timeout})
}

func (c WshClient) Delete(ctx context.Context, conn *connparse.Connection, recursive bool) error {
	return wshclient.RemoteFileDeleteCommand(RpcClient, wshrpc.CommandDeleteFileData{Path: conn.Path, Recursive: recursive}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Join(ctx context.Context, conn *connparse.Connection, parts ...string) (*wshrpc.FileInfo, error) {
	return wshclient.RemoteFileJoinCommand(RpcClient, append([]string{conn.Path}, parts...), &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) GetConnectionType() string {
	return connparse.ConnectionTypeWsh
}

func (c WshClient) GetCapability() wshrpc.FileShareCapability {
	return wshrpc.FileShareCapability{CanAppend: true, CanMkdir: true}
}
