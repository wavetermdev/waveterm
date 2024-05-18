// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

// the blockstore package implements a write cache for block files
// it is not a read cache (reads still go to the DB -- unless items are in the cache)
// but all writes only go to the cache, and then the cache is periodically flushed to the DB

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

const DefaultPartDataSize = 64 * 1024
const DefaultFlushTime = 5 * time.Second
const NoPartIdx = -1

var partDataSize int64 = DefaultPartDataSize // overridden in tests
var stopFlush = &atomic.Bool{}

var GBS *BlockStore = &BlockStore{
	Lock:  &sync.Mutex{},
	Cache: make(map[cacheKey]*CacheEntry),
}

type FileOptsType struct {
	MaxSize  int64
	Circular bool
	IJson    bool
}

type FileMeta = map[string]any

type BlockFile struct {
	BlockId   string       `json:"blockid"`
	Name      string       `json:"name"`
	Size      int64        `json:"size"`
	CreatedTs int64        `json:"createdts"`
	ModTs     int64        `json:"modts"`
	Opts      FileOptsType `json:"opts"`
	Meta      FileMeta     `json:"meta"`
}

func copyMeta(meta FileMeta) FileMeta {
	newMeta := make(FileMeta)
	for k, v := range meta {
		newMeta[k] = v
	}
	return newMeta
}

func (f *BlockFile) DeepCopy() *BlockFile {
	if f == nil {
		return nil
	}
	newFile := *f
	newFile.Meta = copyMeta(f.Meta)
	return &newFile
}

func (BlockFile) UseDBMap() {}

type BlockData struct {
	BlockId string `json:"blockid"`
	Name    string `json:"name"`
	PartIdx int    `json:"partidx"`
	Data    []byte `json:"data"`
}

func (BlockData) UseDBMap() {}

// synchronous (does not interact with the cache)
func (s *BlockStore) MakeFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType) error {
	if opts.MaxSize < 0 {
		return fmt.Errorf("max size must be non-negative")
	}
	if opts.Circular && opts.MaxSize <= 0 {
		return fmt.Errorf("circular file must have a max size")
	}
	if opts.Circular && opts.IJson {
		return fmt.Errorf("circular file cannot be ijson")
	}
	if opts.Circular {
		if opts.MaxSize%partDataSize != 0 {
			opts.MaxSize = (opts.MaxSize/partDataSize + 1) * partDataSize
		}
	}
	var cacheErr error
	s.withLock(blockId, name, false, func(entry *CacheEntry) {
		if entry == nil {
			return
		}
		if !entry.Deleted {
			cacheErr = fmt.Errorf("file exists")
			return
		}
		// deleted is set.  check intentions
		if entry.PinCount == 0 && len(entry.WriteIntentions) == 0 {
			delete(s.Cache, cacheKey{BlockId: blockId, Name: name})
			return
		}
		cacheErr = fmt.Errorf("file is deleted but has active requests")
	})
	if cacheErr != nil {
		return cacheErr
	}
	now := time.Now().UnixMilli()
	file := &BlockFile{
		BlockId:   blockId,
		Name:      name,
		Size:      0,
		CreatedTs: now,
		ModTs:     now,
		Opts:      opts,
		Meta:      meta,
	}
	return dbInsertFile(ctx, file)
}

func (s *BlockStore) DeleteFile(ctx context.Context, blockId string, name string) error {
	err := dbDeleteFile(ctx, blockId, name)
	if err != nil {
		return fmt.Errorf("error deleting file: %v", err)
	}
	s.withLock(blockId, name, false, func(entry *CacheEntry) {
		if entry == nil {
			return
		}
		if entry.PinCount > 0 || len(entry.WriteIntentions) > 0 {
			// mark as deleted if we have a active requests
			entry.Deleted = true
		} else {
			delete(s.Cache, cacheKey{BlockId: blockId, Name: name})
		}
	})
	return nil
}

