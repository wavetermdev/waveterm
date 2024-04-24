package blockstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strings"
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
const DefaultFlushTimeout = 1 * time.Second

type CacheEntry struct {
	Lock       *sync.Mutex
	CacheTs    int64
	Info       *FileInfo
	DataBlocks []*CacheBlock
}

type CacheBlock struct {
	data []byte
	size int
}

func MakeCacheEntry(info *FileInfo) *CacheEntry {
	rtn := &CacheEntry{Lock: &sync.Mutex{}, CacheTs: int64(time.Now().UnixMilli()), Info: info, DataBlocks: []*CacheBlock{}}
	return rtn
}

// add ctx context.Context to all these methods
type BlockStore interface {
	MakeFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType) error
	WriteFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType, data []byte) (int, error)
	AppendData(ctx context.Context, blockId string, name string, p []byte) (int, error)
	WriteAt(ctx context.Context, blockId string, name string, p []byte, off int64) (int, error)
	ReadAt(ctx context.Context, blockId string, name string, p *[]byte, off int64) (int, error)
	Stat(ctx context.Context, blockId string, name string) (FileInfo, error)
	CollapseIJson(ctx context.Context, blockId string, name string) error
	WriteMeta(ctx context.Context, blockId string, name string, meta FileMeta) error
	DeleteFile(ctx context.Context, blockId string, name string) error
	DeleteBlock(ctx context.Context, blockId string) error
	ListFiles(ctx context.Context, blockId string) []*FileInfo
	FlushCache(ctx context.Context) error
	GetAllBlockIds(ctx context.Context) []string
}

var cache map[string]*CacheEntry = make(map[string]*CacheEntry)
var globalLock *sync.Mutex = &sync.Mutex{}
var appendLock *sync.Mutex = &sync.Mutex{}
var flushTimeout = DefaultFlushTimeout
var lastWriteTime time.Time

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
	curCacheEntry := MakeCacheEntry(&fileInfo)
	SetCacheEntry(ctx, GetCacheId(blockId, name), curCacheEntry)
	return nil
}

func WriteToCacheBlockNum(ctx context.Context, blockId string, name string, p []byte, pos int, length int, cacheNum int, pullFromDB bool) (int64, int, error) {
	cacheEntry, err := GetCacheEntryOrPopulate(ctx, blockId, name)
	if err != nil {
		return 0, 0, err
	}
	block, err := GetCacheBlock(ctx, blockId, name, cacheNum, pullFromDB)
	cacheEntry.Lock.Lock()
	defer cacheEntry.Lock.Unlock()
	if err != nil {
		return 0, 0, fmt.Errorf("Error getting cache block: %v", err)
	}
	var bytesWritten = 0
	blockLen := len(block.data)
	fileMaxSize := cacheEntry.Info.Opts.MaxSize
	maxWriteSize := fileMaxSize - (int64(cacheNum) * MaxBlockSize)
	numLeftPad := int64(0)
	if pos > blockLen {
		numLeftPad = int64(pos - blockLen)
		leftPadBytes := []byte{}
		for index := 0; index < int(numLeftPad); index++ {
			leftPadBytes = append(leftPadBytes, 0)
		}
		leftPadPos := int64(pos) - numLeftPad
		b, err := WriteToCacheBuf(&block.data, leftPadBytes, int(leftPadPos), int(numLeftPad), maxWriteSize)
		if err != nil {
			return int64(b), b, err
		}
		numLeftPad = int64(b)
		cacheEntry.Info.Size += (int64(cacheNum) * MaxBlockSize)
	}
	b, writeErr := WriteToCacheBuf(&block.data, p, pos, length, maxWriteSize)
	bytesWritten += b
	blockLenDiff := len(block.data) - blockLen
	block.size += blockLenDiff
	cacheEntry.Info.Size += int64(blockLenDiff)
	return numLeftPad, bytesWritten, writeErr
}

