// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavefs

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/util/wavefileutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WaveClient struct{}

var _ fstype.FileShareClient = WaveClient{}

func NewWaveClient() *WaveClient {
	return &WaveClient{}
}

func (c WaveClient) ReadStream(ctx context.Context, conn *connparse.Connection, data wshrpc.FileData) chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileData], 16)
	go func() {
		defer close(ch)
		rtnData, err := c.Read(ctx, conn, data)
		if err != nil {
			ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Error: err}
			return
		}
		for {
			if ctx.Err() != nil {
				ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Error: ctx.Err()}
			}
			dataLen := len(rtnData.Data64)
			if !rtnData.Info.IsDir {
				for i := 0; i < dataLen; i += wshrpc.FileChunkSize {
					dataEnd := min(i+wshrpc.FileChunkSize, dataLen)
					ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Data64: rtnData.Data64[i:dataEnd], Info: rtnData.Info, At: &wshrpc.FileDataAt{Offset: int64(i), Size: int64(dataEnd - i)}}}
				}
			} else {
				for i := 0; i < len(rtnData.Entries); i += wshrpc.DirChunkSize {
					ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Entries: rtnData.Entries[i:min(i+wshrpc.DirChunkSize, len(rtnData.Entries))], Info: rtnData.Info}}
				}
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
	fileName := conn.Path
	if data.At != nil {
		_, dataBuf, err := filestore.WFS.ReadAt(ctx, zoneId, fileName, data.At.Offset, data.At.Size)
		if err == nil {
			return &wshrpc.FileData{Info: data.Info, Data64: base64.StdEncoding.EncodeToString(dataBuf)}, nil
		} else if err == fs.ErrNotExist {
			return nil, fmt.Errorf("NOTFOUND: %w", err)
		} else {
			return nil, fmt.Errorf("error reading blockfile: %w", err)
		}
	} else {
		_, dataBuf, err := filestore.WFS.ReadFile(ctx, zoneId, fileName)
		if err == nil {
			return &wshrpc.FileData{Info: data.Info, Data64: base64.StdEncoding.EncodeToString(dataBuf)}, nil
		} else if err != fs.ErrNotExist {
			return nil, fmt.Errorf("error reading blockfile: %w", err)
		}
	}
	list, err := c.ListEntries(ctx, conn, nil)
	if err != nil {
		return nil, fmt.Errorf("error listing blockfiles: %w", err)
	}
	return &wshrpc.FileData{Info: data.Info, Entries: list}, nil
}

func (c WaveClient) ListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 16)
	go func() {
		defer close(ch)
		list, err := c.ListEntries(ctx, conn, opts)
		if err != nil {
			ch <- wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Error: err}
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
	fileName := conn.Path
	prefix := fileName
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
	fileName := conn.Path
	fileInfo, err := filestore.WFS.Stat(ctx, zoneId, fileName)
	if err != nil {
		if err == fs.ErrNotExist {
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
	fileName := conn.Path
	if data.At != nil {
		err = filestore.WFS.WriteAt(ctx, zoneId, fileName, data.At.Offset, dataBuf)
		if err == fs.ErrNotExist {
			return fmt.Errorf("NOTFOUND: %w", err)
		}
		if err != nil {
			return fmt.Errorf("error writing to blockfile: %w", err)
		}
	} else {
		err = filestore.WFS.WriteFile(ctx, zoneId, fileName, dataBuf)
		if err == fs.ErrNotExist {
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

// WaveFile does not support directories, only prefix-based listing
func (c WaveClient) Mkdir(ctx context.Context, conn *connparse.Connection) error {
	return nil
}

func (c WaveClient) Move(ctx context.Context, srcConn, destConn *connparse.Connection, recursive bool) error {
	return nil
}

func (c WaveClient) Copy(ctx context.Context, srcConn, destConn *connparse.Connection, recursive bool) error {
	return nil
}

func (c WaveClient) Delete(ctx context.Context, conn *connparse.Connection) error {
	zoneId := conn.Host
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	fileName := conn.Path
	err := filestore.WFS.DeleteFile(ctx, zoneId, fileName)
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

func (c WaveClient) GetConnectionType() string {
	return connparse.ConnectionTypeWave
}
