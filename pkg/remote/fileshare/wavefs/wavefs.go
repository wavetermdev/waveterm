// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavefs

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fspath"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fsutil"
	"github.com/wavetermdev/waveterm/pkg/util/wavefileutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	DirMode                   os.FileMode = 0755 | os.ModeDir
	WaveFileTransferSizeLimit             = 32 * 1024 * 1024
	MaxListEntriesLimit                   = 1024
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
					ch <- wshutil.RespErr[wshrpc.FileData](context.Cause(ctx))
					return
				}
				dataEnd := min(i+wshrpc.FileChunkSize, dataLen)
				ch <- wshrpc.RespOrErrorUnion[wshrpc.FileData]{Response: wshrpc.FileData{Data64: rtnData.Data64[i:dataEnd], Info: rtnData.Info, At: &wshrpc.FileDataAt{Offset: int64(i), Size: dataEnd - i}}}
			}
		} else {
			for i := 0; i < len(rtnData.Entries); i += wshrpc.DirChunkSize {
				if ctx.Err() != nil {
					ch <- wshutil.RespErr[wshrpc.FileData](context.Cause(ctx))
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
	finfo, err := filestore.WFS.Stat(ctx, zoneId, fileName)
	if err == nil && finfo.Size > WaveFileTransferSizeLimit {
		return nil, fmt.Errorf("file %q size %d exceeds transfer limit of %d bytes", fileName, finfo.Size, WaveFileTransferSizeLimit)
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
	if len(list) == 0 {
		return &wshrpc.FileData{
			Info: &wshrpc.FileInfo{
				Name:     fspath.Base(fileName),
				Path:     fileName,
				Dir:      fspath.Dir(fileName),
				NotFound: true,
				IsDir:    true,
			}}, nil
	}
	return &wshrpc.FileData{Info: data.Info, Entries: list}, nil
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
	log.Printf("ListEntries: conn: %v, opts: %v\n", conn, opts)
	zoneId := conn.Host
	if zoneId == "" {
		return nil, fmt.Errorf("zoneid not found in connection")
	}
	if opts == nil {
		opts = &wshrpc.FileListOpts{}
	}
	prefix, err := cleanPath(conn.Path)
	if err != nil {
		return nil, fmt.Errorf("error cleaning path: %w", err)
	}
	prefix += fspath.Separator
	var fileList []*wshrpc.FileInfo
	dirMap := make(map[string]*wshrpc.FileInfo)
	if err := listFilesPrefix(ctx, zoneId, prefix, func(wf *filestore.WaveFile) error {
		if len(fileList) >= MaxListEntriesLimit {
			return fmt.Errorf("file list limit exceeded: %d", MaxListEntriesLimit)
		}
		if !opts.All {
			name, isDir := fspath.FirstLevelDir(strings.TrimPrefix(wf.Name, prefix))
			if isDir {
				path := fspath.Join(conn.GetPathWithHost(), name)
				if _, ok := dirMap[path]; ok {
					if dirMap[path].ModTime < wf.ModTs {
						dirMap[path].ModTime = wf.ModTs
					}
					return nil
				}
				dirMap[path] = &wshrpc.FileInfo{
					Path:          path,
					Name:          name,
					Dir:           fspath.Dir(path),
					Size:          0,
					IsDir:         true,
					SupportsMkdir: false,
					Mode:          DirMode,
				}
				fileList = append(fileList, dirMap[path])
				return nil
			}
		}
		fileList = append(fileList, wavefileutil.WaveFileToFileInfo(wf))
		return nil
	}); err != nil {
		return nil, fmt.Errorf("error listing entries: %w", err)
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
	fileName, err := fsutil.CleanPathPrefix(conn.Path)
	if err != nil {
		return nil, fmt.Errorf("error cleaning path: %w", err)
	}
	fileInfo, err := filestore.WFS.Stat(ctx, zoneId, fileName)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			// attempt to list the directory
			entries, err := c.ListEntries(ctx, conn, nil)
			if err != nil {
				return nil, fmt.Errorf("error listing entries: %w", err)
			}
			if len(entries) > 0 {
				return &wshrpc.FileInfo{
					Path:  conn.GetPathWithHost(),
					Name:  fileName,
					Dir:   fsutil.GetParentPathString(fileName),
					Size:  0,
					IsDir: true,
					Mode:  DirMode,
				}, nil
			} else {
				return &wshrpc.FileInfo{
					Path:     conn.GetPathWithHost(),
					Name:     fileName,
					Dir:      fsutil.GetParentPathString(fileName),
					NotFound: true}, nil
			}
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
	if _, err := filestore.WFS.Stat(ctx, zoneId, fileName); err != nil {
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
		if err := filestore.WFS.MakeFile(ctx, zoneId, fileName, meta, opts); err != nil {
			return fmt.Errorf("error making blockfile: %w", err)
		}
	}
	if data.At != nil && data.At.Offset >= 0 {
		if err := filestore.WFS.WriteAt(ctx, zoneId, fileName, data.At.Offset, dataBuf); errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("NOTFOUND: %w", err)
		} else if err != nil {
			return fmt.Errorf("error writing to blockfile: %w", err)
		}
	} else {
		if err := filestore.WFS.WriteFile(ctx, zoneId, fileName, dataBuf); errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("NOTFOUND: %w", err)
		} else if err != nil {
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
		if err := filestore.WFS.MakeFile(ctx, zoneId, fileName, meta, opts); err != nil {
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
	return errors.ErrUnsupported
}

func (c WaveClient) MoveInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) error {
	if srcConn.Host != destConn.Host {
		return fmt.Errorf("move internal, src and dest hosts do not match")
	}
	_, err := c.CopyInternal(ctx, srcConn, destConn, opts)
	if err != nil {
		return fmt.Errorf("error copying blockfile: %w", err)
	}
	if err := c.Delete(ctx, srcConn, false); err != nil {
		return fmt.Errorf("error deleting blockfile: %w", err)
	}
	return nil
}

func (c WaveClient) CopyInternal(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) (bool, error) {
	srcHost := srcConn.Host
	destHost := destConn.Host
	if srcHost == "" || destHost == "" {
		return false, fmt.Errorf("source and destination hosts must be specified")
	}

	srcFileName, err := cleanPath(srcConn.Path)
	if err != nil {
		return false, fmt.Errorf("error cleaning source path: %w", err)
	}
	destFileName, err := cleanPath(destConn.Path)
	if err != nil {
		return false, fmt.Errorf("error cleaning destination path: %w", err)
	}

	finfo, err := filestore.WFS.Stat(ctx, srcHost, srcFileName)
	if err != nil {
		return false, fmt.Errorf("error getting source blockfile info: %w", err)
	}
	if finfo.Size > WaveFileTransferSizeLimit {
		return false, fmt.Errorf("file %q size %d exceeds transfer limit of %d bytes", srcFileName, finfo.Size, WaveFileTransferSizeLimit)
	}

	_, dataBuf, err := filestore.WFS.ReadFile(ctx, srcHost, srcFileName)
	if err != nil {
		return false, fmt.Errorf("error reading source blockfile: %w", err)
	}

	if err := filestore.WFS.WriteFile(ctx, destHost, destFileName, dataBuf); err != nil {
		return false, fmt.Errorf("error writing to destination blockfile: %w", err)
	}

	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, destHost).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   destHost,
			FileName: destFileName,
			FileOp:   wps.FileOp_Invalidate,
		},
	})
	return false, nil
}

