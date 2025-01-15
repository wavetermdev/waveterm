// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshfs

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type WshClient struct{}

var _ fstype.FileShareClient = WshClient{}

func NewWshClient() *WshClient {
	return &WshClient{}
}

func (c WshClient) Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error) {
	log.Printf("WshClient:Read: path=%s; conn=%v; data=%v", conn.Path, conn, data)
	client := wshclient.GetBareRpcClient()
	byteRange := ""
	if data.At.Size > 0 {
		byteRange = fmt.Sprintf("%d-%d", data.At.Offset, data.At.Offset+data.At.Size)
	}
	streamFileData := wshrpc.CommandRemoteStreamFileData{Path: conn.Path, ByteRange: byteRange}
	rtnCh := wshclient.RemoteStreamFileCommand(client, streamFileData, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
	fullFile := &wshrpc.FileData{}
	firstPk := true
	isDir := false
	var fileBuf bytes.Buffer
	var fileInfoArr []*wshrpc.FileInfo
	for respUnion := range rtnCh {
		if respUnion.Error != nil {
			return nil, respUnion.Error
		}
		resp := respUnion.Response
		if firstPk {
			firstPk = false
			// first packet has the fileinfo
			if len(resp.FileInfo) != 1 {
				return nil, fmt.Errorf("stream file protocol error, first pk fileinfo len=%d", len(resp.FileInfo))
			}
			fullFile.Info = resp.FileInfo[0]
			if fullFile.Info.IsDir {
				isDir = true
			}
			continue
		}
		if isDir {
			if len(resp.FileInfo) == 0 {
				continue
			}
			fileInfoArr = append(fileInfoArr, resp.FileInfo...)
		} else {
			if resp.Data64 == "" {
				continue
			}
			decoder := base64.NewDecoder(base64.StdEncoding, bytes.NewReader([]byte(resp.Data64)))
			_, err := io.Copy(&fileBuf, decoder)
			if err != nil {
				return nil, fmt.Errorf("stream file, failed to decode base64 data %q: %w", resp.Data64, err)
			}
		}
	}
	if isDir {
		entries, err := listEntriesInternal(client, conn, &wshrpc.FileListOpts{}, &wshrpc.FileData{Entries: fileInfoArr})
		if err != nil {
			return nil, fmt.Errorf("stream file, failed to list entries: %w", err)
		}
		fullFile.Entries = entries
	} else {
		// we can avoid this re-encoding if we ensure the remote side always encodes chunks of 3 bytes so we don't get padding chars
		fullFile.Data64 = base64.StdEncoding.EncodeToString(fileBuf.Bytes())
	}
	return fullFile, nil
}

func (c WshClient) ListEntries(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	return listEntriesInternal(wshclient.GetBareRpcClient(), conn, opts, nil)
}

func listEntriesInternal(client *wshutil.WshRpc, conn *connparse.Connection, opts *wshrpc.FileListOpts, data *wshrpc.FileData) ([]*wshrpc.FileInfo, error) {
	var entries []*wshrpc.FileInfo
	if opts.All || data == nil {
		rtnCh := wshclient.RemoteListEntriesCommand(client, wshrpc.CommandRemoteListEntriesData{Path: conn.Path, Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
		log.Printf("listEntriesInternal: remote list entries")
		for respUnion := range rtnCh {
			if respUnion.Error != nil {
				return nil, respUnion.Error
			}
			resp := respUnion.Response
			entries = append(entries, resp.FileInfo...)
		}
		log.Printf("listEntriesInternal: remote list entries done")
	} else {
		entries = append(entries, data.Entries...)
		if opts.Offset > 0 {
			if opts.Offset >= len(entries) {
				entries = nil
			} else {
				entries = entries[opts.Offset:]
			}
		}
		if opts.Limit > 0 {
			if opts.Limit < len(entries) {
				entries = entries[:opts.Limit]
			}
		}
	}
	return entries, nil
}

func (c WshClient) ListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	client := wshclient.GetBareRpcClient()
	return wshclient.RemoteListEntriesCommand(client, wshrpc.CommandRemoteListEntriesData{Path: conn.Path, Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	client := wshclient.GetBareRpcClient()
	return wshclient.RemoteFileInfoCommand(client, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) PutFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	client := wshclient.GetBareRpcClient()
	writeData := wshrpc.CommandRemoteWriteFileData{Path: conn.Path, Data64: data.Data64}
	return wshclient.RemoteWriteFileCommand(client, writeData, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Mkdir(ctx context.Context, conn *connparse.Connection) error {
	client := wshclient.GetBareRpcClient()
	return wshclient.RemoteMkdirCommand(client, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) Move(ctx context.Context, srcConn, destConn *connparse.Connection, recursive bool) error {
	client := wshclient.GetBareRpcClient()
	return wshclient.RemoteFileRenameCommand(client, [2]string{srcConn.Path, destConn.Path}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(srcConn.Host)})
}

func (c WshClient) Copy(ctx context.Context, srcConn, destConn *connparse.Connection, recursive bool) error {
	return nil
}

func (c WshClient) Delete(ctx context.Context, conn *connparse.Connection) error {
	client := wshclient.GetBareRpcClient()
	return wshclient.RemoteFileDeleteCommand(client, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func (c WshClient) GetConnectionType() string {
	return connparse.ConnectionTypeWsh
}
