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
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WaveClient struct{}

var _ fstype.FileShareClient = WaveClient{}

func NewWaveClient() *WaveClient {
	return &WaveClient{}
}

func (c WaveClient) Read(ctx context.Context, data fstype.FileData) (*fstype.FullFile, error) {
	zoneId := data.Conn.GetParam("zoneid")
	if zoneId == "" {
		return nil, fmt.Errorf("zoneid not found in connection")
	}
	fileName := data.Conn.GetPathWithHost()
	if data.At != nil {
		_, dataBuf, err := filestore.WFS.ReadAt(ctx, zoneId, fileName, data.At.Offset, data.At.Size)
		if err == nil {
			return &fstype.FullFile{Data64: base64.StdEncoding.EncodeToString(dataBuf)}, nil
		} else if err == fs.ErrNotExist {
			return nil, fmt.Errorf("NOTFOUND: %w", err)
		} else {
			return nil, fmt.Errorf("error reading blockfile: %w", err)
		}
	} else {
		_, dataBuf, err := filestore.WFS.ReadFile(ctx, zoneId, fileName)
		if err == nil {
			return &fstype.FullFile{Data64: base64.StdEncoding.EncodeToString(dataBuf)}, nil
		} else if err != fs.ErrNotExist {
			return nil, fmt.Errorf("error reading blockfile: %w", err)
		}
	}
	prefix := fileName
	fileListOrig, err := filestore.WFS.ListFiles(ctx, zoneId)
	if err != nil {
		return nil, fmt.Errorf("error listing blockfiles: %w", err)
	}
	var fileList []*filestore.WaveFile
	for _, wf := range fileListOrig {
		fileList = append(fileList, wf)
	}
	if prefix != "" {
		var filteredList []*filestore.WaveFile
		for _, file := range fileList {
			if strings.HasPrefix(file.Name, prefix) {
				filteredList = append(filteredList, file)
			}
		}
		fileList = filteredList
	}
	if !data.All {
		var filteredList []*wshrpc.FileInfo
		dirMap := make(map[string]int64) // the value is max modtime
		for _, file := range fileList {
			// if there is an extra "/" after the prefix, don't include it
			// first strip the prefix
			relPath := strings.TrimPrefix(file.Name, prefix)
			// then check if there is a "/" after the prefix
			if strings.Contains(relPath, "/") {
				dirPath := strings.Split(relPath, "/")[0]
				modTime := dirMap[dirPath]
				if file.ModTs > modTime {
					dirMap[dirPath] = file.ModTs
				}
				continue
			}
			filteredList = append(filteredList, waveFileToFileInfo(file))
		}
		for dir := range dirMap {
			filteredList = append(filteredList, &wshrpc.FileInfo{
				ZoneId:    data.ZoneId,
				Name:      data.Prefix + dir + "/",
				Size:      0,
				Meta:      nil,
				ModTs:     dirMap[dir],
				CreatedTs: dirMap[dir],
				IsDir:     true,
			})
		}
		fileList = filteredList
	}
	if data.Offset > 0 {
		if data.Offset >= len(fileList) {
			fileList = nil
		} else {
			fileList = fileList[data.Offset:]
		}
	}
	if data.Limit > 0 {
		if data.Limit < len(fileList) {
			fileList = fileList[:data.Limit]
		}
	}
	return fileList, nil
}

func (c WaveClient) Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	zoneId := conn.GetParam("zoneid")
	if zoneId == "" {
		return nil, fmt.Errorf("zoneid not found in connection")
	}
	fileName := conn.GetPathWithHost()
	fileInfo, err := filestore.WFS.Stat(ctx, zoneId, fileName)
	if err != nil {
		if err == fs.ErrNotExist {
			return nil, fmt.Errorf("NOTFOUND: %w", err)
		}
		return nil, fmt.Errorf("error getting file info: %w", err)
	}
	return waveFileToFileInfo(fileInfo), nil
}

func (c WaveClient) PutFile(ctx context.Context, data fstype.FileData) error {
	dataBuf, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return fmt.Errorf("error decoding data64: %w", err)
	}
	zoneId := data.Conn.GetParam("zoneid")
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	fileName := data.Conn.GetPathWithHost()
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
	zoneId := conn.GetParam("zoneid")
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	fileName := conn.GetPathWithHost()
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

func waveFileToFileInfo(wf *filestore.WaveFile) *wshrpc.FileInfo {
	path := fmt.Sprintf("wavefile://%s?zoneid=%s", wf.Name, wf.ZoneId)
	return &wshrpc.FileInfo{
		Path: path,
		Name: wf.Name,
		Opts: wf.Opts,
		Size: wf.Size,
		Meta: wf.Meta,
	}
}