func (s *BlockStore) DeleteBlock(ctx context.Context, blockId string) error {
	fileNames, err := dbGetBlockFileNames(ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block files: %v", err)
	}
	for _, name := range fileNames {
		s.DeleteFile(ctx, blockId, name)
	}
	return nil
}

func (s *BlockStore) Stat(ctx context.Context, blockId string, name string) (*BlockFile, error) {
	file, ok := s.getFileFromCache(blockId, name)
	if ok {
		return file, nil
	}
	return dbGetBlockFile(ctx, blockId, name)
}

func stripNils[T any](arr []*T) []*T {
	newArr := make([]*T, 0)
	for _, item := range arr {
		if item == nil {
			continue
		}
		newArr = append(newArr, item)
	}
	return newArr
}

func (s *BlockStore) ListFiles(ctx context.Context, blockId string) ([]*BlockFile, error) {
	files, err := dbGetBlockFiles(ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block files: %v", err)
	}
	// now we wash the files through the cache
	var hasNils bool
	for idx, dbFile := range files {
		cacheFile, ok := s.getFileFromCache(dbFile.BlockId, dbFile.Name)
		if ok {
			if cacheFile == nil {
				hasNils = true
			}
			files[idx] = cacheFile
		}
	}
	if hasNils {
		files = stripNils(files)
	}
	return files, nil
}

func (s *BlockStore) WriteMeta(ctx context.Context, blockId string, name string, meta FileMeta, merge bool) error {
	file, ok := s.getFileFromCache(blockId, name)
	if !ok {
		dbFile, err := dbGetBlockFile(ctx, blockId, name)
		if err != nil {
			return fmt.Errorf("error getting file: %v", err)
		}
		file = dbFile
	}
	if file == nil {
		return fmt.Errorf("file not found")
	}
	var rtnErr error
	s.withLock(blockId, name, true, func(entry *CacheEntry) {
		if entry.Deleted {
			rtnErr = fmt.Errorf("file is deleted")
			return
		}
		newFileEntry := entry.copyOrCreateFileEntry(file)
		if merge {
			for k, v := range meta {
				if v == nil {
					delete(newFileEntry.File.Meta, k)
					continue
				}
				newFileEntry.File.Meta[k] = v
			}
		} else {
			newFileEntry.File.Meta = meta
		}
		entry.FileEntry = newFileEntry
		entry.FileEntry.File.ModTs = time.Now().UnixMilli()
		entry.Version++
	})
	return rtnErr
}

func (s *BlockStore) loadFileInfo(ctx context.Context, blockId string, name string) (*BlockFile, error) {
	file, ok := s.getFileFromCache(blockId, name)
	if ok {
		if file == nil {
			return nil, fmt.Errorf("file not found")
		}
		return file, nil
	}
	dbFile, err := dbGetBlockFile(ctx, blockId, name)
	if err != nil {
		return nil, fmt.Errorf("error getting file: %v", err)
	}
	if dbFile == nil {
		return nil, fmt.Errorf("file not found")
	}
	var rtnErr error
	rtnFile := dbFile
	s.withLock(blockId, name, true, func(entry *CacheEntry) {
		if entry.Deleted {
			rtnFile = nil
			rtnErr = fmt.Errorf("file is deleted")
			return
		}
		if entry.FileEntry != nil {
			// someone beat us to it
			rtnFile = entry.FileEntry.File.DeepCopy()
			return
		}
		entry.FileEntry = entry.copyOrCreateFileEntry(dbFile)
		// returns dbFile, nil
	})
	return rtnFile, rtnErr
}

func (f *BlockFile) getLastIncompletePartNum() int {
	if f.Size%partDataSize == 0 {
		return NoPartIdx
	}
	return f.partIdxAtOffset(f.Size)
}

func (f *BlockFile) partIdxAtOffset(offset int64) int {
	partIdx := int(offset / partDataSize)
	if f.Opts.Circular {
		maxPart := int(f.Opts.MaxSize / partDataSize)
		partIdx = partIdx % maxPart
	}
	return partIdx
}

