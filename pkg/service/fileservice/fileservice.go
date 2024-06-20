// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileservice

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	NotFound bool        `json:"notfound,omitempty"`
	Size     int64       `json:"size"`
	Mode     os.FileMode `json:"mode"`
	ModTime  int64       `json:"modtime"`
	IsDir    bool        `json:"isdir,omitempty"`
	MimeType string      `json:"mimetype,omitempty"`
}

type FullFile struct {
	Info   *FileInfo `json:"info"`
	Data64 string    `json:"data64"` // base64 encoded
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
		Size:     finfo.Size(),
		Mode:     finfo.Mode(),
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

		var innerFilesInfo []FileInfo
		for _, innerFileEntry := range innerFilesEntries {
			innerFileInfoInt, _ := innerFileEntry.Info()
			innerFileInfo := FileInfo{
				Path:     innerFileInfoInt.Name(),
				Size:     innerFileInfoInt.Size(),
				Mode:     innerFileInfoInt.Mode(),
				ModTime:  innerFileInfoInt.ModTime().UnixMilli(),
				IsDir:    innerFileInfoInt.IsDir(),
				MimeType: "",
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

func (fs *FileService) GetSettingsConfig() interface{} {
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
