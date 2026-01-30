// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshfs

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fsutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	RemoteFileTransferSizeLimit = 32 * 1024 * 1024
	DefaultTimeout              = 30 * time.Second
	FileMode                    = os.FileMode(0644)
	DirMode                     = os.FileMode(0755) | os.ModeDir
	RecursiveRequiredError      = "recursive flag must be set for directory operations"
	MergeRequiredError          = "directory already exists at %q, set overwrite flag to delete the existing contents or set merge flag to merge the contents"
	OverwriteRequiredError      = "file already exists at %q, set overwrite flag to delete the existing file"
)

// This needs to be set by whoever initializes the client, either main-server or wshcmd-connserver
var RpcClient *wshutil.WshRpc

func parseConnection(ctx context.Context, path string) (*connparse.Connection, error) {
	conn, err := connparse.ParseURIAndReplaceCurrentHost(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("error parsing connection %s: %w", path, err)
	}
	return conn, nil
}

func Read(ctx context.Context, data wshrpc.FileData) (*wshrpc.FileData, error) {
	log.Printf("Read: %v", data.Info.Path)
	conn, err := parseConnection(ctx, data.Info.Path)
	if err != nil {
		return nil, err
	}
	rtnCh := readStream(conn, data)
	return fsutil.ReadStreamToFileData(ctx, rtnCh)
}

func ReadStream(ctx context.Context, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	log.Printf("ReadStream: %v", data.Info.Path)
	conn, err := parseConnection(ctx, data.Info.Path)
	if err != nil {
		return wshutil.SendErrCh[wshrpc.FileData](err)
	}
	return readStream(conn, data)
}

func readStream(conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	byteRange := ""
	if data.At != nil && data.At.Size > 0 {
		byteRange = fmt.Sprintf("%d-%d", data.At.Offset, data.At.Offset+int64(data.At.Size))
	}
	streamFileData := wshrpc.CommandRemoteStreamFileData{Path: conn.Path, ByteRange: byteRange}
	return wshclient.RemoteStreamFileCommand(RpcClient, streamFileData, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func ListEntries(ctx context.Context, path string, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	log.Printf("ListEntries: %v", path)
	conn, err := parseConnection(ctx, path)
	if err != nil {
		return nil, err
	}
	var entries []*wshrpc.FileInfo
	rtnCh := listEntriesStream(conn, opts)
	for respUnion := range rtnCh {
		if respUnion.Error != nil {
			return nil, respUnion.Error
		}
		resp := respUnion.Response
		entries = append(entries, resp.FileInfo...)
	}
	return entries, nil
}

func ListEntriesStream(ctx context.Context, path string, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	log.Printf("ListEntriesStream: %v", path)
	conn, err := parseConnection(ctx, path)
	if err != nil {
		return wshutil.SendErrCh[wshrpc.CommandRemoteListEntriesRtnData](err)
	}
	return listEntriesStream(conn, opts)
}

func listEntriesStream(conn *connparse.Connection, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	return wshclient.RemoteListEntriesCommand(RpcClient, wshrpc.CommandRemoteListEntriesData{Path: conn.Path, Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func Stat(ctx context.Context, path string) (*wshrpc.FileInfo, error) {
	log.Printf("Stat: %v", path)
	conn, err := parseConnection(ctx, path)
	if err != nil {
		return nil, err
	}
	return stat(conn)
}

func stat(conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	return wshclient.RemoteFileInfoCommand(RpcClient, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func PutFile(ctx context.Context, data wshrpc.FileData) error {
	log.Printf("PutFile: %v", data.Info.Path)
	conn, err := parseConnection(ctx, data.Info.Path)
	if err != nil {
		return err
	}
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

func Append(ctx context.Context, data wshrpc.FileData) error {
	log.Printf("Append: %v", data.Info.Path)
	conn, err := parseConnection(ctx, data.Info.Path)
	if err != nil {
		return err
	}
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

func Mkdir(ctx context.Context, path string) error {
	log.Printf("Mkdir: %v", path)
	conn, err := parseConnection(ctx, path)
	if err != nil {
		return err
	}
	return wshclient.RemoteMkdirCommand(RpcClient, conn.Path, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func Move(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	opts := data.Opts
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	log.Printf("Move: srcuri: %v, desturi: %v, opts: %v", data.SrcUri, data.DestUri, opts)
	srcConn, err := parseConnection(ctx, data.SrcUri)
	if err != nil {
		return fmt.Errorf("error parsing source connection: %w", err)
	}
	destConn, err := parseConnection(ctx, data.DestUri)
	if err != nil {
		return fmt.Errorf("error parsing destination connection: %w", err)
	}
	if srcConn.Host != destConn.Host {
		isDir, err := copyInternal(srcConn, destConn, opts)
		if err != nil {
			return fmt.Errorf("cannot copy %q to %q: %w", data.SrcUri, data.DestUri, err)
		}
		return delete_(srcConn, opts.Recursive && isDir)
	}
	return moveInternal(srcConn, destConn, opts)
}

func Copy(ctx context.Context, data wshrpc.CommandFileCopyData) error {
	opts := data.Opts
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	log.Printf("Copy: srcuri: %v, desturi: %v, opts: %v", data.SrcUri, data.DestUri, opts)
	srcConn, err := parseConnection(ctx, data.SrcUri)
	if err != nil {
		return fmt.Errorf("error parsing source connection: %w", err)
	}
	destConn, err := parseConnection(ctx, data.DestUri)
	if err != nil {
		return fmt.Errorf("error parsing destination connection: %w", err)
	}
	_, err = copyInternal(srcConn, destConn, opts)
	return err
}

func Delete(ctx context.Context, data wshrpc.CommandDeleteFileData) error {
	log.Printf("Delete: %v", data)
	conn, err := parseConnection(ctx, data.Path)
	if err != nil {
		return err
	}
	return delete_(conn, data.Recursive)
}

func delete_(conn *connparse.Connection, recursive bool) error {
	return wshclient.RemoteFileDeleteCommand(RpcClient, wshrpc.CommandDeleteFileData{Path: conn.Path, Recursive: recursive}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func Join(ctx context.Context, path string, parts ...string) (*wshrpc.FileInfo, error) {
	log.Printf("Join: %v", path)
	conn, err := parseConnection(ctx, path)
	if err != nil {
		return nil, err
	}
	return wshclient.RemoteFileJoinCommand(RpcClient, append([]string{conn.Path}, parts...), &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(conn.Host)})
}

func moveInternal(srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	if srcConn.Host != destConn.Host {
		return fmt.Errorf("move internal, src and dest hosts do not match")
	}
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout.Milliseconds()
	}
	return wshclient.RemoteFileMoveCommand(RpcClient, wshrpc.CommandFileCopyData{SrcUri: srcConn.GetFullURI(), DestUri: destConn.GetFullURI(), Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(destConn.Host), Timeout: timeout})
}

func copyInternal(srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) (bool, error) {
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout.Milliseconds()
	}
	return wshclient.RemoteFileCopyCommand(RpcClient, wshrpc.CommandFileCopyData{SrcUri: srcConn.GetFullURI(), DestUri: destConn.GetFullURI(), Opts: opts}, &wshrpc.RpcOpts{Route: wshutil.MakeConnectionRouteId(destConn.Host), Timeout: timeout})
}
