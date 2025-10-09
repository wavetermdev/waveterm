// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/ijson"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func initDb(t *testing.T) {
	t.Logf("initializing db for %q", t.Name())
	useTestingDb = true
	partDataSize = 50
	warningCount = &atomic.Int32{}
	stopFlush.Store(true)
	err := InitFilestore()
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") || strings.Contains(err.Error(), "requires cgo") {
			t.Skipf("filestore tests require sqlite/cgo: %v", err)
		}
		t.Fatalf("error initializing filestore: %v", err)
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
	WFS.clearCache()
	if warningCount.Load() > 0 {
		t.Errorf("warning count: %d", warningCount.Load())
	}
	if flushErrorCount.Load() > 0 {
		t.Errorf("flush error count: %d", flushErrorCount.Load())
	}
}

func (s *FileStore) getCacheSize() int {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	return len(s.Cache)
}

func (s *FileStore) clearCache() {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	s.Cache = make(map[cacheKey]*CacheEntry)
}

//lint:ignore U1000 used for testing
func (s *FileStore) dump() string {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("FileStore %d entries\n", len(s.Cache)))
	for _, v := range s.Cache {
		entryStr := v.dump()
		buf.WriteString(entryStr)
		buf.WriteString("\n")
	}
	return buf.String()
}

