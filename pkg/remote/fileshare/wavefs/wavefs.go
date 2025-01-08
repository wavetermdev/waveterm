// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavefs

import (
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WaveClient struct{}

var _ fstype.FileShareClient = WaveClient{}

func NewWaveClient() *WaveClient {
	return &WaveClient{}
}

func (c WaveClient) Read(path string) (*fstype.FullFile, error) {
	return nil, nil
}

func (c WaveClient) Stat(path string) (*wshrpc.FileInfo, error) {
	return nil, nil
}

func (c WaveClient) PutFile(path string, data64 string) error {
	return nil
}

func (c WaveClient) Mkdir(path string) error {
	return nil
}

func (c WaveClient) Move(srcPath, destPath string, recursive bool) error {
	return nil
}

func (c WaveClient) Copy(srcPath, destPath string, recursive bool) error {
	return nil
}

func (c WaveClient) Delete(path string) error {
	return nil
}

func (c WaveClient) GetConnectionType() string {
	return remote.ConnectionTypeWave
}
