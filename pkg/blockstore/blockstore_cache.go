// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockstore

import (
	"bytes"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

type cacheKey struct {
	BlockId string
	Name    string
}

// note about "Dirty" and "Flushing" fields:
// - Dirty is set to true when the entry is modified
// - Flushing is set to true when the entry is being flushed to disk
// note these fields can *only* be set to true while holding the store lock
// but the flusher  may set them to false without the lock (when the flusher no longer will read the entry fields)
// the flusher *must* unset Dirty first, then Flushing
// other code should test Flushing before Dirty
// that means you *cannot* write a field in a cache entry if Flushing.Load() is true (you must make a copy)
type DataCacheEntry struct {
	Dirty    *atomic.Bool
	Flushing *atomic.Bool
	PartIdx  int
	Data     []byte // capacity is always BlockDataPartSize
}

type FileCacheEntry struct {
	Dirty    *atomic.Bool
	Flushing *atomic.Bool
	File     BlockFile
}

type WriteIntention struct {
	Parts   map[int]int
	Append  bool
	Replace bool
}

// invariants:
// - we only modify CacheEntry fields when we are holding the BlockStore lock
// - FileEntry can be nil, if pinned
// - FileEntry.File is never updated in place, the entire FileEntry is replaced
// - DataCacheEntry items are never updated in place, the entire DataCacheEntry is replaced
// - when pinned, the cache entry is never removed
// this allows us to flush the cache entry to disk without holding the lock
// if there is a dirty data entry, then FileEntry must also be dirty
type CacheEntry struct {
	BlockId         string
	Name            string
	PinCount        int
	Deleted         bool
	WriteIntentions map[int]WriteIntention // map from intentionid -> WriteIntention
	FileEntry       *FileCacheEntry
	DataEntries     map[int]*DataCacheEntry
	FlushErrors     int
}

//lint:ignore U1000 used for testing
func (e *CacheEntry) dump() string {
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "CacheEntry{\nBlockId: %q, Name: %q, PinCount: %d, Deleted: %v, IW: %v\n", e.BlockId, e.Name, e.PinCount, e.Deleted, e.WriteIntentions)
	if e.FileEntry != nil {
		fmt.Fprintf(&buf, "FileEntry: %v\n", e.FileEntry.File)
	}
	for idx, dce := range e.DataEntries {
		fmt.Fprintf(&buf, "DataEntry[%d][%v]: %q\n", idx, dce.Dirty.Load(), string(dce.Data))
	}
	buf.WriteString("}\n")
	return buf.String()
}

//lint:ignore U1000 used for testing
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

func makeDataCacheEntry(partIdx int) *DataCacheEntry {
	return &DataCacheEntry{
		Dirty:    &atomic.Bool{},
		Flushing: &atomic.Bool{},
		PartIdx:  partIdx,
		Data:     make([]byte, 0, partDataSize),
	}
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

func (e *CacheEntry) getOrCreateDataCacheEntry(partIdx int) *DataCacheEntry {
	if e.DataEntries[partIdx] == nil {
		e.DataEntries[partIdx] = makeDataCacheEntry(partIdx)
	}
	return e.DataEntries[partIdx]
}

func (dce *DataCacheEntry) clonePart() *DataCacheEntry {
	rtn := makeDataCacheEntry(dce.PartIdx)
	copy(rtn.Data, dce.Data)
	if dce.Dirty.Load() {
		rtn.Dirty.Store(true)
	}
	return rtn
}

func (dce *DataCacheEntry) writeToPart(offset int64, data []byte) (int64, *DataCacheEntry) {
	if dce.Flushing.Load() {
		dce = dce.clonePart()
	}
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
	return toWrite, dce
}

func (entry *CacheEntry) writeAt(offset int64, data []byte, replace bool) {
	endWriteOffset := offset + int64(len(data))
	if replace {
		entry.DataEntries = make(map[int]*DataCacheEntry)
	}
	for len(data) > 0 {
		partIdx := int(offset / partDataSize)
		if entry.FileEntry.File.Opts.Circular {
			maxPart := int(entry.FileEntry.File.Opts.MaxSize / partDataSize)
			partIdx = partIdx % maxPart
		}
		partOffset := offset % partDataSize
		partData := entry.getOrCreateDataCacheEntry(partIdx)
		nw, newDce := partData.writeToPart(partOffset, data)
		entry.DataEntries[partIdx] = newDce
		data = data[nw:]
		offset += nw
	}
	entry.modifyFileData(func(file *BlockFile) {
		if endWriteOffset > file.Size || replace {
			file.Size = endWriteOffset
		}
	})
}

type BlockStore struct {
	Lock            *sync.Mutex
	Cache           map[cacheKey]*CacheEntry
	NextIntentionId int
}

func makeCacheEntry(blockId string, name string) *CacheEntry {
	return &CacheEntry{
		BlockId:         blockId,
		Name:            name,
		PinCount:        0,
		WriteIntentions: make(map[int]WriteIntention),
		FileEntry:       nil,
		DataEntries:     make(map[int]*DataCacheEntry),
		FlushErrors:     0,
	}
}

func (s *BlockStore) withLock(blockId string, name string, shouldCreate bool, f func(*CacheEntry)) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		if shouldCreate {
			entry = makeCacheEntry(blockId, name)
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
		entry = makeCacheEntry(blockId, name)
		s.Cache[cacheKey{BlockId: blockId, Name: name}] = entry
	}
	entry.PinCount++
}