func TestCreate(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	err := WFS.MakeFile(ctx, zoneId, "testfile", nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	file, err := WFS.Stat(ctx, zoneId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file == nil {
		t.Fatalf("file not found")
	}
	if file.ZoneId != zoneId {
		t.Fatalf("zone id mismatch")
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
	zoneIds, err := WFS.GetAllZoneIds(ctx)
	if err != nil {
		t.Fatalf("error getting zone ids: %v", err)
	}
	if len(zoneIds) != 1 {
		t.Fatalf("zone id count mismatch")
	}
	if zoneIds[0] != zoneId {
		t.Fatalf("zone id mismatch")
	}
	err = WFS.DeleteFile(ctx, zoneId, "testfile")
	if err != nil {
		t.Fatalf("error deleting file: %v", err)
	}
	zoneIds, err = WFS.GetAllZoneIds(ctx)
	if err != nil {
		t.Fatalf("error getting zone ids: %v", err)
	}
	if len(zoneIds) != 0 {
		t.Fatalf("zone id count mismatch")
	}
}

func containsFile(arr []*WaveFile, name string) bool {
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
	zoneId := uuid.NewString()
	err := WFS.MakeFile(ctx, zoneId, "testfile", nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.DeleteFile(ctx, zoneId, "testfile")
	if err != nil {
		t.Fatalf("error deleting file: %v", err)
	}
	_, err = WFS.Stat(ctx, zoneId, "testfile")
	if err == nil || !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("expected file not found error")
	}

	// create two files in same zone, use DeleteZone to delete
	err = WFS.MakeFile(ctx, zoneId, "testfile1", nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.MakeFile(ctx, zoneId, "testfile2", nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	files, err := WFS.ListFiles(ctx, zoneId)
	if err != nil {
		t.Fatalf("error listing files: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("file count mismatch")
	}
	if !containsFile(files, "testfile1") || !containsFile(files, "testfile2") {
		t.Fatalf("file names mismatch")
	}
	err = WFS.DeleteZone(ctx, zoneId)
	if err != nil {
		t.Fatalf("error deleting zone: %v", err)
	}
	files, err = WFS.ListFiles(ctx, zoneId)
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
	zoneId := uuid.NewString()
	err := WFS.MakeFile(ctx, zoneId, "testfile", nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	if WFS.getCacheSize() != 0 {
		t.Errorf("cache size mismatch -- should have 0 entries after create")
	}
	err = WFS.WriteMeta(ctx, zoneId, "testfile", map[string]any{"a": 5, "b": "hello", "q": 8}, false)
	if err != nil {
		t.Fatalf("error setting meta: %v", err)
	}
	file, err := WFS.Stat(ctx, zoneId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file == nil {
		t.Fatalf("file not found")
	}
	checkMapsEqual(t, map[string]any{"a": 5, "b": "hello", "q": 8}, file.Meta, "meta")
	if WFS.getCacheSize() != 1 {
		t.Errorf("cache size mismatch")
	}
	err = WFS.WriteMeta(ctx, zoneId, "testfile", map[string]any{"a": 6, "c": "world", "d": 7, "q": nil}, true)
	if err != nil {
		t.Fatalf("error setting meta: %v", err)
	}
	file, err = WFS.Stat(ctx, zoneId, "testfile")
	if err != nil {
		t.Fatalf("error stating file: %v", err)
	}
	if file == nil {
		t.Fatalf("file not found")
	}
	checkMapsEqual(t, map[string]any{"a": 6, "b": "hello", "c": "world", "d": 7}, file.Meta, "meta")

	err = WFS.WriteMeta(ctx, zoneId, "testfile-notexist", map[string]any{"a": 6}, true)
	if err == nil {
		t.Fatalf("expected error setting meta")
	}
	err = nil
}

func checkFileSize(t *testing.T, ctx context.Context, zoneId string, name string, size int64) {
	file, err := WFS.Stat(ctx, zoneId, name)
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

func checkFileData(t *testing.T, ctx context.Context, zoneId string, name string, data string) {
	_, rdata, err := WFS.ReadFile(ctx, zoneId, name)
	if err != nil {
		t.Errorf("error reading data for file %q: %v", name, err)
		return
	}
	if string(rdata) != data {
		t.Errorf("data mismatch for file %q: expected %q, got %q", name, data, string(rdata))
	}
}

func checkFileByteCount(t *testing.T, ctx context.Context, zoneId string, name string, val byte, expected int) {
	_, rdata, err := WFS.ReadFile(ctx, zoneId, name)
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

func checkFileDataAt(t *testing.T, ctx context.Context, zoneId string, name string, offset int64, data string) {
	_, rdata, err := WFS.ReadAt(ctx, zoneId, name, offset, int64(len(data)))
	if err != nil {
		t.Errorf("error reading data for file %q: %v", name, err)
		return
	}
	if string(rdata) != data {
		t.Errorf("data mismatch for file %q: expected %q, got %q", name, data, string(rdata))
	}
}

func TestWriteAt(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	fileName := "t3"
	zoneId := uuid.NewString()
	err := WFS.MakeFile(ctx, zoneId, fileName, nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.WriteFile(ctx, zoneId, fileName, []byte("hello world!"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, zoneId, fileName, "hello world!")
	err = WFS.WriteAt(ctx, zoneId, fileName, 0, []byte("foo"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileSize(t, ctx, zoneId, fileName, 12)
	checkFileData(t, ctx, zoneId, fileName, "foolo world!")
}

func TestAppend(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	fileName := "t2"
	err := WFS.MakeFile(ctx, zoneId, fileName, nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.AppendData(ctx, zoneId, fileName, []byte("hello"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	// fmt.Print(GBS.dump())
	checkFileSize(t, ctx, zoneId, fileName, 5)
	checkFileData(t, ctx, zoneId, fileName, "hello")
	err = WFS.AppendData(ctx, zoneId, fileName, []byte(" world"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	// fmt.Print(GBS.dump())
	checkFileSize(t, ctx, zoneId, fileName, 11)
	checkFileData(t, ctx, zoneId, fileName, "hello world")
}

func TestWriteFile(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	fileName := "t3"
	err := WFS.MakeFile(ctx, zoneId, fileName, nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.WriteFile(ctx, zoneId, fileName, []byte("hello world!"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, zoneId, fileName, "hello world!")
	err = WFS.WriteFile(ctx, zoneId, fileName, []byte("goodbye world!"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, zoneId, fileName, "goodbye world!")
	err = WFS.WriteFile(ctx, zoneId, fileName, []byte("hello"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, zoneId, fileName, "hello")

	// circular file
	err = WFS.MakeFile(ctx, zoneId, "c1", nil, wshrpc.FileOpts{Circular: true, MaxSize: 50})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.WriteFile(ctx, zoneId, "c1", []byte("123456789 123456789 123456789 123456789 123456789 apple"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, zoneId, "c1", "6789 123456789 123456789 123456789 123456789 apple")
	err = WFS.AppendData(ctx, zoneId, "c1", []byte(" banana"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileData(t, ctx, zoneId, "c1", "3456789 123456789 123456789 123456789 apple banana")
}

func TestCircularWrites(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	err := WFS.MakeFile(ctx, zoneId, "c1", nil, wshrpc.FileOpts{Circular: true, MaxSize: 50})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.WriteFile(ctx, zoneId, "c1", []byte("123456789 123456789 123456789 123456789 123456789 "))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, zoneId, "c1", "123456789 123456789 123456789 123456789 123456789 ")
	err = WFS.AppendData(ctx, zoneId, "c1", []byte("apple"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileData(t, ctx, zoneId, "c1", "6789 123456789 123456789 123456789 123456789 apple")
	err = WFS.WriteAt(ctx, zoneId, "c1", 0, []byte("foo"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	// content should be unchanged because write is before the beginning of circular offset
	checkFileData(t, ctx, zoneId, "c1", "6789 123456789 123456789 123456789 123456789 apple")
	err = WFS.WriteAt(ctx, zoneId, "c1", 5, []byte("a"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileSize(t, ctx, zoneId, "c1", 55)
	checkFileData(t, ctx, zoneId, "c1", "a789 123456789 123456789 123456789 123456789 apple")
	err = WFS.AppendData(ctx, zoneId, "c1", []byte(" banana"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, zoneId, "c1", 62)
	checkFileData(t, ctx, zoneId, "c1", "3456789 123456789 123456789 123456789 apple banana")
	err = WFS.WriteAt(ctx, zoneId, "c1", 20, []byte("foo"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileSize(t, ctx, zoneId, "c1", 62)
	checkFileData(t, ctx, zoneId, "c1", "3456789 foo456789 123456789 123456789 apple banana")
	offset, _, _ := WFS.ReadFile(ctx, zoneId, "c1")
	if offset != 12 {
		t.Errorf("offset mismatch: expected 12, got %d", offset)
	}
	err = WFS.AppendData(ctx, zoneId, "c1", []byte(" world"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, zoneId, "c1", 68)
	offset, _, _ = WFS.ReadFile(ctx, zoneId, "c1")
	if offset != 18 {
		t.Errorf("offset mismatch: expected 18, got %d", offset)
	}
	checkFileData(t, ctx, zoneId, "c1", "9 foo456789 123456789 123456789 apple banana world")
	err = WFS.AppendData(ctx, zoneId, "c1", []byte(" 123456789 123456789 123456789 123456789 bar456789 123456789"))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, zoneId, "c1", 128)
	checkFileData(t, ctx, zoneId, "c1", " 123456789 123456789 123456789 bar456789 123456789")
	err = withLock(WFS, zoneId, "c1", func(entry *CacheEntry) error {
		if entry == nil {
			return fmt.Errorf("entry not found")
		}
		if len(entry.DataEntries) != 1 {
			return fmt.Errorf("data entries mismatch: expected 1, got %d", len(entry.DataEntries))
		}
		return nil
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
	zoneId := uuid.NewString()
	fileName := "m2"
	data := makeText(80)
	err := WFS.MakeFile(ctx, zoneId, fileName, nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.AppendData(ctx, zoneId, fileName, []byte(data))
	if err != nil {
		t.Fatalf("error appending data: %v", err)
	}
	checkFileSize(t, ctx, zoneId, fileName, 80)
	checkFileData(t, ctx, zoneId, fileName, data)
	_, barr, err := WFS.ReadAt(ctx, zoneId, fileName, 42, 10)
	if err != nil {
		t.Fatalf("error reading data: %v", err)
	}
	if string(barr) != data[42:52] {
		t.Errorf("data mismatch: expected %q, got %q", data[42:52], string(barr))
	}
	WFS.WriteAt(ctx, zoneId, fileName, 49, []byte("world"))
	checkFileSize(t, ctx, zoneId, fileName, 80)
	checkFileDataAt(t, ctx, zoneId, fileName, 49, "world")
	checkFileDataAt(t, ctx, zoneId, fileName, 48, "8world4")
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
	file := &WaveFile{}
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
	file = &WaveFile{Opts: wshrpc.FileOpts{Circular: true, MaxSize: 1000}}
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
	zoneId := uuid.NewString()
	fileName := "t1"
	err := WFS.MakeFile(ctx, zoneId, fileName, nil, wshrpc.FileOpts{})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	err = WFS.WriteFile(ctx, zoneId, fileName, []byte("hello world!"))
	if err != nil {
		t.Fatalf("error writing data: %v", err)
	}
	checkFileData(t, ctx, zoneId, fileName, "hello world!")
	_, err = WFS.FlushCache(ctx)
	if err != nil {
		t.Fatalf("error flushing cache: %v", err)
	}
	if WFS.getCacheSize() != 0 {
		t.Errorf("cache size mismatch")
	}
	checkFileData(t, ctx, zoneId, fileName, "hello world!")
	if WFS.getCacheSize() != 0 {
		t.Errorf("cache size mismatch (after read)")
	}
	checkFileDataAt(t, ctx, zoneId, fileName, 6, "world!")
	checkFileSize(t, ctx, zoneId, fileName, 12)
	checkFileByteCount(t, ctx, zoneId, fileName, 'l', 3)
}

func TestConcurrentAppend(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	fileName := "t1"
	err := WFS.MakeFile(ctx, zoneId, fileName, nil, wshrpc.FileOpts{})
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
				err := WFS.AppendData(ctx, zoneId, fileName, []byte{ch})
				if err != nil {
					t.Errorf("error appending data (%d): %v", n, err)
				}
				if j == 50 {
					// ignore error here (concurrent flushing)
					WFS.FlushCache(ctx)
				}
			}
		}(i)
	}
	wg.Wait()
	checkFileSize(t, ctx, zoneId, fileName, 1600)
	checkFileByteCount(t, ctx, zoneId, fileName, 'a', 100)
	checkFileByteCount(t, ctx, zoneId, fileName, 'e', 100)
	WFS.FlushCache(ctx)
	checkFileSize(t, ctx, zoneId, fileName, 1600)
	checkFileByteCount(t, ctx, zoneId, fileName, 'a', 100)
	checkFileByteCount(t, ctx, zoneId, fileName, 'e', 100)
}

func jsonDeepEqual(d1 any, d2 any) bool {
	if d1 == nil && d2 == nil {
		return true
	}
	if d1 == nil || d2 == nil {
		return false
	}
	t1 := reflect.TypeOf(d1)
	t2 := reflect.TypeOf(d2)
	if t1 != t2 {
		return false
	}
	switch d1.(type) {
	case float64:
		return d1.(float64) == d2.(float64)
	case string:
		return d1.(string) == d2.(string)
	case bool:
		return d1.(bool) == d2.(bool)
	case []any:
		a1 := d1.([]any)
		a2 := d2.([]any)
		if len(a1) != len(a2) {
			return false
		}
		for i := 0; i < len(a1); i++ {
			if !jsonDeepEqual(a1[i], a2[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		m1 := d1.(map[string]any)
		m2 := d2.(map[string]any)
		if len(m1) != len(m2) {
			return false
		}
		for k, v := range m1 {
			if !jsonDeepEqual(v, m2[k]) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func TestIJson(t *testing.T) {
	initDb(t)
	defer cleanupDb(t)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	zoneId := uuid.NewString()
	fileName := "ij1"
	err := WFS.MakeFile(ctx, zoneId, fileName, nil, wshrpc.FileOpts{IJson: true})
	if err != nil {
		t.Fatalf("error creating file: %v", err)
	}
	rootSet := ijson.MakeSetCommand(nil, map[string]any{"tag": "div", "class": "root"})
	err = WFS.AppendIJson(ctx, zoneId, fileName, rootSet)
	if err != nil {
		t.Fatalf("error appending ijson: %v", err)
	}
	_, fullData, err := WFS.ReadFile(ctx, zoneId, fileName)
	if err != nil {
		t.Fatalf("error reading file: %v", err)
	}
	cmds, err := ijson.ParseIJson(fullData)
	if err != nil {
		t.Fatalf("error parsing ijson: %v", err)
	}
	outData, err := ijson.ApplyCommands(nil, cmds, 0)
	if err != nil {
		t.Fatalf("error applying ijson: %v", err)
	}
	if !jsonDeepEqual(rootSet["data"], outData) {
		t.Errorf("data mismatch: expected %v, got %v", rootSet["data"], outData)
	}
	childrenAppend := ijson.MakeAppendCommand(ijson.Path{"children"}, map[string]any{"tag": "div", "class": "child"})
	err = WFS.AppendIJson(ctx, zoneId, fileName, childrenAppend)
	if err != nil {
		t.Fatalf("error appending ijson: %v", err)
	}
	_, fullData, err = WFS.ReadFile(ctx, zoneId, fileName)
	if err != nil {
		t.Fatalf("error reading file: %v", err)
	}
	cmds, err = ijson.ParseIJson(fullData)
	if err != nil {
		t.Fatalf("error parsing ijson: %v", err)
	}
	if len(cmds) != 2 {
		t.Fatalf("command count mismatch: expected 2, got %d", len(cmds))
	}
	outData, err = ijson.ApplyCommands(nil, cmds, 0)
	if err != nil {
		t.Fatalf("error applying ijson: %v", err)
	}
	if !jsonDeepEqual(ijson.M{"tag": "div", "class": "root", "children": ijson.A{ijson.M{"tag": "div", "class": "child"}}}, outData) {
		t.Errorf("data mismatch: expected %v, got %v", rootSet["data"], outData)
	}
	err = WFS.CompactIJson(ctx, zoneId, fileName)
	if err != nil {
		t.Fatalf("error compacting ijson: %v", err)
	}
	_, fullData, err = WFS.ReadFile(ctx, zoneId, fileName)
	if err != nil {
		t.Fatalf("error reading file: %v", err)
	}
	cmds, err = ijson.ParseIJson(fullData)
	if err != nil {
		t.Fatalf("error parsing ijson: %v", err)
	}
	if len(cmds) != 1 {
		t.Fatalf("command count mismatch: expected 1, got %d", len(cmds))
	}
	outData, err = ijson.ApplyCommands(nil, cmds, 0)
	if err != nil {
		t.Fatalf("error applying ijson: %v", err)
	}
	if !jsonDeepEqual(ijson.M{"tag": "div", "class": "root", "children": ijson.A{ijson.M{"tag": "div", "class": "child"}}}, outData) {
		t.Errorf("data mismatch: expected %v, got %v", rootSet["data"], outData)
	}
}
