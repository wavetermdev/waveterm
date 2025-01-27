// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavefs

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/util/wavefileutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type WaveClient struct{}

var _ fstype.FileShareClient = WaveClient{}

func NewWaveClient() *WaveClient {
	return &WaveClient{}
}

func (c WaveClient) ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) <-chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileData], 16)
	go func() {
		defer close(ch)
		rtnData, err := c.Read(ctx, conn, data)
		if err != nil {
			ch <- wshutil.RespErr[wshrpc.FileData](err)
			return
		}
		dataLen := len(rtnData.Data64)
		if !rtnData.Info.IsDir {
			for i := 0; i < dataLen; i += wshrpc.FileChunkSize {
				if ctx.Err() != nil {
					ch <- wshutil.RespErr[wshrpc.FileData](ctx.Err())
					return
				}
				dataEnd := min(i+wshrpc.FileChunkSize, dataLen)
				ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Data64: rtnData.Data64[i:dataEnd], Info: rtnData.Info, At: &wshrpc.FileDataAt{Offset: int64(i), Size: dataEnd - i}}}
			}
		} else {
			for i := 0; i < len(rtnData.Entries); i += wshrpc.DirChunkSize {
				if ctx.Err() != nil {
					ch <- wshutil.RespErr[wshrpc.FileData](ctx.Err())
					return
				}
				ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Entries: rtnData.Entries[i:min(i+wshrpc.DirChunkSize, len(rtnData.Entries))], Info: rtnData.Info}}
			}
		}
	}()
	return ch
}

func (c WaveClient) Read(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) (*wshrpc.FileData, error) {
	zoneId := conn.Host
	if zoneId == "" {
		return nil, fmt.Errorf("zoneid not found in connection")
	}
	fileName, err := cleanPath(conn.Path)
	if err != nil {
		return nil, fmt.Errorf("error cleaning path: %w", err)
	}
	if data.At != nil {
		_, dataBuf, err := filestore.WFS.ReadAt(ctx, zoneId, fileName, data.At.Offset, int64(data.At.Size))
		if err == nil {
			return &wshrpc.FileData{Info: data.Info, Data64: base64.StdEncoding.EncodeToString(dataBuf)}, nil
		} else if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("NOTFOUND: %w", err)
		} else {
			return nil, fmt.Errorf("error reading blockfile: %w", err)
		}
	} else {
		_, dataBuf, err := filestore.WFS.ReadFile(ctx, zoneId, fileName)
		if err == nil {
			return &wshrpc.FileData{Info: data.Info, Data64: base64.StdEncoding.EncodeToString(dataBuf)}, nil
		} else if !errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("error reading blockfile: %w", err)
		}
	}
	list, err := c.ListEntries(ctx, conn, nil)
	if err != nil {
		return nil, fmt.Errorf("error listing blockfiles: %w", err)
	}
	return &wshrpc.FileData{Info: data.Info, Entries: list}, nil
}

func (c WaveClient) ReadTarStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileCopyOpts) <-chan wshrpc.RespOrErrorUnion[[]byte] {
	return nil
}

func (c WaveClient) ListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 16)
	go func() {
		defer close(ch)
		list, err := c.ListEntries(ctx, conn, opts)
		if err != nil {
			ch <- wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err)
			return
		}
		for i := 0; i < len(list); i += wshrpc.DirChunkSize {
			ch <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: list[i:min(i+wshrpc.DirChunkSize, len(list))]}}
		}
	}()
	return ch
}