func (s *BlockStore) setWriteIntention(blockId string, name string, intention WriteIntention) int {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		return 0
	}
	intentionId := s.NextIntentionId
	s.NextIntentionId++
	entry.WriteIntentions[intentionId] = intention
	return intentionId
}

func (s *BlockStore) clearWriteIntention(blockId string, name string, intentionId int) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		warningCount.Add(1)
		log.Printf("warning: cannot find write intention to clear %q %q", blockId, name)
		return
	}
	delete(entry.WriteIntentions, intentionId)
}

func (s *BlockStore) unpinCacheEntry(blockId string, name string) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		warningCount.Add(1)
		log.Printf("warning: unpinning non-existent cache entry %q %q", blockId, name)
		return
	}
	entry.PinCount--
}

// getFileFromCache returns the file from the cache if it exists
// makes a copy, so it can be used by the caller
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

func (e *CacheEntry) modifyFileData(fn func(*BlockFile)) {
	var fileEntry = e.FileEntry
	if e.FileEntry.Flushing.Load() {
		// must make a copy
		fileEntry = &FileCacheEntry{
			Dirty:    &atomic.Bool{},
			Flushing: &atomic.Bool{},
			File:     *e.FileEntry.File.DeepCopy(),
		}
		e.FileEntry = fileEntry
	}
	// always set to dirty (we're modifying it)
	fileEntry.Dirty.Store(true)
	fileEntry.File.ModTs = time.Now().UnixMilli()
	fn(&fileEntry.File)
}

// also sets Flushing to true on fileentry / dataentries
func (s *BlockStore) getDirtyDataEntriesForFlush(blockId string, name string) (*FileCacheEntry, []*DataCacheEntry) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		return nil, nil
	}
	if entry.Deleted || entry.FileEntry == nil {
		return nil, nil
	}
	var dirtyData []*DataCacheEntry
	for _, dce := range entry.DataEntries {
		if dce != nil && dce.Dirty.Load() {
			dce.Flushing.Store(true)
			dirtyData = append(dirtyData, dce)
		}
	}
	if !entry.FileEntry.Dirty.Load() && len(dirtyData) == 0 {
		return nil, nil
	}
	for _, data := range dirtyData {
		data.Flushing.Store(true)
	}
	return entry.FileEntry, dirtyData
}

func (entry *CacheEntry) isDataBlockPinned(partIdx int) bool {
	if entry.FileEntry == nil {
		warningCount.Add(1)
		log.Printf("warning: checking pinned, but no FileEntry %q %q", entry.BlockId, entry.Name)
		return false
	}
	lastIncomplete := entry.FileEntry.File.getLastIncompletePartNum()
	for _, intention := range entry.WriteIntentions {
		if intention.Append && partIdx == lastIncomplete {
			return true
		}
		if intention.Parts[partIdx] > 0 {
			return true
		}
		// note "replace" does not pin anything
	}
	return false
}

// removes clean data entries (if they aren't pinned)
// and if the entire cache entry is not in use and is clean, removes the entry
func (s *BlockStore) cleanCacheEntry(blockId string, name string) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	entry := s.Cache[cacheKey{BlockId: blockId, Name: name}]
	if entry == nil {
		return
	}
	var hasDirtyData bool
	for _, dce := range entry.DataEntries {
		if dce.Flushing.Load() || dce.Dirty.Load() || entry.isDataBlockPinned(dce.PartIdx) {
			hasDirtyData = true
			continue
		}
		delete(entry.DataEntries, dce.PartIdx)
	}
	if hasDirtyData || (entry.FileEntry != nil && entry.FileEntry.Dirty.Load()) {
		return
	}
	if entry.PinCount > 0 {
		return
	}
	if len(entry.WriteIntentions) > 0 {
		return
	}
	delete(s.Cache, cacheKey{BlockId: blockId, Name: name})
}