// blockfile must be loaded
func (s *BlockStore) loadLastDataBlock(ctx context.Context, blockId string, name string) error {
	var partIdx int
	err := s.withLockExists(blockId, name, func(entry *CacheEntry) error {
		partIdx = entry.FileEntry.File.getLastIncompletePartNum()
		return nil
	})
	if err != nil {
		return err
	}
	if partIdx == NoPartIdx {
		return nil
	}
	return s.loadDataParts(ctx, blockId, name, []int{partIdx})
}

func maxOfIntArr(arr []int) int {
	if len(arr) == 0 {
		return 0
	}
	max := arr[0]
	for _, v := range arr[1:] {
		if v > max {
			max = v
		}
	}
	return max
}

func (s *BlockStore) loadDataParts(ctx context.Context, blockId string, name string, parts []int) error {
	partDataMap, err := dbGetFileParts(ctx, blockId, name, parts)
	if err != nil {
		return fmt.Errorf("error getting file part: %v", err)
	}
	maxPart := maxOfIntArr(parts)
	return s.withLockExists(blockId, name, func(entry *CacheEntry) error {
		entry.ensurePart(maxPart, false)
		for partIdx, partData := range partDataMap {
			if entry.DataEntries[partIdx] != nil {
				// someone beat us to it
				continue
			}
			entry.DataEntries[partIdx] = partData
		}
		return nil
	})
}

func (s *BlockStore) writeAt_nolock(entry *CacheEntry, offset int64, data []byte) {
	endWrite := offset + int64(len(data))
	entry.writeAt(offset, data)
	if endWrite > entry.FileEntry.File.Size {
		entry.FileEntry.File.Size = endWrite
	}
	entry.FileEntry.File.ModTs = time.Now().UnixMilli()
	entry.Version++
}

func (s *BlockStore) appendDataToCache(blockId string, name string, data []byte) error {
	return s.withLockExists(blockId, name, func(entry *CacheEntry) error {
		s.writeAt_nolock(entry, entry.FileEntry.File.Size, data)
		return nil
	})
}

func (s *BlockStore) AppendData(ctx context.Context, blockId string, name string, data []byte) error {
	s.pinCacheEntry(blockId, name)
	defer s.unpinCacheEntry(blockId, name)
	_, err := s.loadFileInfo(ctx, blockId, name)
	if err != nil {
		return fmt.Errorf("error loading file info: %v", err)
	}
	err = s.loadLastDataBlock(ctx, blockId, name)
	if err != nil {
		return fmt.Errorf("error loading last data block: %v", err)
	}
	err = s.appendDataToCache(blockId, name, data)
	if err != nil {
		return fmt.Errorf("error appending data: %v", err)
	}
	return nil
}

func (s *BlockStore) GetAllBlockIds(ctx context.Context) ([]string, error) {
	return dbGetAllBlockIds(ctx)
}

// returns a map of partIdx to amount of data to write to that part
func (file *BlockFile) computePartMap(startOffset int64, size int64) map[int]int {
	partMap := make(map[int]int)
	endOffset := startOffset + size
	startBlockOffset := startOffset - (startOffset % partDataSize)
	for testOffset := startBlockOffset; testOffset < endOffset; testOffset += partDataSize {
		partIdx := file.partIdxAtOffset(testOffset)
		partStartOffset := testOffset
		partEndOffset := testOffset + partDataSize
		partWriteStartOffset := 0
		partWriteEndOffset := int(partDataSize)
		if startOffset > partStartOffset && startOffset < partEndOffset {
			partWriteStartOffset = int(startOffset - partStartOffset)
		}
		if endOffset > partStartOffset && endOffset < partEndOffset {
			partWriteEndOffset = int(endOffset - partStartOffset)
		}
		partMap[partIdx] = partWriteEndOffset - partWriteStartOffset
	}
	return partMap
}

