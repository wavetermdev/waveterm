// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileservice

import (
	"encoding/base64"
	"fmt"
	"os"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

type FileService struct{}

func (fs *FileService) ReadFile(path string) (string, error) {
	path = wavebase.ExpandHomeDir(path)
	barr, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("cannot read file %q: %w", path, err)
	}
	time.Sleep(2 * time.Second)
	return base64.StdEncoding.EncodeToString(barr), nil
}