// copying FROM somewhere TO wavefs
func (c WaveClient) CopyRemote(ctx context.Context, srcConn, destConn *connparse.Connection, srcClient fstype.FileShareClient, opts *wshrpc.FileCopyOpts) (bool, error) {
	if srcConn.Scheme == connparse.ConnectionTypeWave && destConn.Scheme == connparse.ConnectionTypeWave {
		return c.CopyInternal(ctx, srcConn, destConn, opts)
	}

	zoneId := destConn.Host
	if zoneId == "" {
		return false, fmt.Errorf("zoneid not found in connection")
	}

	srcInfo, err := srcClient.Stat(ctx, srcConn)
	if err != nil {
		return false, fmt.Errorf("error getting source file info: %w", err)
	}
	if srcInfo.NotFound {
		return false, fmt.Errorf("source file not found")
	}
	if srcInfo.IsDir {
		return false, fmt.Errorf("cannot copy directories to wavefs: use single file only")
	}
	if srcInfo.Size > WaveFileTransferSizeLimit {
		return false, fmt.Errorf("file %q size %d exceeds transfer limit of %d bytes", srcConn.Path, srcInfo.Size, WaveFileTransferSizeLimit)
	}

	fileData, err := srcClient.Read(ctx, srcConn, wshrpc.FileData{})
	if err != nil {
		return false, fmt.Errorf("error reading source file: %w", err)
	}

	dataBuf, err := base64.StdEncoding.DecodeString(fileData.Data64)
	if err != nil {
		return false, fmt.Errorf("error decoding file data: %w", err)
	}

	destPath, err := cleanPath(destConn.Path)
	if err != nil {
		return false, fmt.Errorf("error cleaning destination path: %w", err)
	}

	if _, err := filestore.WFS.Stat(ctx, zoneId, destPath); err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return false, fmt.Errorf("error getting blockfile info: %w", err)
		}
		if err := filestore.WFS.MakeFile(ctx, zoneId, destPath, wshrpc.FileMeta{}, wshrpc.FileOpts{}); err != nil {
			return false, fmt.Errorf("error making blockfile: %w", err)
		}
	}

	if err := filestore.WFS.WriteFile(ctx, zoneId, destPath, dataBuf); err != nil {
		return false, fmt.Errorf("error writing to blockfile: %w", err)
	}

	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, zoneId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   zoneId,
			FileName: destPath,
			FileOp:   wps.FileOp_Invalidate,
		},
	})

	return false, nil
}

