package fileservice

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/wconfig"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc/wshserver"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

const MaxFileSize = 10 * 1024 * 1024 // 10M
const DefaultTimeout = 2 * time.Second

type FileService struct{}

type FullFile struct {
	Info   *wshrpc.FileInfo `json:"info"`
	Data64 string           `json:"data64"` // base64 encoded
}

func (fs *FileService) SaveFile_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "save file",
		ArgNames: []string{"connection", "path", "data64"},
	}
}

func (fs *FileService) SaveFile(connection string, path string, data64 string) error {
	if connection == "" {
		connection = wshrpc.LocalConnName
	}
	connRoute := wshutil.MakeConnectionRouteId(connection)
	client := wshserver.GetMainRpcClient()
	writeData := wshrpc.CommandRemoteWriteFileData{Path: path, Data64: data64}
	return wshclient.RemoteWriteFileCommand(client, writeData, &wshrpc.RpcOpts{Route: connRoute})
}

func (fs *FileService) StatFile_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get file info",
		ArgNames: []string{"connection", "path"},
	}
}

func (fs *FileService) StatFile(connection string, path string) (*wshrpc.FileInfo, error) {
	if connection == "" {
		connection = wshrpc.LocalConnName
	}
	connRoute := wshutil.MakeConnectionRouteId(connection)
	client := wshserver.GetMainRpcClient()
	return wshclient.RemoteFileInfoCommand(client, path, &wshrpc.RpcOpts{Route: connRoute})
}

func (fs *FileService) ReadFile_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "read file",
		ArgNames: []string{"connection", "path"},
	}
}

func (fs *FileService) ReadFile(connection string, path string) (*FullFile, error) {
	if connection == "" {
		connection = wshrpc.LocalConnName
	}
	connRoute := wshutil.MakeConnectionRouteId(connection)
	client := wshserver.GetMainRpcClient()
	streamFileData := wshrpc.CommandRemoteStreamFileData{Path: path}
	rtnCh := wshclient.RemoteStreamFileCommand(client, streamFileData, &wshrpc.RpcOpts{Route: connRoute})
	fullFile := &FullFile{}
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
		fiBytes, err := json.Marshal(fileInfoArr)
		if err != nil {
			return nil, fmt.Errorf("unable to serialize files %s", path)
		}
		fullFile.Data64 = base64.StdEncoding.EncodeToString(fiBytes)
	} else {
		// we can avoid this re-encoding if we ensure the remote side always encodes chunks of 3 bytes so we don't get padding chars
		fullFile.Data64 = base64.StdEncoding.EncodeToString(fileBuf.Bytes())
	}
	return fullFile, nil
}

func (fs *FileService) GetWaveFile(id string, path string) (any, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	file, err := filestore.WFS.Stat(ctx, id, path)
	if err != nil {
		return nil, fmt.Errorf("error getting file: %w", err)
	}
	return file, nil
}

func (fs *FileService) DeleteFile_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "delete file",
		ArgNames: []string{"connection", "path"},
	}
}

func (fs *FileService) DeleteFile(connection string, path string) error {
	if connection == "" {
		connection = wshrpc.LocalConnName
	}
	connRoute := wshutil.MakeConnectionRouteId(connection)
	client := wshserver.GetMainRpcClient()
	return wshclient.RemoteFileDeleteCommand(client, path, &wshrpc.RpcOpts{Route: connRoute})
}

func (fs *FileService) GetFullConfig() wconfig.FullConfigType {
	watcher := wconfig.GetWatcher()
	return watcher.GetFullConfig()
}
