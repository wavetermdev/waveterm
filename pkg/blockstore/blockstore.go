// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

import (
	"database/sql/driver"
	"encoding/json"
)

type FileOptsType struct {
	MaxSize  int64
	Circular bool
	IJson    bool
}

func (f *FileOptsType) Scan(value interface{}) error {
	return json.Unmarshal(value.([]byte), f)
}

func (f FileOptsType) Value() (driver.Value, error) {
	barr, err := json.Marshal(f)
	if err != nil {
		return nil, err
	}
	return string(barr), nil
}

type FileMeta map[string]any

func (m *FileMeta) Scan(value interface{}) error {
	return json.Unmarshal(value.([]byte), m)
}

func (m FileMeta) Value() (driver.Value, error) {
	barr, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return string(barr), nil
}

type BlockFile struct {
	BlockId   string       `json:"blockid"`
	Name      string       `json:"name"`
	Size      int64        `json:"size"`
	CreatedTs int64        `json:"createdts"`
	ModTs     int64        `json:"modts"`
	Opts      FileOptsType `json:"opts"`
	Meta      FileMeta     `json:"meta"`
}