func (c WaveClient) ListEntries(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) ([]*wshrpc.FileInfo, error) {
	zoneId := conn.Host
	if zoneId == "" {
		return nil, fmt.Errorf("zoneid not found in connection")
	}
	prefix, err := cleanPath(conn.Path)
	if err != nil {
		return nil, fmt.Errorf("error cleaning path: %w", err)
	}
	fileListOrig, err := filestore.WFS.ListFiles(ctx, zoneId)
	if err != nil {
		return nil, fmt.Errorf("error listing blockfiles: %w", err)
	}
	var fileList []*wshrpc.FileInfo
	for _, wf := range fileListOrig {
		fileList = append(fileList, wavefileutil.WaveFileToFileInfo(wf))
	}
	if prefix != "" {
		var filteredList []*wshrpc.FileInfo
		for _, file := range fileList {
			if strings.HasPrefix(file.Name, prefix) {
				filteredList = append(filteredList, file)
			}
		}
		fileList = filteredList
	}
	if !opts.All {
		var filteredList []*wshrpc.FileInfo
		dirMap := make(map[string]any) // the value is max modtime
		for _, file := range fileList {
			// if there is an extra "/" after the prefix, don't include it
			// first strip the prefix
			relPath := strings.TrimPrefix(file.Name, prefix)
			// then check if there is a "/" after the prefix
			if strings.Contains(relPath, "/") {
				dirPath := strings.Split(relPath, "/")[0]
				dirMap[dirPath] = struct{}{}
				continue
			}
			filteredList = append(filteredList, file)
		}
		for dir := range dirMap {
			dirName := prefix + dir + "/"
			filteredList = append(filteredList, &wshrpc.FileInfo{
				Path:          fmt.Sprintf(wavefileutil.WaveFilePathPattern, zoneId, dirName),
				Name:          dirName,
				Dir:           dirName,
				Size:          0,
				IsDir:         true,
				SupportsMkdir: false,
			})
		}
		fileList = filteredList
	}
	if opts.Offset > 0 {
		if opts.Offset >= len(fileList) {
			fileList = nil
		} else {
			fileList = fileList[opts.Offset:]
		}
	}
	if opts.Limit > 0 {
		if opts.Limit < len(fileList) {
			fileList = fileList[:opts.Limit]
		}
	}
	return fileList, nil
}

func (c WaveClient) Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	zoneId := conn.Host
	if zoneId == "" {
		return nil, fmt.Errorf("zoneid not found in connection")
	}
	fileName, err := cleanPath(conn.Path)
	if err != nil {
		return nil, fmt.Errorf("error cleaning path: %w", err)
	}
	fileInfo, err := filestore.WFS.Stat(ctx, zoneId, fileName)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("NOTFOUND: %w", err)
		}
		return nil, fmt.Errorf("error getting file info: %w", err)
	}
	return wavefileutil.WaveFileToFileInfo(fileInfo), nil
}

func (c WaveClient) PutFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	dataBuf, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return fmt.Errorf("error decoding data64: %w", err)
	}
	zoneId := conn.Host
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	fileName, err := cleanPath(conn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning path: %w", err)
	}
	_, err = filestore.WFS.Stat(ctx, zoneId, fileName)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("error getting blockfile info: %w", err)
		}
		var opts wshrpc.FileOpts
		var meta wshrpc.FileMeta
		if data.Info != nil {
			if data.Info.Opts != nil {
				opts = *data.Info.Opts
			}
			if data.Info.Meta != nil {
				meta = *data.Info.Meta
			}
		}
		err := filestore.WFS.MakeFile(ctx, zoneId, fileName, meta, opts)
		if err != nil {
			return fmt.Errorf("error making blockfile: %w", err)
		}
	}
	if data.At != nil && data.At.Offset >= 0 {
		err = filestore.WFS.WriteAt(ctx, zoneId, fileName, data.At.Offset, dataBuf)
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("NOTFOUND: %w", err)
		}
		if err != nil {
			return fmt.Errorf("error writing to blockfile: %w", err)
		}
	} else {
		err = filestore.WFS.WriteFile(ctx, zoneId, fileName, dataBuf)
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("NOTFOUND: %w", err)
		}
		if err != nil {
			return fmt.Errorf("error writing to blockfile: %w", err)
		}
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, zoneId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   zoneId,
			FileName: fileName,
			FileOp:   wps.FileOp_Invalidate,
		},
	})
	return nil
}

