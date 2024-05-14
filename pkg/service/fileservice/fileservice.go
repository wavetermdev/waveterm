// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileservice

import (
	"os"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

type FileService struct{}

func (fs *FileService) ReadFile(path string) ([]byte, error) {
	path = wavebase.ExpandHomeDir(path)
	return os.ReadFile(path)
}