func (c WaveClient) Delete(ctx context.Context, conn *connparse.Connection, recursive bool) error {
	zoneId := conn.Host
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	prefix := conn.Path

	finfo, err := c.Stat(ctx, conn)
	exists := err == nil && !finfo.NotFound
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("error getting file info: %w", err)
	}
	if !exists {
		return nil
	}

	pathsToDelete := make([]string, 0)

	if finfo.IsDir {
		if !recursive {
			return fmt.Errorf("%v is not empty, use recursive flag to delete", prefix)
		}
		if !strings.HasSuffix(prefix, fspath.Separator) {
			prefix += fspath.Separator
		}
		if err := listFilesPrefix(ctx, zoneId, prefix, func(wf *filestore.WaveFile) error {
			pathsToDelete = append(pathsToDelete, wf.Name)
			return nil
		}); err != nil {
			return fmt.Errorf("error listing blockfiles: %w", err)
		}
	} else {
		pathsToDelete = append(pathsToDelete, prefix)
	}
	if len(pathsToDelete) > 0 {
		errs := make([]error, 0)
		for _, entry := range pathsToDelete {
			if err := filestore.WFS.DeleteFile(ctx, zoneId, entry); err != nil {
				errs = append(errs, fmt.Errorf("error deleting blockfile %s/%s: %w", zoneId, entry, err))
				continue
			}
			wps.Broker.Publish(wps.WaveEvent{
				Event:  wps.Event_BlockFile,
				Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, zoneId).String()},
				Data: &wps.WSFileEventData{
					ZoneId:   zoneId,
					FileName: entry,
					FileOp:   wps.FileOp_Delete,
				},
			})
		}
		if len(errs) > 0 {
			return fmt.Errorf("error deleting blockfiles: %v", errs)
		}
	}
	return nil
}

func listFilesPrefix(ctx context.Context, zoneId, prefix string, entryCallback func(*filestore.WaveFile) error) error {
	if zoneId == "" {
		return fmt.Errorf("zoneid not found in connection")
	}
	fileListOrig, err := filestore.WFS.ListFiles(ctx, zoneId)
	if err != nil {
		return fmt.Errorf("error listing blockfiles: %w", err)
	}
	for _, wf := range fileListOrig {
		if prefix == "" || strings.HasPrefix(wf.Name, prefix) {
			entryCallback(wf)
		}
	}
	return nil
}

func (c WaveClient) Join(ctx context.Context, conn *connparse.Connection, parts ...string) (*wshrpc.FileInfo, error) {
	newPath := fspath.Join(append([]string{conn.Path}, parts...)...)
	newPath, err := cleanPath(newPath)
	if err != nil {
		return nil, fmt.Errorf("error cleaning path: %w", err)
	}
	conn.Path = newPath
	return c.Stat(ctx, conn)
}

func (c WaveClient) GetCapability() wshrpc.FileShareCapability {
	return wshrpc.FileShareCapability{
		CanAppend: true,
		CanMkdir:  false,
	}
}

func cleanPath(path string) (string, error) {
	if path == "" || path == fspath.Separator {
		return "", nil
	}
	if strings.HasPrefix(path, fspath.Separator) {
		path = path[1:]
	}
	if strings.HasPrefix(path, "~") || strings.HasPrefix(path, ".") || strings.HasPrefix(path, "..") {
		return "", fmt.Errorf("wavefile path cannot start with ~, ., or ..")
	}
	var newParts []string
	for _, part := range strings.Split(path, fspath.Separator) {
		if part == ".." {
			if len(newParts) > 0 {
				newParts = newParts[:len(newParts)-1]
			}
		} else if part != "." {
			newParts = append(newParts, part)
		}
	}
	return fspath.Join(newParts...), nil
}

func (c WaveClient) GetConnectionType() string {
	return connparse.ConnectionTypeWave
}
