// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"container/list"
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

const ListDirChanSize = 50

// cache settings
const (
	maxCacheEntries = 20
	cacheTTL        = 60 * time.Second
)

type cacheEntry struct {
	key        string
	value      []DirEntryResult
	expiration time.Time
	lruElement *list.Element
}

var (
	cache    = make(map[string]*cacheEntry)
	cacheLRU = list.New()
	cacheMu  sync.Mutex

	// group ensures only one listing per key is executed concurrently.
	group singleflight.Group
)

func init() {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			cleanCache()
		}
	}()
}

func cleanCache() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	now := time.Now()
	for key, entry := range cache {
		if now.After(entry.expiration) {
			cacheLRU.Remove(entry.lruElement)
			delete(cache, key)
		}
	}
}

func getCache(key string) ([]DirEntryResult, bool) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	entry, ok := cache[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiration) {
		// expired
		cacheLRU.Remove(entry.lruElement)
		delete(cache, key)
		return nil, false
	}
	// update LRU order
	cacheLRU.MoveToFront(entry.lruElement)
	return entry.value, true
}

func setCache(key string, value []DirEntryResult) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	// if already exists, update it
	if entry, ok := cache[key]; ok {
		entry.value = value
		entry.expiration = time.Now().Add(cacheTTL)
		cacheLRU.MoveToFront(entry.lruElement)
		return
	}
	// evict if at capacity
	if cacheLRU.Len() >= maxCacheEntries {
		oldest := cacheLRU.Back()
		if oldest != nil {
			oldestKey := oldest.Value.(string)
			if oldEntry, ok := cache[oldestKey]; ok {
				cacheLRU.Remove(oldEntry.lruElement)
				delete(cache, oldestKey)
			}
		}
	}
	// add new entry
	elem := cacheLRU.PushFront(key)
	cache[key] = &cacheEntry{
		key:        key,
		value:      value,
		expiration: time.Now().Add(cacheTTL),
		lruElement: elem,
	}
}

// cacheDispose clears all cache entries for the provided widgetId.
func cacheDispose(widgetId string) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	prefix := widgetId + "|"
	for key, entry := range cache {
		if strings.HasPrefix(key, prefix) {
			cacheLRU.Remove(entry.lruElement)
			delete(cache, key)
		}
	}
}

type DirEntryResult struct {
	Entry fs.DirEntry
	Err   error
}

func listDirectory(ctx context.Context, widgetId string, dir string, maxFiles int) (<-chan DirEntryResult, error) {
	key := widgetId + "|" + dir
	if cached, ok := getCache(key); ok {
		ch := make(chan DirEntryResult, ListDirChanSize)
		go func() {
			defer close(ch)
			for _, r := range cached {
				select {
				case ch <- r:
				case <-ctx.Done():
					return
				}
			}
		}()
		return ch, nil
	}

	// Use singleflight to ensure only one listing operation occurs per key.
	value, err, _ := group.Do(key, func() (interface{}, error) {
		f, err := os.Open(dir)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		fi, err := f.Stat()
		if err != nil {
			return nil, err
		}
		if !fi.IsDir() {
			return nil, fmt.Errorf("%s is not a directory", dir)
		}
		entries, err := f.ReadDir(maxFiles)
		if err != nil {
			return nil, err
		}
		var results []DirEntryResult
		for _, entry := range entries {
			results = append(results, DirEntryResult{Entry: entry})
		}
		// Add parent directory (“..”) entry if not at the filesystem root.
		if filepath.Dir(dir) != dir {
			mockDir := &MockDirEntry{
				NameStr:  "..",
				IsDirVal: true,
				FileMode: fs.ModeDir | 0755,
			}
			results = append(results, DirEntryResult{Entry: mockDir})
		}
		return results, nil
	})
	if err != nil {
		return nil, err
	}
	results := value.([]DirEntryResult)
	setCache(key, results)

	ch := make(chan DirEntryResult, ListDirChanSize)
	go func() {
		defer close(ch)
		for _, r := range results {
			select {
			case ch <- r:
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch, nil
}
