package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	units "github.com/alecthomas/units"
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

const MaxBlockSize = int64(128 * units.Kilobyte)

type CacheEntry struct {
	Lock       *sync.Mutex
	CacheTs    int64
	Info       FileInfo
	DataBlocks []*CacheBlock
}

type CacheBlock struct {
	data []byte
	size int
}

func MakeCacheEntry(info FileInfo) *CacheEntry {
	rtn := &CacheEntry{Lock: &sync.Mutex{}, CacheTs: int64(time.Now().UnixMilli()), Info: info, DataBlocks: []*CacheBlock{}}
	return rtn
}

// add ctx context.Context to all these methods
type BlockStore interface {
	MakeFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType) error
	WriteFile(ctx context.Context, blockId string, name string, meta FileMeta, data []byte) error
	AppendData(ctx context.Context, blockId string, name string, p []byte) error
	WriteAt(ctx context.Context, blockId string, name string, p []byte, off int64) (int, error)
	ReadAt(ctx context.Context, blockId string, name string, p *[]byte, off int64) (int, error)
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
	cache[GetCacheId(blockId, name)] = curCacheEntry
	return nil
}

func WriteToCacheBlock(ctx context.Context, blockId string, name string, block *CacheBlock, p []byte, pos int, length int) (int, error) {
	cacheEntry, getErr := GetCacheEntry(ctx, blockId, name)
	if getErr != nil {
		return 0, getErr
	}
	cacheEntry.Lock.Lock()
	defer cacheEntry.Lock.Unlock()
	blockLen := len(block.data)
	bytesWritten, writeErr := WriteToCacheBuf(&block.data, p, pos, length)
	blockLenDiff := len(block.data) - blockLen
	block.size += blockLenDiff
	cacheEntry.Info.Size += int64(blockLenDiff)
	return bytesWritten, writeErr
}

func WriteToCacheBuf(buf *[]byte, p []byte, pos int, length int) (int, error) {
	log.Printf("write to cache buf: buf: %v, p: %v, pos: %v, int: %v", buf, p, pos, length)
	bytesToWrite := length
	if pos > len(*buf) {
		return 0, fmt.Errorf("writing to a position in the cache that doesn't exist yet, something went wrong")
	}
	if int64(len(*buf)+bytesToWrite) > MaxBlockSize {
		return 0, fmt.Errorf("writing more bytes than max block size, not allowed - length of bytes to write: %v, length of cache: %v", bytesToWrite, len(*buf))
	}
	for index := pos; index < bytesToWrite+pos; index++ {
		log.Printf("writetocache mk1\n")
		if index-pos >= len(p) {
			return len(p), nil
		}
		curByte := p[index-pos]
		if len(*buf) == index {
			log.Printf("writetocache mk2: %v %v %v %v\n", *buf, p, index, index-pos)
			*buf = append(*buf, curByte)
		} else {
			log.Printf("writetocache mk3\n")
			(*buf)[index] = curByte
		}
	}
	log.Printf("writetocache mk4\n")
	return bytesToWrite, nil
}

func GetCacheId(blockId string, name string) string {
	return blockId + "-" + name
}

func GetCacheEntry(ctx context.Context, blockId string, name string) (*CacheEntry, error) {
	if curCacheEntry, found := cache[GetCacheId(blockId, name)]; found {
		return curCacheEntry, nil
	} else {
		return nil, fmt.Errorf("GetCacheEntry: cache not found")
	}
}

func GetCacheBlock(ctx context.Context, blockId string, name string, cacheNum int) (*CacheBlock, error) {
	if curCacheEntry, found := cache[GetCacheId(blockId, name)]; found {
		curCacheEntry.Lock.Lock()
		defer curCacheEntry.Lock.Unlock()
		if len(curCacheEntry.DataBlocks) < cacheNum+1 {
			for index := len(curCacheEntry.DataBlocks); index < cacheNum+1; index++ {
				curCacheEntry.DataBlocks = append(curCacheEntry.DataBlocks, nil)
			}
		}
		if curCacheEntry.DataBlocks[cacheNum] == nil {
			off := int64(cacheNum) * MaxBlockSize
			cacheData, err := GetCacheFromDB(ctx, blockId, name, off, MaxBlockSize)
			if err != nil {
				return nil, err
			}
			curCacheBlock := &CacheBlock{data: *cacheData, size: len(*cacheData)}
			curCacheEntry.DataBlocks[cacheNum] = curCacheBlock
			return curCacheBlock, nil
		} else {
			return curCacheEntry.DataBlocks[cacheNum], nil
		}
	} else {
		return nil, fmt.Errorf("Cache entry for name: %v not found", name)
	}
}

func Stat(ctx context.Context, blockId string, name string) (*FileInfo, error) {
	cacheEntry, err := GetCacheEntry(ctx, blockId, name)
	if err == nil {
		log.Printf("cacheEntry returning: %v", cacheEntry.Info)
		return &cacheEntry.Info, nil
	}
	fInfo, err := GetFileInfo(ctx, blockId, name)
	if err != nil {
		return nil, err
	}
	curCacheEntry := MakeCacheEntry(*fInfo)
	cache[GetCacheId(blockId, name)] = curCacheEntry
	return fInfo, nil
}

func WriteAt(ctx context.Context, blockId string, name string, p []byte, off int64) (int, error) {
	bytesToWrite := len(p)
	bytesWritten := 0
	curCacheNum := int(math.Floor(float64(off) / float64(MaxBlockSize)))
	numCaches := int(math.Ceil(float64(bytesToWrite) / float64(MaxBlockSize)))
	log.Printf("num caches: %v %v", bytesToWrite, math.Ceil(float64(int64(bytesToWrite)/MaxBlockSize)))
	fInfo, err := Stat(ctx, blockId, name)
	if err != nil {
		return 0, fmt.Errorf("Write At err: %v", err)
	}
	if off > fInfo.Size {
		// left pad 0's
		numLeftPad := off - fInfo.Size
		leftPadBytes := []byte{}
		for index := 0; index < int(numLeftPad); index++ {
			leftPadBytes = append(leftPadBytes, 0)
		}
		b, err := WriteAt(ctx, blockId, name, leftPadBytes, fInfo.Size)
		if err != nil {
			return b, fmt.Errorf("Write At err: %v", err)
		}
		bytesWritten += b
	}
	log.Printf("writeat mk1: %v %v", numCaches, curCacheNum)
	for index := 0; index < numCaches; index++ {
		cacheOffset := off - (int64(curCacheNum) * MaxBlockSize)
		bytesToWriteToCurCache := int(math.Min(float64(bytesToWrite), float64(MaxBlockSize-off)))
		curCacheBlock, err := GetCacheBlock(ctx, blockId, name, index)
		if err != nil {
			return bytesWritten, fmt.Errorf("Error getting cache block: %v", err)
		}
		log.Printf("writeat mk2")
		b, err := WriteToCacheBlock(ctx, blockId, name, curCacheBlock, p, int(cacheOffset), bytesToWriteToCurCache)
		bytesWritten += b
		if err != nil {
			return bytesWritten, fmt.Errorf("Write to cache error: %v", err)
		}
		if len(p) == b {
			break
		}
		p = p[bytesToWriteToCurCache+1:]
	}
	return bytesWritten, nil
}