func ReadFromCacheBlock(ctx context.Context, blockId string, name string, block *CacheBlock, p *[]byte, pos int, length int, destOffset int, maxRead int64) (int, error) {
	if pos > len(block.data) {
		return 0, fmt.Errorf("Reading past end of cache block, should never happen")
	}
	bytesWritten := 0
	index := pos
	for ; index < length+pos; index++ {
		if int64(index) >= maxRead {
			return index - pos, fmt.Errorf(MaxSizeError)
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
	return blockId + "~SEP~" + name
}

func GetValuesFromCacheId(cacheId string) (blockId string, name string) {
	vals := strings.Split(cacheId, "~SEP~")
	if len(vals) == 2 {
		return vals[0], vals[1]
	} else {
		log.Println("Failure in GetValuesFromCacheId, this should never happen")
		return "", ""
	}
}

func GetCacheEntry(ctx context.Context, blockId string, name string) (*CacheEntry, bool) {
	globalLock.Lock()
	defer globalLock.Unlock()
	if curCacheEntry, found := cache[GetCacheId(blockId, name)]; found {
		return curCacheEntry, true
	} else {
		return nil, false
	}
}

func GetCacheEntryOrPopulate(ctx context.Context, blockId string, name string) (*CacheEntry, error) {
	if cacheEntry, found := GetCacheEntry(ctx, blockId, name); found {
		return cacheEntry, nil
	} else {
		_, err := Stat(ctx, blockId, name)
		if err != nil {
			return nil, err
		}
		if cacheEntry, found := GetCacheEntry(ctx, blockId, name); found {
			return cacheEntry, nil
		} else {
			return nil, fmt.Errorf("Error getting cache entry %v %v", blockId, name)
		}
	}

}

func SetCacheEntry(ctx context.Context, cacheId string, cacheEntry *CacheEntry) {
	globalLock.Lock()
	defer globalLock.Unlock()
	if _, found := cache[cacheId]; found {
		return
	}
	cache[cacheId] = cacheEntry
}

func DeleteCacheEntry(ctx context.Context, blockId string, name string) {
	globalLock.Lock()
	defer globalLock.Unlock()
	delete(cache, GetCacheId(blockId, name))
}

func GetCacheBlock(ctx context.Context, blockId string, name string, cacheNum int, pullFromDB bool) (*CacheBlock, error) {
	curCacheEntry, err := GetCacheEntryOrPopulate(ctx, blockId, name)
	if err != nil {
		return nil, err
	}
	curCacheEntry.Lock.Lock()
	defer curCacheEntry.Lock.Unlock()
	if len(curCacheEntry.DataBlocks) < cacheNum+1 {
		for index := len(curCacheEntry.DataBlocks); index < cacheNum+1; index++ {
			curCacheEntry.DataBlocks = append(curCacheEntry.DataBlocks, nil)
		}
	}
	if curCacheEntry.DataBlocks[cacheNum] == nil {
		var curCacheBlock *CacheBlock
		if pullFromDB {
			cacheData, err := GetCacheFromDB(ctx, blockId, name, 0, MaxBlockSize, int64(cacheNum))
			if err != nil {
				return nil, err
			}
			curCacheBlock = &CacheBlock{data: *cacheData, size: len(*cacheData)}
			curCacheEntry.DataBlocks[cacheNum] = curCacheBlock
		} else {
			curCacheBlock = &CacheBlock{data: []byte{}, size: 0}
			curCacheEntry.DataBlocks[cacheNum] = curCacheBlock
		}
		return curCacheBlock, nil
	} else {
		return curCacheEntry.DataBlocks[cacheNum], nil
	}
}

func DeepCopyFileInfo(fInfo *FileInfo) *FileInfo {
	fInfoMeta := make(FileMeta)
	for k, v := range fInfo.Meta {
		fInfoMeta[k] = v
	}
	fInfoOpts := fInfo.Opts
	fInfoCopy := &FileInfo{BlockId: fInfo.BlockId, Name: fInfo.Name, Size: fInfo.Size, CreatedTs: fInfo.CreatedTs, ModTs: fInfo.ModTs, Opts: fInfoOpts, Meta: fInfoMeta}
	return fInfoCopy
}

func Stat(ctx context.Context, blockId string, name string) (*FileInfo, error) {
	cacheEntry, found := GetCacheEntry(ctx, blockId, name)
	if found {
		return DeepCopyFileInfo(cacheEntry.Info), nil
	}
	curCacheEntry := MakeCacheEntry(nil)
	curCacheEntry.Lock.Lock()
	defer curCacheEntry.Lock.Unlock()
	fInfo, err := GetFileInfo(ctx, blockId, name)
	if err != nil {
		return nil, err
	}
	curCacheEntry.Info = fInfo
	SetCacheEntry(ctx, GetCacheId(blockId, name), curCacheEntry)
	return DeepCopyFileInfo(fInfo), nil
}

func SetFlushTimeout(newTimeout time.Duration) {
	flushTimeout = newTimeout
}

func StartFlushTimer(ctx context.Context) {
	curTime := time.Now()
	writeTimePassed := curTime.UnixNano() - lastWriteTime.UnixNano()
	if writeTimePassed >= int64(flushTimeout) {
		lastWriteTime = curTime
		go func() {
			time.Sleep(flushTimeout)
			FlushCache(ctx)
		}()
	}
}

func WriteAt(ctx context.Context, blockId string, name string, p []byte, off int64) (int, error) {
	return WriteAtHelper(ctx, blockId, name, p, off, true)
}

func WriteAtHelper(ctx context.Context, blockId string, name string, p []byte, off int64, flushCache bool) (int, error) {
	bytesToWrite := len(p)
	bytesWritten := 0
	curCacheNum := int(math.Floor(float64(off) / float64(MaxBlockSize)))
	numCaches := int(math.Ceil(float64(bytesToWrite) / float64(MaxBlockSize)))
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
	for index := curCacheNum; index < curCacheNum+numCaches; index++ {
		cacheOffset := off - (int64(index) * MaxBlockSize)
		bytesToWriteToCurCache := int(math.Min(float64(bytesToWrite), float64(MaxBlockSize-cacheOffset)))
		pullFromDB := true
		if cacheOffset == 0 && int64(bytesToWriteToCurCache) == MaxBlockSize {
			pullFromDB = false
		}
		_, b, err := WriteToCacheBlockNum(ctx, blockId, name, p, int(cacheOffset), bytesToWriteToCurCache, index, pullFromDB)
		bytesWritten += b
		bytesToWrite -= b
		off += int64(b)
		if err != nil {
			if err.Error() == MaxSizeError {
				if fInfo.Opts.Circular {
					p = p[int64(b):]
					b, err := WriteAtHelper(ctx, blockId, name, p, 0, false)
					bytesWritten += b
					if err != nil {
						return bytesWritten, fmt.Errorf("Write to cache error: %v", err)
					}
					break
				}
			} else {
				return bytesWritten, fmt.Errorf("Write to cache error: %v", err)
			}
		}
		if len(p) == b {
			break
		}
		p = p[int64(b):]
	}
	if flushCache {
		StartFlushTimer(ctx)
	}
	return bytesWritten, nil
}

func FlushCache(ctx context.Context) error {
	for _, cacheEntry := range cache {
		err := WriteFileToDB(ctx, *cacheEntry.Info)
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
		curCacheBlock, err := GetCacheBlock(ctx, blockId, name, index, true)
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

func AppendData(ctx context.Context, blockId string, name string, p []byte) (int, error) {
	appendLock.Lock()
	defer appendLock.Unlock()
	fInfo, err := Stat(ctx, blockId, name)
	if err != nil {
		return 0, fmt.Errorf("Append stat error: %v", err)
	}
	return WriteAt(ctx, blockId, name, p, fInfo.Size)
}

func DeleteFile(ctx context.Context, blockId string, name string) error {
	DeleteCacheEntry(ctx, blockId, name)
	err := DeleteFileFromDB(ctx, blockId, name)
	return err
}

func DeleteBlock(ctx context.Context, blockId string) error {
	for cacheId, _ := range cache {
		curBlockId, name := GetValuesFromCacheId(cacheId)
		if curBlockId == blockId {
			err := DeleteFile(ctx, blockId, name)
			if err != nil {
				return fmt.Errorf("Error deleting %v %v: %v", blockId, name, err)
			}
		}
	}
	err := DeleteBlockFromDB(ctx, blockId)
	return err
}

func WriteFile(ctx context.Context, blockId string, name string, meta FileMeta, opts FileOptsType, data []byte) (int, error) {
	MakeFile(ctx, blockId, name, meta, opts)
	return AppendData(ctx, blockId, name, data)
}

func WriteMeta(ctx context.Context, blockId string, name string, meta FileMeta) error {
	_, err := Stat(ctx, blockId, name)
	// stat so that we can make sure cache entry is popuplated
	if err != nil {
		return err
	}
	cacheEntry, found := GetCacheEntry(ctx, blockId, name)
	if !found {
		return fmt.Errorf("WriteAt error: cache entry not found")
	}
	cacheEntry.Lock.Lock()
	defer cacheEntry.Lock.Unlock()
	cacheEntry.Info.Meta = meta
	return nil
}

func ListFiles(ctx context.Context, blockId string) []*FileInfo {
	fInfoArr, err := GetAllFilesInDBForBlockId(ctx, blockId)
	if err != nil {
		return nil
	}
	return fInfoArr
}

func ListAllFiles(ctx context.Context) []*FileInfo {
	fInfoArr, err := GetAllFilesInDB(ctx)
	if err != nil {
		return nil
	}
	return fInfoArr
}

func GetAllBlockIds(ctx context.Context) []string {
	rtn, err := GetAllBlockIdsInDB(ctx)
	if err != nil {
		return nil
	}
	return rtn
}
