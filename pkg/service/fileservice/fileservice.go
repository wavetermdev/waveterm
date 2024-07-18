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
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wconfig"
)

const MaxFileSize = 10 * 1024 * 1024 // 10M
const DefaultTimeout = 2 * time.Second

type FileService struct{}

type FileInfo struct {
	Path     string      `json:"path"` // cleaned path
	Name     string      `json:"name"`
	NotFound bool        `json:"notfound,omitempty"`
	Size     int64       `json:"size"`
	Mode     os.FileMode `json:"mode"`
	ModeStr  string      `json:"modestr"`
	ModTime  int64       `json:"modtime"`
	IsDir    bool        `json:"isdir,omitempty"`
	MimeType string      `json:"mimetype,omitempty"`
}

type FullFile struct {
	Info   *FileInfo `json:"info"`
	Data64 string    `json:"data64"` // base64 encoded
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

func (fs *FileService) StatFile(path string) (*FileInfo, error) {
	cleanedPath := filepath.Clean(wavebase.ExpandHomeDir(path))
	finfo, err := os.Stat(cleanedPath)
	if os.IsNotExist(err) {
		return &FileInfo{Path: wavebase.ReplaceHomeDir(path), NotFound: true}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot stat file %q: %w", path, err)
	}
	mimeType := utilfn.DetectMimeType(cleanedPath)
	return &FileInfo{
		Path:     cleanedPath,
		Name:     finfo.Name(),
		Size:     finfo.Size(),
		Mode:     finfo.Mode(),
		ModeStr:  finfo.Mode().String(),
		ModTime:  finfo.ModTime().UnixMilli(),
		IsDir:    finfo.IsDir(),
		MimeType: mimeType,
	}, nil
}

func (fs *FileService) ReadFile(path string) (*FullFile, error) {
	finfo, err := fs.StatFile(path)
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
		var innerFilesInfo []FileInfo
		parent := filepath.Dir(finfo.Path)
		parentFileInfo, err := fs.StatFile(parent)
		if err == nil && parent != finfo.Path {
			log.Printf("adding parent")
			parentFileInfo.Name = ".."
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
			innerFileInfo := FileInfo{
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
