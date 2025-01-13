// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavefs

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"regexp"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fstype"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WaveClient struct{}

var _ fstype.FileShareClient = WaveClient{}

var wavefilePathRe = regexp.MustCompile(`^wavefile:\/\/([^?]+)(?:\?(?:([^=]+)=([^&]+))(?:&([^=]+)=([^&]+))*)$`)

func NewWaveClient() *WaveClient {
	return &WaveClient{}
}

func (c WaveClient) Read(ctx context.Context, conn *connparse.Connection) (*fstype.FullFile, error) {
	return nil, nil
}

func (c WaveClient) Stat(ctx context.Context, conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	return nil, nil
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