/*

	path := data.Info.Path
	log.Printf("Append: path=%s", path)
	client, conn := CreateFileShareClient(ctx, path)
	if conn == nil || client == nil {
		return fmt.Errorf(ErrorParsingConnection, path)
	}
	finfo, err := client.Stat(ctx, conn)
	if err != nil {
		return err
	}
	if data.Info == nil {
		data.Info = &wshrpc.FileInfo{}
	}
	oldInfo := data.Info
	data.Info = finfo
	if oldInfo.Opts != nil {
		data.Info.Opts = oldInfo.Opts
	}
	data.At = &wshrpc.FileDataAt{
		Offset: finfo.Size,
	}
	log.Printf("Append: offset=%d", data.At.Offset)
	return client.PutFile(ctx, conn, data)
*/

func (c WaveClient) AppendFile(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) error {
	dataBuf, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return fmt.Errorf("error decoding data64: %w", err)
	}
	zoneId := conn.Host
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	fileName, err := cleanPath(conn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning path: %w", err)
	}
	_, err = filestore.WFS.Stat(ctx, zoneId, fileName)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("error getting blockfile info: %w", err)
		}
		var opts wshrpc.FileOpts
		var meta wshrpc.FileMeta
		if data.Info != nil {
			if data.Info.Opts != nil {
				opts = *data.Info.Opts
			}
			if data.Info.Meta != nil {
				meta = *data.Info.Meta
			}
		}
		err := filestore.WFS.MakeFile(ctx, zoneId, fileName, meta, opts)
		if err != nil {
			return fmt.Errorf("error making blockfile: %w", err)
		}
	}
	err = filestore.WFS.AppendData(ctx, zoneId, fileName, dataBuf)
	if errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("NOTFOUND: %w", err)
	}
	if err != nil {
		return fmt.Errorf("error writing to blockfile: %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, zoneId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   zoneId,
			FileName: fileName,
			FileOp:   wps.FileOp_Invalidate,
		},
	})
	return nil
}

// WaveFile does not support directories, only prefix-based listing
func (c WaveClient) Mkdir(ctx context.Context, conn *connparse.Connection) error {
	return nil
}

func (c WaveClient) Move(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	return nil
}

func (c WaveClient) Copy(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	return nil
}

func (c WaveClient) Delete(ctx context.Context, conn *connparse.Connection) error {
	zoneId := conn.Host
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	fileName, err := cleanPath(conn.Path)
	if err != nil {
		return fmt.Errorf("error cleaning path: %w", err)
	}
	err = filestore.WFS.DeleteFile(ctx, zoneId, fileName)
	if err != nil {
		return fmt.Errorf("error deleting blockfile: %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, zoneId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   zoneId,
			FileName: fileName,
			FileOp:   wps.FileOp_Delete,
		},
	})
	return nil
}

func (c WaveClient) Join(ctx context.Context, conn *connparse.Connection, parts ...string) (string, error) {
	newPath := path.Join(append([]string{conn.Path}, parts...)...)
	newPath, err := cleanPath(newPath)
	if err != nil {
		return "", fmt.Errorf("error cleaning path: %w", err)
	}
	return newPath, nil
}

func cleanPath(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
	}
	if strings.HasPrefix(path, "/") {
		path = path[1:]
	}
	if strings.HasPrefix(path, "~") || strings.HasPrefix(path, ".") || strings.HasPrefix(path, "..") {
		return "", fmt.Errorf("wavefile path cannot start with ~, ., or ..")
	}
	var newParts []string
	for _, part := range strings.Split(path, "/") {
		if part == ".." {
			if len(newParts) > 0 {
				newParts = newParts[:len(newParts)-1]
			}
		} else if part != "." {
			newParts = append(newParts, part)
		}
	}
	return strings.Join(newParts, "/"), nil
}

func (c WaveClient) GetConnectionType() string {
	return connparse.ConnectionTypeWave
}
