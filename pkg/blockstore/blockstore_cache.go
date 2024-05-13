// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

import (
	"bytes"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type cacheKey struct {
	BlockId string
	Name    string
}

type DataCacheEntry struct {
	Dirty   *atomic.Bool
	PartIdx int
	Data    []byte // capacity is always BlockDataPartSize
}

type FileCacheEntry struct {
	Dirty *atomic.Bool
	File  BlockFile
}

// invariants:
// - we only modify CacheEntry fields when we are holding the BlockStore lock
// - FileEntry can be nil, if pinned
// - FileEntry.File is never updated in place, the entire FileEntry is replaced
// - DataCacheEntry items are never updated in place, the entire DataCacheEntry is replaced
// - when pinned, the cache entry is never removed
// this allows us to flush the cache entry to disk without holding the lock
type CacheEntry struct {
	BlockId     string
	Name        string
	Version     int
	PinCount    int
	Deleted     bool
	FileEntry   *FileCacheEntry
	DataEntries []*DataCacheEntry
}

func (e *CacheEntry) dump() string {
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "CacheEntry{\nBlockId: %q, Name: %q, Version: %d, PinCount: %d, Deleted: %v\n", e.BlockId, e.Name, e.Version, e.PinCount, e.Deleted)
	if e.FileEntry != nil {
		fmt.Fprintf(&buf, "FileEntry: %v\n", e.FileEntry.File)
	}
	for i, dce := range e.DataEntries {
		if dce != nil {
			fmt.Fprintf(&buf, "DataEntry[%d][%v]: %q\n", i, dce.Dirty.Load(), string(dce.Data))
		}
	}
	buf.WriteString("}\n")
	return buf.String()
}

func (s *BlockStore) dump() string {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("BlockStore %d entries\n", len(s.Cache)))
	for _, v := range s.Cache {
		entryStr := v.dump()
		buf.WriteString(entryStr)
		buf.WriteString("\n")
	}
	return buf.String()

}

// for testing
func (s *BlockStore) getCacheSize() int {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	return len(s.Cache)
}

// for testing
func (s *BlockStore) clearCache() {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	s.Cache = make(map[cacheKey]*CacheEntry)
}

func (e *CacheEntry) ensurePart(partIdx int, create bool) *DataCacheEntry {
	for len(e.DataEntries) <= partIdx {
		e.DataEntries = append(e.DataEntries, nil)
	}
	if create && e.DataEntries[partIdx] == nil {
		e.DataEntries[partIdx] = &DataCacheEntry{
			PartIdx: partIdx,
			Data:    make([]byte, 0, partDataSize),
			Dirty:   &atomic.Bool{},
		}
	}
	return e.DataEntries[partIdx]
}

func (dce *DataCacheEntry) writeToPart(offset int64, data []byte) int64 {
	leftInPart := partDataSize - offset
	toWrite := int64(len(data))
	if toWrite > leftInPart {
		toWrite = leftInPart
	}
	if int64(len(dce.Data)) < offset+toWrite {
		dce.Data = dce.Data[:offset+toWrite]
	}
	copy(dce.Data[offset:], data[:toWrite])
	dce.Dirty.Store(true)
	return toWrite
}

func (entry *CacheEntry) writeAt(offset int64, data []byte) {
	for len(data) > 0 {
		partIdx := int(offset / partDataSize)
		if entry.FileEntry.File.Opts.Circular {
			maxPart := int(entry.FileEntry.File.Opts.MaxSize / partDataSize)
			partIdx = partIdx % maxPart
		}
		partOffset := offset % partDataSize
		partData := entry.ensurePart(partIdx, true)
		nw := partData.writeToPart(partOffset, data)
		data = data[nw:]
		offset += nw
	}
}

type BlockStore struct {
	Lock      *sync.Mutex
	Cache     map[cacheKey]*CacheEntry
	FlushTime time.Duration
}

func (s *BlockStore) withLock(blockId string, name string, shouldCreate bool, f func(*CacheEntry)) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		if shouldCreate {
			entry = &CacheEntry{
				BlockId:     blockId,
				Name:        name,
				PinCount:    0,
				FileEntry:   nil,
				DataEntries: nil,
			}
			s.Cache[cacheKey{BlockId: blockId, Name: name}] = entry
		}
	}
	f(entry)
}

func (s *BlockStore) withLockExists(blockId string, name string, f func(*CacheEntry) error) error {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil || entry.Deleted || entry.FileEntry == nil {
		return fmt.Errorf("file not found")
	}
	return f(entry)
}

func (s *BlockStore) pinCacheEntry(blockId string, name string) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		entry = &CacheEntry{
			BlockId:     blockId,
			Name:        name,
			PinCount:    0,
			FileEntry:   nil,
			DataEntries: nil,
		}
		s.Cache[cacheKey{BlockId: blockId, Name: name}] = entry
	}
	entry.PinCount++
}

func (s *BlockStore) unpinCacheEntry(blockId string, name string) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		// this is not good
		return
	}
	entry.PinCount--
}

func (s *BlockStore) tryDeleteCacheEntry(blockId string, name string) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		return
	}
	if entry.PinCount > 0 {
		return
	}
	delete(s.Cache, cacheKey{BlockId: blockId, Name: name})
}

// getFileFromCache returns the file from the cache if it exists
// return (file, cached)
func (s *BlockStore) getFileFromCache(blockId string, name string) (*BlockFile, bool) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		return nil, false
	}
	if entry.Deleted {
		return nil, true
	}
	if entry.FileEntry == nil {
		return nil, false
	}
	return entry.FileEntry.File.DeepCopy(), true
}

func (e *CacheEntry) copyOrCreateFileEntry(dbFile *BlockFile) *FileCacheEntry {
	if e.FileEntry == nil {
		return &FileCacheEntry{
			Dirty: &atomic.Bool{},
			File:  *dbFile,
		}
	}
	return &FileCacheEntry{
		Dirty: &atomic.Bool{},
		File:  *e.FileEntry.File.DeepCopy(),
	}
}
