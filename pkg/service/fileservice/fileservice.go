// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileservice

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

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
	Data64 string    `json:"data64,omitempty"` // base64 encoded
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
	mimeType := utilfn.DetectMimeType(path)
	return &FileInfo{
		Path:     wavebase.ReplaceHomeDir(path),
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
