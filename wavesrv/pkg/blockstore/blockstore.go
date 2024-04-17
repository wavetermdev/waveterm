package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/alecthomas/units"
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

func InsertFileIntoDB(ctx context.Context, fileInfo FileInfo) error {
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

func WriteFileToDB(ctx context.Context, fileInfo FileInfo) error {
	metaJson, err := json.Marshal(fileInfo.Meta)
	if err != nil {
		return fmt.Errorf("Error writing file %s to db: %v", fileInfo.Name, err)
	}
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `UPDATE block_file SET blockid = ?, name = ?, maxsize = ?, circular = ?, size = ?, createdts = ?, modts = ?, meta = ? where blockid = ? and name = ?`
		tx.Exec(query, fileInfo.BlockId, fileInfo.Name, fileInfo.Opts.MaxSize, fileInfo.Opts.Circular, fileInfo.Size, fileInfo.CreatedTs, fileInfo.ModTs, metaJson, fileInfo.BlockId, fileInfo.Name)
		return nil
	})
	if txErr != nil {
		return fmt.Errorf("Error writing file %s to db: %v", fileInfo.Name, txErr)
	}
	return nil

}

func WriteDataBlockToDB(ctx context.Context, blockId string, name string, index int, data []byte) error {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `REPLACE INTO block_data values (?, ?, ?, ?) ` //ON CONFLICT (blockid, name) DO UPDATE SET blockid = ?, name = ?, partidx = ?, data = ?`
		tx.Exec(query, blockId, name, index, data)
		return nil
	})
	if txErr != nil {
		return fmt.Errorf("Error writing data block to db: %v", txErr)
	}
	return nil
}

func MakeFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType) error {
	curTs := time.Now().UnixMilli()
	fileInfo := FileInfo{BlockId: blockId, Name: name, Size: 0, CreatedTs: curTs, ModTs: curTs, Opts: opts, Meta: meta}
	err := InsertFileIntoDB(ctx, fileInfo)
	if err != nil {
		return err
	}
	curCacheEntry := MakeCacheEntry(fileInfo)
	cache[GetCacheId(blockId, name)] = curCacheEntry
	return nil
}

func WriteToCacheBlock(ctx context.Context, blockId string, name string, block *CacheBlock, p []byte, pos int, length int, cacheNum int) (int, error) {
	cacheEntry, getErr := GetCacheEntry(ctx, blockId, name)
	if getErr != nil {
		return 0, getErr
	}
	cacheEntry.Lock.Lock()
	defer cacheEntry.Lock.Unlock()
	blockLen := len(block.data)
	fileMaxSize := cacheEntry.Info.Opts.MaxSize
	maxWriteSize := fileMaxSize - (int64(cacheNum) * MaxBlockSize)
	bytesWritten, writeErr := WriteToCacheBuf(&block.data, p, pos, length, maxWriteSize)
	blockLenDiff := len(block.data) - blockLen
	block.size += blockLenDiff
	cacheEntry.Info.Size += int64(blockLenDiff)
	return bytesWritten, writeErr
}

func ReadFromCacheBlock(ctx context.Context, blockId string, name string, block *CacheBlock, p *[]byte, pos int, length int, destOffset int, maxRead int64) (int, error) {
	if pos > len(block.data) {
		return 0, fmt.Errorf("Reading past end of cache block, should never happen")
	}
	bytesWritten := 0
	index := pos
	for ; index < length+pos; index++ {
		if int64(index) >= maxRead {
			return index, fmt.Errorf(MaxSizeError)
		}
		if index >= len(block.data) {
			return bytesWritten, nil
		}
		destIndex := index - pos + destOffset
		if destIndex >= len(*p) {
			return bytesWritten, nil
		}
		(*p)[destIndex] = block.data[index]
		bytesWritten++
	}
	if int64(index) >= maxRead {
		return bytesWritten, fmt.Errorf(MaxSizeError)
	}
	return bytesWritten, nil
}

const MaxSizeError = "Hit Max Size"

