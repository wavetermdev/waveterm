package fileservice

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
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

func (fs *FileService) SaveFile(path string, data64 string) error {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDir(path))
	data, err := base64.StdEncoding.DecodeString(data64)
	if err != nil {
		return fmt.Errorf("failed to decode base64 data: %w", err)
	}
	err = os.WriteFile(cleanedPath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write file %q: %w", path, err)
	}
	return nil
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

func (fs *FileService) ReadFile(path string) (*FullFile, error) {
	finfo, err := fs.StatFile("", path)
	if err != nil {
		return nil, fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	if finfo.NotFound {
		return &FullFile{Info: finfo}, nil
	}
	if finfo.Size > MaxFileSize {
		return nil, fmt.Errorf("file %q is too large to read, use /wave/stream-file", path)
	}
	if finfo.IsDir {
		innerFilesEntries, err := os.ReadDir(finfo.Path)
		if err != nil {
			return nil, fmt.Errorf("unable to parse directory %s", finfo.Path)
		}
		if len(innerFilesEntries) > 1000 {
			innerFilesEntries = innerFilesEntries[:1000]
		}
		var innerFilesInfo []wshrpc.FileInfo
		parent := filepath.Dir(finfo.Path)
		parentFileInfo, err := fs.StatFile("", parent)
		if err == nil && parent != finfo.Path {
			log.Printf("adding parent")
			parentFileInfo.Name = ".."
			parentFileInfo.Size = -1
			innerFilesInfo = append(innerFilesInfo, *parentFileInfo)
		}
		for _, innerFileEntry := range innerFilesEntries {
			innerFileInfoInt, err := innerFileEntry.Info()
			if err != nil {
				log.Printf("unable to get file info for (innerFileInfo) %s: %v", innerFileEntry.Name(), err)
				continue
			}
			mimeType := utilfn.DetectMimeType(filepath.Join(finfo.Path, innerFileInfoInt.Name()))
			var fileSize int64
			if mimeType == "directory" {
				fileSize = -1
			} else {
				fileSize = innerFileInfoInt.Size()
			}
			innerFileInfo := wshrpc.FileInfo{
				Path:     filepath.Join(finfo.Path, innerFileInfoInt.Name()),
				Name:     innerFileInfoInt.Name(),
				Size:     fileSize,
				Mode:     innerFileInfoInt.Mode(),
				ModeStr:  innerFileInfoInt.Mode().String(),
				ModTime:  innerFileInfoInt.ModTime().UnixMilli(),
				IsDir:    innerFileInfoInt.IsDir(),
				MimeType: mimeType,
			}
			innerFilesInfo = append(innerFilesInfo, innerFileInfo)
		}

		filesSerialized, err := json.Marshal(innerFilesInfo)
		if err != nil {
			return nil, fmt.Errorf("unable to serialize files %s", finfo.Path)
		}
		return &FullFile{
			Info:   finfo,
			Data64: base64.StdEncoding.EncodeToString(filesSerialized),
		}, nil
	}
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDir(path))
	barr, err := os.ReadFile(cleanedPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read file %q: %w", path, err)
	}
	return &FullFile{
		Info:   finfo,
		Data64: base64.StdEncoding.EncodeToString(barr),
	}, nil
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

func (fs *FileService) DeleteFile(path string) error {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDir(path))
	return os.Remove(cleanedPath)
}

func (fs *FileService) GetSettingsConfig() wconfig.SettingsConfigType {
	watcher := wconfig.GetWatcher()
	return watcher.GetSettingsConfig()
}

func (fs *FileService) AddWidget(newWidget wconfig.WidgetsConfigType) error {
	watcher := wconfig.GetWatcher()
	return watcher.AddWidget(newWidget)
}

func (fs *FileService) RemoveWidget(idx uint) error {
	watcher := wconfig.GetWatcher()
	return watcher.RmWidget(idx)
}
