// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

import (
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"sync"
	"time"
)

type cacheKey struct {
	ZoneId string
	Name   string
}

type FileStore struct {
	Lock       *sync.Mutex
	Cache      map[cacheKey]*CacheEntry
	IsFlushing bool
}

type DataCacheEntry struct {
	PartIdx int
	Data    []byte // capacity is always ZoneDataPartSize
}

// if File or DataEntries are not nil then they are dirty (need to be flushed to disk)
type CacheEntry struct {
	PinCount int // this is synchronzed with the FileStore lock (not the entry lock)

	Lock        *sync.Mutex
	ZoneId      string
	Name        string
	File        *WaveFile
	DataEntries map[int]*DataCacheEntry
	FlushErrors int
}

//lint:ignore U1000 used for testing
func (e *CacheEntry) dump() string {
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "CacheEntry [ZoneId: %q, Name: %q] PinCount: %d\n", e.ZoneId, e.Name, e.PinCount)
	fmt.Fprintf(&buf, "  FileEntry: %v\n", e.File)
	for idx, dce := range e.DataEntries {
		fmt.Fprintf(&buf, "  DataEntry[%d]: %q\n", idx, string(dce.Data))
	}
	return buf.String()
}

func makeDataCacheEntry(partIdx int) *DataCacheEntry {
	return &DataCacheEntry{
		PartIdx: partIdx,
		Data:    make([]byte, 0, partDataSize),
	}
}

// will create new entries
func (s *FileStore) getEntryAndPin(zoneId string, name string) *CacheEntry {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{ZoneId: zoneId, Name: name}]
	if entry == nil {
		entry = makeCacheEntry(zoneId, name)
		s.Cache[cacheKey{ZoneId: zoneId, Name: name}] = entry
	}
	entry.PinCount++
	return entry
}

func (s *FileStore) unpinEntryAndTryDelete(zoneId string, name string) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{ZoneId: zoneId, Name: name}]
	if entry == nil {
		return
	}
	entry.PinCount--
	if entry.PinCount <= 0 && entry.File == nil {
		delete(s.Cache, cacheKey{ZoneId: zoneId, Name: name})
	}
}

func (entry *CacheEntry) clear() {
	entry.File = nil
	entry.DataEntries = make(map[int]*DataCacheEntry)
	entry.FlushErrors = 0
}

func (entry *CacheEntry) getOrCreateDataCacheEntry(partIdx int) *DataCacheEntry {
	if entry.DataEntries[partIdx] == nil {
		entry.DataEntries[partIdx] = makeDataCacheEntry(partIdx)
	}
	return entry.DataEntries[partIdx]
}

// returns err if file does not exist
func (entry *CacheEntry) loadFileIntoCache(ctx context.Context) error {
	if entry.File != nil {
		return nil
	}
	file, err := entry.loadFileForRead(ctx)
	if err != nil {
		return err
	}
	entry.File = file
	return nil
}

// does not populate the cache entry, returns err if file does not exist
func (entry *CacheEntry) loadFileForRead(ctx context.Context) (*WaveFile, error) {
	if entry.File != nil {
		return entry.File, nil
	}
	file, err := dbGetZoneFile(ctx, entry.ZoneId, entry.Name)
	if err != nil {
		return nil, fmt.Errorf("error getting file: %w", err)
	}
	if file == nil {
		return nil, fs.ErrNotExist
	}
	return file, nil
}

func withLock(s *FileStore, zoneId string, name string, fn func(*CacheEntry) error) error {
	entry := s.getEntryAndPin(zoneId, name)
	defer s.unpinEntryAndTryDelete(zoneId, name)
	entry.Lock.Lock()
	defer entry.Lock.Unlock()
	return fn(entry)
}

func withLockRtn[T any](s *FileStore, zoneId string, name string, fn func(*CacheEntry) (T, error)) (T, error) {
	var rtnVal T
	rtnErr := withLock(s, zoneId, name, func(entry *CacheEntry) error {
		var err error
		rtnVal, err = fn(entry)
		return err
	})
	return rtnVal, rtnErr
}

func (dce *DataCacheEntry) writeToPart(offset int64, data []byte) (int64, *DataCacheEntry) {
	leftInPart := partDataSize - offset
	toWrite := int64(len(data))
	if toWrite > leftInPart {
		toWrite = leftInPart
	}
	if int64(len(dce.Data)) < offset+toWrite {
		dce.Data = dce.Data[:offset+toWrite]
	}
	copy(dce.Data[offset:], data[:toWrite])
	return toWrite, dce
}

func (entry *CacheEntry) writeAt(offset int64, data []byte, replace bool) {
	if replace {
		entry.File.Size = 0
	}
	if entry.File.Opts.Circular {
		startCirFileOffset := entry.File.Size - entry.File.Opts.MaxSize
		if offset+int64(len(data)) <= startCirFileOffset {
			// write is before the start of the circular file
			return
		}
		if offset < startCirFileOffset {
			// truncate data (from the front), update offset
			truncateAmt := startCirFileOffset - offset
			data = data[truncateAmt:]
			offset += truncateAmt
		}
		if int64(len(data)) > entry.File.Opts.MaxSize {
			// truncate data (from the front), update offset
			truncateAmt := int64(len(data)) - entry.File.Opts.MaxSize
			data = data[truncateAmt:]
			offset += truncateAmt
		}
	}
	endWriteOffset := offset + int64(len(data))
	if replace {
		entry.DataEntries = make(map[int]*DataCacheEntry)
	}
	for len(data) > 0 {
		partIdx := int(offset / partDataSize)
		if entry.File.Opts.Circular {
			maxPart := int(entry.File.Opts.MaxSize / partDataSize)
			partIdx = partIdx % maxPart
		}
		partOffset := offset % partDataSize
		partData := entry.getOrCreateDataCacheEntry(partIdx)
		nw, newDce := partData.writeToPart(partOffset, data)
		entry.DataEntries[partIdx] = newDce
		data = data[nw:]
		offset += nw
	}
	if endWriteOffset > entry.File.Size || replace {
		entry.File.Size = endWriteOffset
	}
	entry.File.ModTs = time.Now().UnixMilli()
}