func WriteToCacheBuf(buf *[]byte, p []byte, pos int, length int, maxWrite int64) (int, error) {
	bytesToWrite := length
	if pos > len(*buf) {
		return 0, fmt.Errorf("writing to a position (%v) in the cache that doesn't exist yet, something went wrong", pos)
	}
	if int64(pos+bytesToWrite) > MaxBlockSize {
		return 0, fmt.Errorf("writing more bytes than max block size, not allowed - length of bytes to write: %v, length of cache: %v", bytesToWrite, len(*buf))
	}
	for index := pos; index < bytesToWrite+pos; index++ {
		if index-pos >= len(p) {
			return len(p), nil
		}
		if int64(index) >= maxWrite {
			return index - pos, fmt.Errorf(MaxSizeError)
		}
		curByte := p[index-pos]
		if len(*buf) == index {
			*buf = append(*buf, curByte)
		} else {
			(*buf)[index] = curByte
		}
	}
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
			cacheData, err := GetCacheFromDB(ctx, blockId, name, 0, MaxBlockSize, int64(cacheNum))
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
	var numLeftPad int64 = 0
	cacheOffset := off - (int64(curCacheNum) * MaxBlockSize)
	if (cacheOffset + int64(bytesToWrite)) > MaxBlockSize {
		numCaches += 1
	}
	fInfo, err := Stat(ctx, blockId, name)
	if err != nil {
		return 0, fmt.Errorf("Write At err: %v", err)
	}
	if off > fInfo.Opts.MaxSize && fInfo.Opts.Circular {
		numOver := off / fInfo.Opts.MaxSize
		off = off - (numOver * fInfo.Opts.MaxSize)
	}
	if off > fInfo.Size {
		// left pad 0's
		numLeftPad = off - fInfo.Size
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
	for index := curCacheNum; index < curCacheNum+numCaches; index++ {
		cacheOffset := off - (int64(index) * MaxBlockSize)
		bytesToWriteToCurCache := int(math.Min(float64(bytesToWrite), float64(MaxBlockSize-cacheOffset)))
		curCacheBlock, err := GetCacheBlock(ctx, blockId, name, index)
		if err != nil {
			return bytesWritten, fmt.Errorf("Error getting cache block: %v", err)
		}
		b, err := WriteToCacheBlock(ctx, blockId, name, curCacheBlock, p, int(cacheOffset), bytesToWriteToCurCache, index)
		bytesWritten += b
		bytesToWrite -= b
		off += int64(b)
		if err != nil && err.Error() == MaxSizeError {
			if fInfo.Opts.Circular {
				p = p[int64(b):]
				b, err := WriteAt(ctx, blockId, name, p, 0)
				bytesWritten += b
				if err != nil {
					return bytesWritten, fmt.Errorf("Write to cache error: %v", err)
				}
				break
			}
			err = nil
		}
		if err != nil {
			return bytesWritten, fmt.Errorf("Write to cache error: %v", err)
		}
		if len(p) == b {
			break
		}
		p = p[b:]
	}
	return bytesWritten, nil
}

func FlushCache(ctx context.Context) error {
	for _, cacheEntry := range cache {
		err := WriteFileToDB(ctx, cacheEntry.Info)
		if err != nil {
			return err
		}
		for index, block := range cacheEntry.DataBlocks {
			if block == nil || block.size == 0 {
				continue
			}
			err := WriteDataBlockToDB(ctx, cacheEntry.Info.BlockId, cacheEntry.Info.Name, index, block.data)
			if err != nil {
				return err
			}
		}
	}
	cache = make(map[string]*CacheEntry)
	return nil
}

// TODO, how does the cache handle race conditions with the read? If we are caching writes every second and the front end writes to the line, we would oveerrite it unless we read first
// we would need a tcp like protocol if we need to do both reads and writes

func ReadAt(ctx context.Context, blockId string, name string, p *[]byte, off int64) (int, error) {
	bytesRead := 0
	fInfo, err := Stat(ctx, blockId, name)
	if err != nil {
		return 0, fmt.Errorf("Read At err: %v", err)
	}
	if off > fInfo.Opts.MaxSize && fInfo.Opts.Circular {
		numOver := off / fInfo.Opts.MaxSize
		off = off - (numOver * fInfo.Opts.MaxSize)
	}
	if off > fInfo.Size {
		return 0, fmt.Errorf("Read At error: tried to read past the end of the file")
	}
	endReadPos := math.Min(float64(int64(len(*p))+off), float64(fInfo.Size))
	bytesToRead := int64(endReadPos) - off
	curCacheNum := int(math.Floor(float64(off) / float64(MaxBlockSize)))
	numCaches := int(math.Ceil(float64(bytesToRead) / float64(MaxBlockSize)))
	cacheOffset := off - (int64(curCacheNum) * MaxBlockSize)
	if (cacheOffset + int64(bytesToRead)) > MaxBlockSize {
		numCaches += 1
	}
	for index := curCacheNum; index < curCacheNum+numCaches; index++ {
		curCacheBlock, err := GetCacheBlock(ctx, blockId, name, index)
		if err != nil {
			return bytesRead, fmt.Errorf("Error getting cache block: %v", err)
		}
		cacheOffset := off - (int64(index) * MaxBlockSize)
		bytesToReadFromCurCache := int(math.Min(float64(bytesToRead), float64(MaxBlockSize-cacheOffset)))
		fileMaxSize := fInfo.Opts.MaxSize
		maxReadSize := fileMaxSize - (int64(index) * MaxBlockSize)
		b, err := ReadFromCacheBlock(ctx, blockId, name, curCacheBlock, p, int(cacheOffset), bytesToReadFromCurCache, bytesRead, maxReadSize)
		bytesRead += b
		bytesToRead -= int64(b)
		off += int64(b)

		if err != nil {
			if err.Error() == MaxSizeError {
				if fInfo.Opts.Circular {
					off = 0
					newP := (*p)[b:]
					b, err := ReadAt(ctx, blockId, name, &newP, off)
					bytesRead += b
					if err != nil {
						return bytesRead, err
					}
					break
				}
			} else {
				return bytesRead, fmt.Errorf("Read from cache error: %v", err)
			}
		}
	}
	return bytesRead, nil
}
