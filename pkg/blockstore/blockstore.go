// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

// the blockstore package implements a write cache for block files
// it is not a read cache (reads still go to the DB -- unless items are in the cache)
// but all writes only go to the cache, and then the cache is periodically flushed to the DB

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

const DefaultPartDataSize = 64 * 1024
const DefaultFlushTime = 5 * time.Second
const NoPartIdx = -1

// for unit tests
var warningCount = &atomic.Int32{}
var flushErrorCount = &atomic.Int32{}

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
	// these fields are static (not updated)
	BlockId   string       `json:"blockid"`
	Name      string       `json:"name"`
	Opts      FileOptsType `json:"opts"`
	CreatedTs int64        `json:"createdts"`

	//  these fields are mutable
	Size  int64    `json:"size"`
	ModTs int64    `json:"modts"`
	Meta  FileMeta `json:"meta"` // only top-level keys can be updated (lower levels are immutable)
}

// this works because lower levels are immutable
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
	return withLock(s, blockId, name, func(entry *CacheEntry) error {
		if entry.File != nil {
			return os.ErrExist
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
	})
}

func (s *BlockStore) DeleteFile(ctx context.Context, blockId string, name string) error {
	return withLock(s, blockId, name, func(entry *CacheEntry) error {
		err := dbDeleteFile(ctx, blockId, name)
		if err != nil {
			return fmt.Errorf("error deleting file: %v", err)
		}
		entry.clear()
		return nil
	})
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

// if file doesn't exsit, returns os.ErrNotExist
func (s *BlockStore) Stat(ctx context.Context, blockId string, name string) (*BlockFile, error) {
	return withLockRtn(s, blockId, name, func(entry *CacheEntry) (*BlockFile, error) {
		file, err := entry.loadFileForRead(ctx)
		if err != nil {
			return nil, fmt.Errorf("error getting file: %v", err)
		}
		return file.DeepCopy(), nil
	})
}

func (s *BlockStore) ListFiles(ctx context.Context, blockId string) ([]*BlockFile, error) {
	files, err := dbGetBlockFiles(ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block files: %v", err)
	}
	for idx, file := range files {
		withLock(s, file.BlockId, file.Name, func(entry *CacheEntry) error {
			if entry.File != nil {
				files[idx] = entry.File.DeepCopy()
			}
			return nil
		})
	}
	return files, nil
}

func (s *BlockStore) WriteMeta(ctx context.Context, blockId string, name string, meta FileMeta, merge bool) error {
	return withLock(s, blockId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		if merge {
			for k, v := range meta {
				if v == nil {
					delete(entry.File.Meta, k)
					continue
				}
				entry.File.Meta[k] = v
			}
		} else {
			entry.File.Meta = meta
		}
		entry.File.ModTs = time.Now().UnixMilli()
		return nil
	})
}

func (s *BlockStore) WriteFile(ctx context.Context, blockId string, name string, data []byte) error {
	return withLock(s, blockId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		entry.writeAt(0, data, true)
		return nil
	})
}

func (s *BlockStore) WriteAt(ctx context.Context, blockId string, name string, offset int64, data []byte) error {
	if offset < 0 {
		return fmt.Errorf("offset must be non-negative")
	}
	return withLock(s, blockId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		file := entry.File
		if offset > file.Size {
			return fmt.Errorf("offset is past the end of the file")
		}
		if file.Opts.Circular {
			startCirFileOffset := file.Size - file.Opts.MaxSize
			if offset+int64(len(data)) < startCirFileOffset {
				// write is before the start of the circular file
				return nil
			}
			if offset < startCirFileOffset {
				amtBeforeStart := startCirFileOffset - offset
				offset += amtBeforeStart
				data = data[amtBeforeStart:]
			}
		}
		partMap := file.computePartMap(offset, int64(len(data)))
		incompleteParts := incompletePartsFromMap(partMap)
		err = entry.loadDataPartsIntoCache(ctx, incompleteParts)
		if err != nil {
			return err
		}
		entry.writeAt(offset, data, true)
		return nil
	})
}

func (s *BlockStore) AppendData(ctx context.Context, blockId string, name string, data []byte) error {
	return withLock(s, blockId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		lastPartIdx := entry.File.getLastIncompletePartNum()
		if lastPartIdx != NoPartIdx {
			err = entry.loadDataPartsIntoCache(ctx, []int{lastPartIdx})
			if err != nil {
				return err
			}
		}
		entry.writeAt(entry.File.Size, data, false)
		return nil
	})
}

func (s *BlockStore) GetAllBlockIds(ctx context.Context) ([]string, error) {
	return dbGetAllBlockIds(ctx)
}

// returns (offset, data, error)
// we return the offset because the offset may have been adjusted if the size was too big (for circular files)
func (s *BlockStore) ReadAt(ctx context.Context, blockId string, name string, offset int64, size int64) (rtnOffset int64, rtnData []byte, rtnErr error) {
	withLock(s, blockId, name, func(entry *CacheEntry) error {
		rtnOffset, rtnData, rtnErr = entry.readAt(ctx, offset, size, false)
		return nil
	})
	return
}

// returns (offset, data, error)
func (s *BlockStore) ReadFile(ctx context.Context, blockId string, name string) (rtnOffset int64, rtnData []byte, rtnErr error) {
	withLock(s, blockId, name, func(entry *CacheEntry) error {
		rtnOffset, rtnData, rtnErr = entry.readAt(ctx, 0, 0, true)
		return nil
	})
	return
}

func (s *BlockStore) FlushCache(ctx context.Context) error {
	wasFlushing := s.setUnlessFlushing()
	if wasFlushing {
		return fmt.Errorf("flush already in progress")
	}
	defer s.setIsFlushing(false)

	// get a copy of dirty keys so we can iterate without the lock
	dirtyCacheKeys := s.getDirtyCacheKeys()
	for _, key := range dirtyCacheKeys {
		err := withLock(s, key.BlockId, key.Name, func(entry *CacheEntry) error {
			return entry.flushToDB(ctx)
		})
		if ctx.Err() != nil {
			// transient error (also must stop the loop)
			return ctx.Err()
		}
		if err != nil {
			return fmt.Errorf("error flushing cache entry[%v]: %v", key, err)
		}
	}
	return nil
}

///////////////////////////////////

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

func incompletePartsFromMap(partMap map[int]int) []int {
	var incompleteParts []int
	for partIdx, size := range partMap {
		if size != int(partDataSize) {
			incompleteParts = append(incompleteParts, partIdx)
		}
	}
	return incompleteParts
}

func getPartIdxsFromMap(partMap map[int]int) []int {
	var partIdxs []int
	for partIdx := range partMap {
		partIdxs = append(partIdxs, partIdx)
	}
	return partIdxs
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

func (s *BlockStore) getDirtyCacheKeys() []cacheKey {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	var dirtyCacheKeys []cacheKey
	for key, entry := range s.Cache {
		if entry.File != nil {
			dirtyCacheKeys = append(dirtyCacheKeys, key)
		}
	}
	return dirtyCacheKeys
}

func (s *BlockStore) setIsFlushing(flushing bool) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	s.IsFlushing = flushing
}

// returns old value of IsFlushing
func (s *BlockStore) setUnlessFlushing() bool {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	if s.IsFlushing {
		return true
	}
	s.IsFlushing = true
	return false

}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