// returns (realOffset, data, error)
func (entry *CacheEntry) readAt(ctx context.Context, offset int64, size int64, readFull bool) (int64, []byte, error) {
	if offset < 0 {
		return 0, nil, fmt.Errorf("offset cannot be negative")
	}
	file, err := entry.loadFileForRead(ctx)
	if err != nil {
		return 0, nil, err
	}
	if readFull {
		size = file.Size - offset
	}
	if offset+size > file.Size {
		size = file.Size - offset
	}
	if file.Opts.Circular {
		realDataOffset := int64(0)
		if file.Size > file.Opts.MaxSize {
			realDataOffset = file.Size - file.Opts.MaxSize
		}
		if offset < realDataOffset {
			truncateAmt := realDataOffset - offset
			offset += truncateAmt
			size -= truncateAmt
		}
		if size <= 0 {
			return realDataOffset, nil, nil
		}
	}
	partMap := file.computePartMap(offset, size)
	dataEntryMap, err := entry.loadDataPartsForRead(ctx, getPartIdxsFromMap(partMap))
	if err != nil {
		return 0, nil, err
	}
	// combine the entries into a single byte slice
	// note that we only want part of the first and last part depending on offset and size
	rtnData := make([]byte, 0, size)
	amtLeftToRead := size
	curReadOffset := offset
	for amtLeftToRead > 0 {
		partIdx := file.partIdxAtOffset(curReadOffset)
		partDataEntry := dataEntryMap[partIdx]
		var partData []byte
		if partDataEntry == nil {
			partData = make([]byte, partDataSize)
		} else {
			partData = partDataEntry.Data[0:partDataSize]
		}
		partOffset := curReadOffset % partDataSize
		amtToRead := minInt64(partDataSize-partOffset, amtLeftToRead)
		rtnData = append(rtnData, partData[partOffset:partOffset+amtToRead]...)
		amtLeftToRead -= amtToRead
		curReadOffset += amtToRead
	}
	return offset, rtnData, nil
}

func prunePartsWithCache(dataEntries map[int]*DataCacheEntry, parts []int) []int {
	var rtn []int
	for _, partIdx := range parts {
		if dataEntries[partIdx] != nil {
			continue
		}
		rtn = append(rtn, partIdx)
	}
	return rtn
}

func (entry *CacheEntry) loadDataPartsIntoCache(ctx context.Context, parts []int) error {
	parts = prunePartsWithCache(entry.DataEntries, parts)
	if len(parts) == 0 {
		// parts are already loaded
		return nil
	}
	dbDataParts, err := dbGetFileParts(ctx, entry.ZoneId, entry.Name, parts)
	if err != nil {
		return fmt.Errorf("error getting data parts: %w", err)
	}
	for partIdx, dce := range dbDataParts {
		entry.DataEntries[partIdx] = dce
	}
	return nil
}

func (entry *CacheEntry) loadDataPartsForRead(ctx context.Context, parts []int) (map[int]*DataCacheEntry, error) {
	if len(parts) == 0 {
		return nil, nil
	}
	dbParts := prunePartsWithCache(entry.DataEntries, parts)
	var dbDataParts map[int]*DataCacheEntry
	if len(dbParts) > 0 {
		var err error
		dbDataParts, err = dbGetFileParts(ctx, entry.ZoneId, entry.Name, dbParts)
		if err != nil {
			return nil, fmt.Errorf("error getting data parts: %w", err)
		}
	}
	rtn := make(map[int]*DataCacheEntry)
	for _, partIdx := range parts {
		if entry.DataEntries[partIdx] != nil {
			rtn[partIdx] = entry.DataEntries[partIdx]
			continue
		}
		if dbDataParts[partIdx] != nil {
			rtn[partIdx] = dbDataParts[partIdx]
			continue
		}
		// part not found
	}
	return rtn, nil
}

func makeCacheEntry(zoneId string, name string) *CacheEntry {
	return &CacheEntry{
		Lock:        &sync.Mutex{},
		ZoneId:      zoneId,
		Name:        name,
		PinCount:    0,
		File:        nil,
		DataEntries: make(map[int]*DataCacheEntry),
		FlushErrors: 0,
	}
}

func (entry *CacheEntry) flushToDB(ctx context.Context, replace bool) error {
	if entry.File == nil {
		return nil
	}
	err := dbWriteCacheEntry(ctx, entry.File, entry.DataEntries, replace)
	if ctx.Err() != nil {
		// transient error
		return ctx.Err()
	}
	if err != nil {
		flushErrorCount.Add(1)
		entry.FlushErrors++
		if entry.FlushErrors > 3 {
			entry.clear()
			return fmt.Errorf("too many flush errors (clearing entry): %w", err)
		}
		return err
	}
	// clear cache entry (data is now in db)
	entry.clear()
	return nil
}
