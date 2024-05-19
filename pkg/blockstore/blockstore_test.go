// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func initDb(t *testing.T) {
	t.Logf("initializing db for %q", t.Name())
	useTestingDb = true
	partDataSize = 50
	warningCount = &atomic.Int32{}
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
	if warningCount.Load() > 0 {
		t.Errorf("warning count: %d", warningCount.Load())
	}
	if flushErrorCount.Load() > 0 {
		t.Errorf("flush error count: %d", flushErrorCount.Load())
	}
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
	blockIds, err := GBS.GetAllBlockIds(ctx)
	if err != nil {
		t.Fatalf("error getting block ids: %v", err)
	}
	if len(blockIds) != 1 {
		t.Fatalf("block id count mismatch")
	}
	if blockIds[0] != blockId {
		t.Fatalf("block id mismatch")
	}
	err = GBS.DeleteFile(ctx, blockId, "testfile")
	if err != nil {
		t.Fatalf("error deleting file: %v", err)
	}
	blockIds, err = GBS.GetAllBlockIds(ctx)
	if err != nil {
		t.Fatalf("error getting block ids: %v", err)
	}
	if len(blockIds) != 0 {
		t.Fatalf("block id count mismatch")
	}
}

func containsFile(arr []*BlockFile, name string) bool {
	for _, f := range arr {
		if f.Name == name {
			return true
		}
	}
	return false
}