func (s *BlockStore) WriteAt(ctx context.Context, blockId string, name string, offset int64, data []byte) error {
	s.pinCacheEntry(blockId, name)
	defer s.unpinCacheEntry(blockId, name)
	file, err := s.loadFileInfo(ctx, blockId, name)
	if err != nil {
		return fmt.Errorf("error loading file info: %v", err)
	}
	startWriteIdx := offset
	endWriteIdx := offset + int64(len(data))
	startPartIdx := file.partIdxAtOffset(startWriteIdx)
	endPartIdx := file.partIdxAtOffset(endWriteIdx)
	err = s.loadDataParts(ctx, blockId, name, []int{startPartIdx, endPartIdx})
	if err != nil {
		return fmt.Errorf("error loading data parts: %v", err)
	}
	return s.withLockExists(blockId, name, func(entry *CacheEntry) error {
		s.writeAt_nolock(entry, offset, data)
		return nil
	})
}

// returns (offset, data, error)
// we return the offset because the offset may have been adjusted if the size was too big (for circular files)
func (s *BlockStore) ReadAt(ctx context.Context, blockId string, name string, offset int64, size int64) (int64, []byte, error) {
	s.pinCacheEntry(blockId, name)
	defer s.unpinCacheEntry(blockId, name)
	file, err := s.Stat(ctx, blockId, name)
	if err != nil {
		return 0, nil, fmt.Errorf("error getting file: %v", err)
	}
	if file.Opts.Circular {
		// we can do this check here because MaxSize for file cannot be modified
		if size > file.Opts.MaxSize {
			// just read the last maxsize bytes
			sizeTooBig := size - file.Opts.MaxSize
			offset += sizeTooBig
		}
	}
	var partsNeeded []int
	lastPartOffset := (offset + size) % partDataSize
	endOffsetOfLastPart := offset + size - lastPartOffset + partDataSize
	for i := offset; i < endOffsetOfLastPart; i += partDataSize {
		partsNeeded = append(partsNeeded, file.partIdxAtOffset(i))
	}
	dataEntries, err := dbGetFileParts(ctx, blockId, name, partsNeeded)
	if err != nil {
		return 0, nil, fmt.Errorf("error loading data parts: %v", err)
	}
	// wash the entries through the cache
	err = s.withLockExists(blockId, name, func(entry *CacheEntry) error {
		if offset+size > entry.FileEntry.File.Size {
			// limit read to the actual size of the file
			size = entry.FileEntry.File.Size - offset
		}
		for _, partIdx := range partsNeeded {
			if len(entry.DataEntries) <= partIdx || entry.DataEntries[partIdx] == nil {
				continue
			}
			dataEntries[partIdx] = entry.DataEntries[partIdx]
		}
		return nil
	})
	if err != nil {
		return 0, nil, fmt.Errorf("error reconciling cache entries: %v", err)
	}
	// combine the entries into a single byte slice
	// note that we only want part of the first and last part depending on offset and size
	var rtn []byte
	amtLeftToRead := size
	curReadOffset := offset
	for amtLeftToRead > 0 {
		partIdx := file.partIdxAtOffset(curReadOffset)
		partDataEntry := dataEntries[partIdx]
		var partData []byte
		if partDataEntry == nil {
			partData = make([]byte, partDataSize)
		} else {
			partData = partDataEntry.Data[0:partDataSize]
		}
		partOffset := curReadOffset % partDataSize
		amtToRead := minInt64(partDataSize-partOffset, amtLeftToRead)
		rtn = append(rtn, partData[partOffset:partOffset+amtToRead]...)
		amtLeftToRead -= amtToRead
		curReadOffset += amtToRead
	}
	return offset, rtn, nil
}

func (s *BlockStore) ReadFile(ctx context.Context, blockId string, name string) (int64, []byte, error) {
	file, err := s.Stat(ctx, blockId, name)
	if err != nil {
		return 0, nil, fmt.Errorf("error getting file: %v", err)
	}
	if file == nil {
		return 0, nil, fmt.Errorf("file not found")
	}
	return s.ReadAt(ctx, blockId, name, 0, file.Size)
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
