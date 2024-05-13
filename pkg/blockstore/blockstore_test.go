// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func initDb(t *testing.T) {
	t.Logf("initializing db for %q", t.Name())
	useTestingDb = true
	partDataSize = 50
	stopFlush.Store(true)
	err := InitBlockstore()
	if err != nil {
		t.Fatalf("error initializing blockstore: %v", err)
	}
}

func cleanupDb(t *testing.T) {
	t.Logf("cleaning up db for %q", t.Name())
	if globalDB != nil {
		globalDB.Close()
		globalDB = nil
	}
	useTestingDb = false
	partDataSize = DefaultPartDataSize
	GBS.clearCache()
}

func TestCreate(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	err := GBS.MakeFile(ctx, blockId, "testfile", nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	file, err := GBS.Stat(ctx, blockId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file == nil {
		t.Fatalf("file not found")
	}
	if file.BlockId != blockId {
		t.Fatalf("block id mismatch")
	}
	if file.Name != "testfile" {
		t.Fatalf("name mismatch")
	}
	if file.Size != 0 {
		t.Fatalf("size mismatch")
	}
	if file.CreatedTs == 0 {
		t.Fatalf("created ts zero")
	}
	if file.ModTs == 0 {
		t.Fatalf("mod ts zero")
	}
	if file.CreatedTs != file.ModTs {
		t.Fatalf("create ts != mod ts")
	}
	if len(file.Meta) != 0 {
		t.Fatalf("meta should have no values")
	}
	if file.Opts.Circular || file.Opts.IJson || file.Opts.MaxSize != 0 {
		t.Fatalf("opts not empty")
	}
}

func checkMapsEqual(t *testing.T, m1 map[string]any, m2 map[string]any, msg string) {
	if len(m1) != len(m2) {
		t.Errorf("%s: map length mismatch", msg)
	}
	for k, v := range m1 {
		if m2[k] != v {
			t.Errorf("%s: value mismatch for key %q", msg, k)
		}
	}
}

func TestSetMeta(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	err := GBS.MakeFile(ctx, blockId, "testfile", nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	if GBS.getCacheSize() != 0 {
		t.Errorf("cache size mismatch -- should have 0 entries after create")
	}
	err = GBS.WriteMeta(ctx, blockId, "testfile", map[string]any{"a": 5, "b": "hello", "q": 8}, false)
	if err != nil {
		t.Fatalf("error setting meta: %v", err)
	}
	file, err := GBS.Stat(ctx, blockId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file == nil {
		t.Fatalf("file not found")
	}
	checkMapsEqual(t, map[string]any{"a": 5, "b": "hello", "q": 8}, file.Meta, "meta")
	if GBS.getCacheSize() != 1 {
		t.Errorf("cache size mismatch")
	}
	err = GBS.WriteMeta(ctx, blockId, "testfile", map[string]any{"a": 6, "c": "world", "d": 7, "q": nil}, true)
	if err != nil {
		t.Fatalf("error setting meta: %v", err)
	}
	file, err = GBS.Stat(ctx, blockId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file == nil {
		t.Fatalf("file not found")
	}
	checkMapsEqual(t, map[string]any{"a": 6, "b": "hello", "c": "world", "d": 7}, file.Meta, "meta")
}

func checkFileSize(t *testing.T, ctx context.Context, blockId string, name string, size int64) {
	file, err := GBS.Stat(ctx, blockId, name)
	if err != nil {
		t.Errorf("error stating file %q: %v", name, err)
		return
	}
	if file == nil {
		t.Errorf("file %q not found", name)
		return
	}
	if file.Size != size {
		t.Errorf("size mismatch for file %q: expected %d, got %d", name, size, file.Size)
	}
}

func checkFileData(t *testing.T, ctx context.Context, blockId string, name string, data string) {
	_, rdata, err := GBS.ReadFile(ctx, blockId, name)
	if err != nil {
		t.Errorf("error reading data for file %q: %v", name, err)
		return
	}
	if string(rdata) != data {
		t.Errorf("data mismatch for file %q: expected %q, got %q", name, data, string(rdata))
	}
}

func checkFileDataAt(t *testing.T, ctx context.Context, blockId string, name string, offset int64, data string) {
	_, rdata, err := GBS.ReadAt(ctx, blockId, name, offset, int64(len(data)))
	if err != nil {
		t.Errorf("error reading data for file %q: %v", name, err)
		return
	}
	if string(rdata) != data {
		t.Errorf("data mismatch for file %q: expected %q, got %q", name, data, string(rdata))
	}
}

func TestAppend(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	fileName := "t2"
	err := GBS.MakeFile(ctx, blockId, fileName, nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.AppendData(ctx, blockId, fileName, []byte("hello"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	// fmt.Print(GBS.dump())
	checkFileSize(t, ctx, blockId, fileName, 5)
	checkFileData(t, ctx, blockId, fileName, "hello")
	err = GBS.AppendData(ctx, blockId, fileName, []byte(" world"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	// fmt.Print(GBS.dump())
	checkFileSize(t, ctx, blockId, fileName, 11)
	checkFileData(t, ctx, blockId, fileName, "hello world")
}

func makeText(n int) string {
	var buf bytes.Buffer
	for i := 0; i < n; i++ {
		buf.WriteByte(byte('0' + (i % 10)))
	}
	return buf.String()
}

func TestMultiPart(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	fileName := "m2"
	data := makeText(80)
	err := GBS.MakeFile(ctx, blockId, fileName, nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.AppendData(ctx, blockId, fileName, []byte(data))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, blockId, fileName, 80)
	checkFileData(t, ctx, blockId, fileName, data)
	_, barr, err := GBS.ReadAt(ctx, blockId, fileName, 42, 10)
	if err != nil {
		t.Fatalf("error reading data: %v", err)
	}
	if string(barr) != data[42:52] {
		t.Errorf("data mismatch: expected %q, got %q", data[42:52], string(barr))
	}
	GBS.WriteAt(ctx, blockId, fileName, 49, []byte("world"))
	checkFileSize(t, ctx, blockId, fileName, 80)
	checkFileDataAt(t, ctx, blockId, fileName, 49, "world")
	checkFileDataAt(t, ctx, blockId, fileName, 48, "8world4")
}
