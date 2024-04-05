package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

type FileOptsType struct {
	MaxSize  int64
	Circular bool
	IJson    bool
}

type FileMeta = map[string]any

type FileInfo struct {
	BlockId   string
	Name      string
	Size      int64
	CreatedTs int64
	ModTs     int64
	Opts      FileOptsType
	Meta      FileMeta
}

type CacheEntry struct {
	Lock       *sync.Mutex
	CacheTs    int64
	Info       FileInfo
	DataBlocks [][]byte
}

func MakeCacheEntry(info FileInfo) *CacheEntry {
	rtn := &CacheEntry{Lock: &sync.Mutex{}, CacheTs: int64(time.Now().UnixMilli()), Info: info, DataBlocks: [][]byte{}}
	return rtn
}

// add ctx context.Context to all these methods
type BlockStore interface {
	MakeFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType) error
	WriteFile(ctx context.Context, blockId string, name string, meta FileMeta, data []byte) error
	AppendData(ctx context.Context, blockId string, name string, p []byte) error
	WriteAt(ctx context.Context, blockId string, name string, p []byte, off int64) (int, error)
	ReadAt(ctx context.Context, blockId string, name string, p []byte, off int64) (int, error)
	Stat(ctx context.Context, blockId string, name string) (FileInfo, error)
	CollapseIJson(ctx context.Context, blockId string, name string) error
	WriteMeta(ctx context.Context, blockId string, name string, meta FileMeta) error
	DeleteFile(ctx context.Context, blockId string, name string) error
	DeleteBlock(ctx context.Context, blockId string) error
	ListFiles(ctx context.Context, blockId string) []FileInfo
	FlushCache(ctx context.Context) error
	GetAllBlockIds(ctx context.Context) []string
}

var cache map[string]*CacheEntry = make(map[string]*CacheEntry)

func WriteFileToDB(ctx context.Context, fileInfo FileInfo) error {
	metaJson, err := json.Marshal(fileInfo.Meta)
	if err != nil {
		return fmt.Errorf("Error writing file %s to db: %v", fileInfo.Name, err)
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `INSERT INTO block_file VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		tx.Exec(query, fileInfo.BlockId, fileInfo.Name, fileInfo.Opts.MaxSize, fileInfo.Opts.Circular, fileInfo.Size, fileInfo.CreatedTs, fileInfo.ModTs, metaJson)
		return nil
	})
	if txErr != nil {
		return fmt.Errorf("Error writing file %s to db: %v", fileInfo.Name, txErr)
	}
	return nil
}

func MakeFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType) error {
	curTs := time.Now().UnixMilli()
	fileInfo := FileInfo{BlockId: blockId, Name: name, Size: 0, CreatedTs: curTs, ModTs: curTs, Opts: opts, Meta: meta}
	err := WriteFileToDB(ctx, fileInfo)
	if err != nil {
		return err
	}
	curCacheEntry := MakeCacheEntry(fileInfo)
	cache[name] = curCacheEntry
	return nil
}