func TestDelete(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	err := GBS.MakeFile(ctx, blockId, "testfile", nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.DeleteFile(ctx, blockId, "testfile")
	if err != nil {
		t.Fatalf("error deleting file: %v", err)
	}
	file, err := GBS.Stat(ctx, blockId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file != nil {
		t.Fatalf("file should not be found")
	}

	// create two files in same block, use DeleteBlock to delete
	err = GBS.MakeFile(ctx, blockId, "testfile1", nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.MakeFile(ctx, blockId, "testfile2", nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	files, err := GBS.ListFiles(ctx, blockId)
	if err != nil {
		t.Fatalf("error listing files: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("file count mismatch")
	}
	if !containsFile(files, "testfile1") || !containsFile(files, "testfile2") {
		t.Fatalf("file names mismatch")
	}
	err = GBS.DeleteBlock(ctx, blockId)
	if err != nil {
		t.Fatalf("error deleting block: %v", err)
	}
	files, err = GBS.ListFiles(ctx, blockId)
	if err != nil {
		t.Fatalf("error listing files: %v", err)
	}
	if len(files) != 0 {
		t.Fatalf("file count mismatch")
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

	err = GBS.WriteMeta(ctx, blockId, "testfile-notexist", map[string]any{"a": 6}, true)
	if err == nil {
		t.Fatalf("expected error setting meta")
	}
	err = nil
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

func checkFileByteCount(t *testing.T, ctx context.Context, blockId string, name string, val byte, expected int) {
	_, rdata, err := GBS.ReadFile(ctx, blockId, name)
	if err != nil {
		t.Errorf("error reading data for file %q: %v", name, err)
		return
	}
	var count int
	for _, b := range rdata {
		if b == val {
			count++
		}
	}
	if count != expected {
		t.Errorf("byte count mismatch for file %q: expected %d, got %d", name, expected, count)
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

func TestWriteFile(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	fileName := "t3"
	err := GBS.MakeFile(ctx, blockId, fileName, nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.WriteFile(ctx, blockId, fileName, []byte("hello world!"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, blockId, fileName, "hello world!")
	err = GBS.WriteFile(ctx, blockId, fileName, []byte("goodbye world!"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, blockId, fileName, "goodbye world!")
	err = GBS.WriteFile(ctx, blockId, fileName, []byte("hello"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, blockId, fileName, "hello")

	// circular file
	err = GBS.MakeFile(ctx, blockId, "c1", nil, FileOptsType{Circular: true, MaxSize: 50})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.WriteFile(ctx, blockId, "c1", []byte("123456789 123456789 123456789 123456789 123456789 apple"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, blockId, "c1", "6789 123456789 123456789 123456789 123456789 apple")
	err = GBS.AppendData(ctx, blockId, "c1", []byte(" banana"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileData(t, ctx, blockId, "c1", "3456789 123456789 123456789 123456789 apple banana")
}

func TestCircularWrites(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	err := GBS.MakeFile(ctx, blockId, "c1", nil, FileOptsType{Circular: true, MaxSize: 50})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.WriteFile(ctx, blockId, "c1", []byte("123456789 123456789 123456789 123456789 123456789 "))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, blockId, "c1", "123456789 123456789 123456789 123456789 123456789 ")

	err = GBS.AppendData(ctx, blockId, "c1", []byte("apple"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileData(t, ctx, blockId, "c1", "6789 123456789 123456789 123456789 123456789 apple")
	err = GBS.WriteAt(ctx, blockId, "c1", 0, []byte("foo"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	// content should be unchanged because write is before the beginning of circular offset
	checkFileData(t, ctx, blockId, "c1", "6789 123456789 123456789 123456789 123456789 apple")
	err = GBS.WriteAt(ctx, blockId, "c1", 5, []byte("a"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileSize(t, ctx, blockId, "c1", 55)
	checkFileData(t, ctx, blockId, "c1", "a789 123456789 123456789 123456789 123456789 apple")
	err = GBS.AppendData(ctx, blockId, "c1", []byte(" banana"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, blockId, "c1", 62)
	checkFileData(t, ctx, blockId, "c1", "3456789 123456789 123456789 123456789 apple banana")
	err = GBS.WriteAt(ctx, blockId, "c1", 20, []byte("foo"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileSize(t, ctx, blockId, "c1", 62)
	checkFileData(t, ctx, blockId, "c1", "3456789 foo456789 123456789 123456789 apple banana")
	offset, _, _ := GBS.ReadFile(ctx, blockId, "c1")
	if offset != 12 {
		t.Errorf("offset mismatch: expected 12, got %d", offset)
	}
	err = GBS.AppendData(ctx, blockId, "c1", []byte(" world"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, blockId, "c1", 68)
	offset, _, _ = GBS.ReadFile(ctx, blockId, "c1")
	if offset != 18 {
		t.Errorf("offset mismatch: expected 18, got %d", offset)
	}
	checkFileData(t, ctx, blockId, "c1", "9 foo456789 123456789 123456789 apple banana world")
	err = GBS.AppendData(ctx, blockId, "c1", []byte(" 123456789 123456789 123456789 123456789 bar456789 123456789"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, blockId, "c1", 128)
	checkFileData(t, ctx, blockId, "c1", " 123456789 123456789 123456789 bar456789 123456789")
	GBS.withLock(blockId, "c1", false, func(entry *CacheEntry) {
		if entry == nil {
			err = fmt.Errorf("entry not found")
			return
		}
		if len(entry.DataEntries) != 1 {
			err = fmt.Errorf("data entries mismatch: expected 1, got %d", len(entry.DataEntries))
		}
	})
	if err != nil {
		t.Fatalf("error checking data entries: %v", err)
	}
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

func testIntMapsEq(t *testing.T, msg string, m map[int]int, expected map[int]int) {
	if len(m) != len(expected) {
		t.Errorf("%s: map length mismatch got:%d expected:%d", msg, len(m), len(expected))
		return
	}
	for k, v := range m {
		if expected[k] != v {
			t.Errorf("%s: value mismatch for key %d, got:%d expected:%d", msg, k, v, expected[k])
		}
	}
}

func TestComputePartMap(t *testing.T) {
	partDataSize = 100
	defer func() {
		partDataSize = DefaultPartDataSize
	}()
	file := &BlockFile{}
	m := file.computePartMap(0, 250)
	testIntMapsEq(t, "map1", m, map[int]int{0: 100, 1: 100, 2: 50})
	m = file.computePartMap(110, 40)
	log.Printf("map2:%#v\n", m)
	testIntMapsEq(t, "map2", m, map[int]int{1: 40})
	m = file.computePartMap(110, 90)
	testIntMapsEq(t, "map3", m, map[int]int{1: 90})
	m = file.computePartMap(110, 91)
	testIntMapsEq(t, "map4", m, map[int]int{1: 90, 2: 1})
	m = file.computePartMap(820, 340)
	testIntMapsEq(t, "map5", m, map[int]int{8: 80, 9: 100, 10: 100, 11: 60})

	// now test circular
	file = &BlockFile{Opts: FileOptsType{Circular: true, MaxSize: 1000}}
	m = file.computePartMap(10, 250)
	testIntMapsEq(t, "map6", m, map[int]int{0: 90, 1: 100, 2: 60})
	m = file.computePartMap(990, 40)
	testIntMapsEq(t, "map7", m, map[int]int{9: 10, 0: 30})
	m = file.computePartMap(990, 130)
	testIntMapsEq(t, "map8", m, map[int]int{9: 10, 0: 100, 1: 20})
	m = file.computePartMap(5, 1105)
	testIntMapsEq(t, "map9", m, map[int]int{0: 100, 1: 10, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100, 9: 100})
	m = file.computePartMap(2005, 1105)
	testIntMapsEq(t, "map9", m, map[int]int{0: 100, 1: 10, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100, 9: 100})
}

func TestSimpleDBFlush(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	fileName := "t1"
	err := GBS.MakeFile(ctx, blockId, fileName, nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = GBS.WriteFile(ctx, blockId, fileName, []byte("hello world!"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, blockId, fileName, "hello world!")
	err = GBS.FlushCache(ctx)
	if err != nil {
		t.Fatalf("error flushing cache: %v", err)
	}
	if GBS.getCacheSize() != 0 {
		t.Errorf("cache size mismatch")
	}
	checkFileData(t, ctx, blockId, fileName, "hello world!")
	if GBS.getCacheSize() != 0 {
		t.Errorf("cache size mismatch (after read)")
	}
	checkFileDataAt(t, ctx, blockId, fileName, 6, "world!")
	checkFileSize(t, ctx, blockId, fileName, 12)
	checkFileByteCount(t, ctx, blockId, fileName, 'l', 3)
}

func TestConcurrentAppend(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	blockId := uuid.New().String()
	fileName := "t1"
	err := GBS.MakeFile(ctx, blockId, fileName, nil, FileOptsType{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			const hexChars = "0123456789abcdef"
			ch := hexChars[n]
			for j := 0; j < 100; j++ {
				err := GBS.AppendData(ctx, blockId, fileName, []byte{ch})
				if err != nil {
					t.Errorf("error appending data (%d): %v", n, err)
				}
				if j == 50 {
					// ignore error here (concurrent flushing)
					GBS.FlushCache(ctx)
				}
			}
		}(i)
	}
	wg.Wait()
	checkFileSize(t, ctx, blockId, fileName, 1600)
	checkFileByteCount(t, ctx, blockId, fileName, 'a', 100)
	checkFileByteCount(t, ctx, blockId, fileName, 'e', 100)
	GBS.FlushCache(ctx)
	checkFileSize(t, ctx, blockId, fileName, 1600)
	checkFileByteCount(t, ctx, blockId, fileName, 'a', 100)
	checkFileByteCount(t, ctx, blockId, fileName, 'e', 100)
}
