package blockstore

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"log"
	"sync"
	"testing"
	"time"

	"github.com/alecthomas/units"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
)

type TestBlockType struct {
	BlockId string
	Name    string
	Partidx int
	Data    []byte
}

func (b *TestBlockType) ToMap() map[string]interface{} {
	rtn := make(map[string]interface{})
	return rtn
}

func (b *TestBlockType) FromMap(m map[string]interface{}) bool {
	dbutil.QuickSetStr(&b.BlockId, m, "blockid")
	dbutil.QuickSetStr(&b.Name, m, "name")
	dbutil.QuickSetInt(&b.Partidx, m, "partidx")
	dbutil.QuickSetBytes(&b.Data, m, "data")
	return true
}

func Cleanup(t *testing.T, ctx context.Context) {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_file where blockid = 'test-block-id'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_data where blockid = 'test-block-id'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}

}

func CleanupName(t *testing.T, ctx context.Context, blockId string) {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_file where blockid = ?`
		tx.Exec(query, blockId)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_data where blockid = ?`
		tx.Exec(query, blockId)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}
}

func TestGetDB(t *testing.T) {
	GetDBTimeout := 10 * time.Second
	ctx, _ := context.WithTimeout(context.Background(), GetDBTimeout)
	_, err := GetDB(ctx)
	if err != nil {
		t.Errorf("TestInitDB error: %v", err)
	}
	CloseDB()
}

func SimpleAssert(t *testing.T, condition bool, description string) {
	if !condition {
		t.Errorf("Simple Assert <%s> Failed", description)
	} else {
		log.Printf("Simple Assert <%s> Passed", description)
	}
}

func SimpleFatalAssert(t *testing.T, condition bool, description string) {
	if !condition {
		t.Fatalf("Simple Assert <%s> Failed", description)
	} else {
		log.Printf("Simple Assert <%s> Passed", description)
	}

}

func InsertIntoBlockData(t *testing.T, ctx context.Context, blockId string, name string, partidx int, data []byte) {
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `INSERT into block_data values (?, ?, ?, ?)`
		tx.Exec(query, blockId, name, partidx, data)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error inserting into block_data table: %v", txErr)
	}
}

func TestTx(t *testing.T) {
	ctx := context.Background()
	InitDBState()
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `INSERT into block_data values ('test-block-id', 'test-file-name', 0, 256)`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error inserting into block_data table: %v", txErr)
	}
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `INSERT into block_data values (?, ?, ?, ?)`
		tx.Exec(query, "test-block-id", "test-file-name-2", 1, []byte{110, 200, 50, 45})
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error inserting into block_data table: %v", txErr)
	}
	block_data, txErr := WithTxRtn(ctx, func(tx *TxWrap) ([]*TestBlockType, error) {
		var rtn []*TestBlockType
		query := `SELECT * FROM block_data where blockid = 'test-block-id'`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			rtn = append(rtn, dbutil.FromMap[*TestBlockType](m))
		}
		return rtn, nil
	})
	if txErr != nil {
		t.Errorf("TestTx error getting block data: %v", txErr)
	}
	SimpleAssert(t, len(block_data) == 2, "select-num-entries")
	log.Printf("Block Data: ")
	log.Printf("%v", block_data[0])
	log.Printf("%v", block_data[1])
	SimpleAssert(t, block_data[0].Name == "test-file-name", "first-entry-name-correct")
	SimpleAssert(t, len(block_data[1].Data) == 4, "blob-data-correct-length")
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_data where blockid = 'test-block-id'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}
	CloseDB()
}
func TestMultipleChunks(t *testing.T) {
	ctx := context.Background()
	InitDBState()
	InsertIntoBlockData(t, ctx, "test-block-id", "file-1", 0, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-1", 1, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-1", 2, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-1", 3, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-1", 4, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-2", 0, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-2", 1, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-2", 2, make([]byte, 5))
	InsertIntoBlockData(t, ctx, "test-block-id", "file-2", 3, make([]byte, 5))
	data, txErr := WithTxRtn(ctx, func(tx *TxWrap) ([]*TestBlockType, error) {
		var rtn []*TestBlockType
		query := `SELECT * FROM block_data where name = 'file-1'`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			rtn = append(rtn, dbutil.FromMap[*TestBlockType](m))
		}
		return rtn, nil
	})
	if txErr != nil {
		t.Errorf("TestMultipleChunks error getting chunks from file-1 %v", txErr)
	}
	SimpleAssert(t, len(data) == 5, "file-1 num parts == 5")
	data, txErr = WithTxRtn(ctx, func(tx *TxWrap) ([]*TestBlockType, error) {
		var rtn []*TestBlockType
		query := `SELECT * FROM block_data where name = 'file-2'`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			rtn = append(rtn, dbutil.FromMap[*TestBlockType](m))
		}
		return rtn, nil
	})
	if txErr != nil {
		t.Errorf("TestMultipleChunks error getting chunks from file-2 %v", txErr)
	}
	SimpleAssert(t, len(data) == 4, "file-2 num parts == 4")
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_data where blockid = 'test-block-id'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}
}

func TestMakeFile(t *testing.T) {
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: 0, Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	data, txErr := WithTxRtn(ctx, func(tx *TxWrap) ([]*FileInfo, error) {
		var rtn []*FileInfo
		query := `SELECT * FROM block_file WHERE name = 'file-1'`
		marr := tx.SelectMaps(query)
		for _, m := range marr {
			rtn = append(rtn, dbutil.FromMap[*FileInfo](m))
		}
		return rtn, nil
	})
	if txErr != nil {
		t.Errorf("TestMakeFile err getting file-1 info %v", txErr)
	}
	log.Printf("data: %v", data)
	SimpleAssert(t, len(data) == 1, "no duplicate files")
	curFileInfo := data[0]
	log.Printf("cur file info: %v", curFileInfo)
	SimpleAssert(t, curFileInfo.Name == "file-1", "correct file name")
	SimpleAssert(t, curFileInfo.Meta["test-descriptor"] == true, "meta correct")
	curCacheEntry := cache[GetCacheId("test-block-id", "file-1")]
	curFileInfo = curCacheEntry.Info
	log.Printf("cache entry: %v", curCacheEntry)
	SimpleAssert(t, curFileInfo.Name == "file-1", "cache correct file name")
	SimpleAssert(t, curFileInfo.Meta["test-descriptor"] == true, "cache meta correct")
	txErr = WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_file where blockid = 'test-block-id'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}
}

func TestWriteAt(t *testing.T) {
	InitDBState()
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	log.Printf("Max Block Size: %v", MaxBlockSize)
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 0)
	if err != nil {
		t.Errorf("Write At error: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	SimpleAssert(t, len(cacheData.data) == len(testBytesToWrite), "Correct num bytes received")
	SimpleAssert(t, len(cacheData.data) == cacheData.size, "Correct cache size")
	fInfo, err := Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("Stat Error: %v", err)
	}
	log.Printf("Got stat: %v", fInfo)
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")
	bytesWritten, err = WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, int64(bytesWritten))
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	SimpleAssert(t, len(cacheData.data) == (2*len(testBytesToWrite)), "Correct num bytes received")
	SimpleAssert(t, len(cacheData.data) == cacheData.size, "Correct cache size")
	fInfo, err = Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("Stat Error: %v", err)
	}
	log.Printf("Got stat: %v", fInfo)
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")
	testBytesToWrite = []byte{'B', 'E', 'S', 'T'}
	bytesWritten, err = WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 0)
	if err != nil {
		t.Errorf("Write At error: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	cacheData, err = GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	SimpleAssert(t, len(cacheData.data) == 22, "Correct num bytes received")
	SimpleAssert(t, len(cacheData.data) == cacheData.size, "Correct cache size")
	fInfo, err = Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("Stat Error: %v", err)
	}
	log.Printf("Got stat: %v", fInfo)
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")
	bytesWritten, err = WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 11)
	if err != nil {
		t.Errorf("Write At error: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	cacheData, err = GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	SimpleAssert(t, len(cacheData.data) == 22, "Correct num bytes received")
	SimpleAssert(t, len(cacheData.data) == cacheData.size, "Correct cache size")
	fInfo, err = Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("Stat Error: %v", err)
	}
	log.Printf("Got stat: %v", fInfo)
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")
	txErr := WithTx(ctx, func(tx *TxWrap) error {
		query := `DELETE from block_file where blockid = 'test-block-id'`
		tx.Exec(query)
		return nil
	})
	if txErr != nil {
		t.Errorf("TestTx error deleting test entries: %v", txErr)
	}
}

func TestWriteAtLeftPad(t *testing.T) {
	InitDBState()
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	log.Printf("Max Block Size: %v", MaxBlockSize)
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 11)
	if err != nil {
		t.Errorf("Write At error: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	log.Printf("LEFT PAD bytes written: %v\n", bytesWritten)
	SimpleAssert(t, bytesWritten == 22, "Correct num bytes written")
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	SimpleAssert(t, len(cacheData.data) == 22, "Correct num bytes received")
	SimpleAssert(t, len(cacheData.data) == cacheData.size, "Correct cache size")
	fInfo, err := Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("Stat Error: %v", err)
	}
	log.Printf("Got stat: %v", fInfo)
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")
	Cleanup(t, ctx)
}

func TestReadAt(t *testing.T) {
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	log.Printf("Max Block Size: %v", MaxBlockSize)
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 0)
	if err != nil {
		t.Errorf("Write Aterror: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	SimpleAssert(t, len(cacheData.data) == len(testBytesToWrite), "Correct num bytes received")
	SimpleAssert(t, len(cacheData.data) == cacheData.size, "Correct cache size")
	fInfo, err := Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("Stat Error: %v", err)
	}
	log.Printf("Got stat: %v", fInfo)
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")

	var read []byte = make([]byte, 16)
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &read, 0)
	if err != nil {
		t.Errorf("Read error: %v", err)
	}
	SimpleAssert(t, bytesRead == bytesWritten, "Correct num bytes read")
	log.Printf("bytes read: %v string: %s", read, string(read))

	read = make([]byte, 16)
	bytesRead, err = ReadAt(ctx, "test-block-id", "file-1", &read, 4)
	if err != nil {
		t.Errorf("Read error: %v", err)
	}
	SimpleAssert(t, bytesRead == (11-4), "Correct num bytes read")
	log.Printf("bytes read: %v string: %s", read, string(read))
	Cleanup(t, ctx)
}

func TestFlushCache(t *testing.T) {
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	log.Printf("Max Block Size: %v", MaxBlockSize)
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 0)
	if err != nil {
		t.Errorf("Write At error: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	SimpleAssert(t, len(cacheData.data) == len(testBytesToWrite), "Correct num bytes received")
	SimpleAssert(t, len(cacheData.data) == cacheData.size, "Correct cache size")
	fInfo, err := Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("Stat Error: %v", err)
	}
	log.Printf("Got stat: %v", fInfo)
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")

	FlushCache(ctx)

	var read []byte = make([]byte, 32)
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &read, 0)
	if err != nil {
		t.Errorf("Read error: %v", err)
	}
	SimpleAssert(t, bytesRead == bytesWritten, "Correct num bytes read")
	log.Printf("bytes read: %v string: %s", read, string(read))

	read = make([]byte, 32)
	bytesRead, err = ReadAt(ctx, "test-block-id", "file-1", &read, 4)
	if err != nil {
		t.Errorf("Read error: %v", err)
	}
	SimpleAssert(t, bytesRead == (11-4), "Correct num bytes read")
	log.Printf("bytes read: %v string: %s", read, string(read))
	dbData, txErr := WithTxRtn(ctx, func(tx *TxWrap) ([]byte, error) {
		var cacheData *[]byte = &[]byte{}
		query := `SELECT data from block_data where blockid = 'test-block-id' and name = 'file-1'`
		tx.Get(&cacheData, query)
		return *cacheData, nil
	})
	if txErr != nil {
		t.Errorf("get data from db error: %v", txErr)
	}
	log.Printf("DB Data: %v", dbData)
	Cleanup(t, ctx)
}

var largeDataFlushFullWriteSize int64 = int64(1024 * units.Megabyte)

func WriteLargeDataFlush(t *testing.T, ctx context.Context) {
	writeSize := int64(64 - 16)
	fullWriteSize := largeDataFlushFullWriteSize
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	writeIndex := int64(0)
	writeBuf := make([]byte, writeSize)
	numWrites := fullWriteSize / writeSize
	hashBuf := make([]byte, 16)
	for i := 0; i < int(numWrites); i++ {
		rand.Read(writeBuf)
		hash := md5.New()
		_, err := hash.Write(hashBuf)
		if err != nil {
			t.Errorf("hashing hashbuf error: %v", err)
		}
		_, err = hash.Write(writeBuf)
		if err != nil {
			t.Errorf("hashing writebuf error: %v", err)
		}
		copy(hashBuf, hash.Sum(nil))
		bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", writeBuf, writeIndex)
		if err != nil {
			log.Printf("error: %v", err)
			t.Errorf("Write At error: %v\n", err)
		}
		writeIndex += int64(bytesWritten)
	}
	log.Printf("final hash: %v writeBuf: %v bytesWritten: %v", hashBuf, writeBuf, writeIndex)

	FlushCache(ctx)

	readBuf := make([]byte, writeSize)
	readHashBuf := make([]byte, 16)
	readIndex := int64(0)
	for i := 0; i < int(numWrites); i++ {
		bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, readIndex)
		readIndex += int64(bytesRead)
		hash := md5.New()
		_, err = hash.Write(readHashBuf)
		if err != nil {
			t.Errorf("hashing hashbuf error: %v", err)
		}
		_, err = hash.Write(readBuf)
		if err != nil {
			t.Errorf("hashing readbuf error: %v", err)
		}
		copy(readHashBuf, hash.Sum(nil))
	}
	log.Printf("final hash: %v readBuf: %v, bytesRead: %v", readHashBuf, readBuf, readIndex)
	SimpleAssert(t, bytes.Equal(readHashBuf, hashBuf), "hashes are equal")
}
func TestWriteAtMaxSize(t *testing.T) {
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(4), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 0)
	if err != nil {
		t.Errorf("Write at error: %v", err)
	}
	SimpleAssert(t, bytesWritten == 4, "Correct num bytes written")
	readTest := []byte{'T', 'E', 'S', 'T'}
	readBuf := make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, 0)
	log.Printf("readbuf: %v\n", readBuf)
	SimpleAssert(t, bytesRead == 4, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:4], readTest), "Correct bytes read")
	Cleanup(t, ctx)
}

func TestWriteAtMaxSizeMultipleBlocks(t *testing.T) {
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(MaxBlockSize * 2), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, (MaxBlockSize*2)-4)
	if err != nil {
		t.Errorf("Write at error: %v", err)
	}
	SimpleAssert(t, bytesWritten == int(MaxBlockSize*2), "Correct num bytes written")
	readTest := []byte{'T', 'E', 'S', 'T'}
	readBuf := make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, (MaxBlockSize*2)-4)
	log.Printf("readbuf multiple: %v %v %v\n", readBuf, bytesRead, bytesWritten)
	SimpleAssert(t, bytesRead == 4, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:4], readTest), "Correct bytes read")
	Cleanup(t, ctx)
}

func TestWriteAtCircular(t *testing.T) {
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(MaxBlockSize * 2), Circular: true, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, (MaxBlockSize*2)-4)
	if err != nil {
		t.Errorf("Write at error: %v", err)
	}
	SimpleAssert(t, bytesWritten == int((MaxBlockSize*2)+7), "Correct num bytes written")

	readTest := []byte{'T', 'E', 'S', 'T'}
	readBuf := make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, (MaxBlockSize*2)-4)
	SimpleAssert(t, bytesRead == 11, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:4], readTest), "Correct bytes read")
	SimpleAssert(t, bytes.Equal(readBuf, testBytesToWrite), "Correct bytes read")
	log.Printf("readbuf circular %v %v", readBuf, string(readBuf))

	readTest = []byte{'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	readBuf = make([]byte, len(testBytesToWrite))
	bytesRead, err = ReadAt(ctx, "test-block-id", "file-1", &readBuf, 0)
	SimpleAssert(t, bytesRead == 11, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:7], readTest), "Correct bytes read")
	log.Printf("readbuf circular %v %v, %v", readBuf, string(readBuf), bytesRead)
	Cleanup(t, ctx)
}

func TestWriteAtCircularWierdOffset(t *testing.T) {
	InitDBState()
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileSize := MaxBlockSize*2 - 500
	fileOpts := FileOptsType{MaxSize: int64(fileSize), Circular: true, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	log.Printf("first mk")
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, (fileSize)-4)
	log.Printf("end mk")
	if err != nil {
		t.Errorf("Write at error: %v", err)
	}
	log.Printf("bytes written: %v %v", bytesWritten, int(fileSize+7))
	SimpleAssert(t, bytesWritten == int(fileSize+7), "Correct num bytes written")

	readTest := []byte{'T', 'E', 'S', 'T'}
	readBuf := make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, (fileSize)-4)
	if err != nil {
		t.Errorf("Read at error: %v", err)
	}
	SimpleAssert(t, bytesRead == 11, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:4], readTest), "Correct bytes read")
	SimpleAssert(t, bytes.Equal(readBuf, testBytesToWrite), "Correct bytes read")
	log.Printf("readbuf circular %v %v bytesRead: %v", readBuf, string(readBuf), bytesRead)

	readTest = []byte{'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	readBuf = make([]byte, len(testBytesToWrite))
	bytesRead, err = ReadAt(ctx, "test-block-id", "file-1", &readBuf, 0)
	if err != nil {
		t.Errorf("Read at error: %v", err)
	}
	SimpleAssert(t, bytesRead == 11, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:7], readTest), "Correct bytes read")
	log.Printf("readbuf circular %v %v, %v", readBuf, string(readBuf), bytesRead)
	Cleanup(t, ctx)

}

func TestAppend(t *testing.T) {
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileSize := MaxBlockSize*2 - 500
	fileOpts := FileOptsType{MaxSize: int64(fileSize), Circular: true, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	testAppendBytes1 := []byte{'T', 'E', 'S', 'T'}
	bytesWritten, err := AppendData(ctx, "test-block-id", "file-1", testAppendBytes1)
	if err != nil {
		t.Errorf("Append Error: %v", err)
	}
	SimpleAssert(t, bytesWritten == len(testAppendBytes1), "Correct num bytes written")
	readBuf := make([]byte, len(testAppendBytes1))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, 0)
	log.Printf("read buf : %v", string(readBuf))
	if err != nil {
		t.Errorf("Read Error: %v", err)
	}
	SimpleAssert(t, bytesRead == bytesWritten, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf, testAppendBytes1), "Correct bytes read")
	testAppendBytes2 := []byte{'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err = AppendData(ctx, "test-block-id", "file-1", testAppendBytes2)
	if err != nil {
		t.Errorf("Append Error: %v", err)
	}
	SimpleAssert(t, bytesWritten == len(testAppendBytes2), "Correct num bytes written")
	readTestBytes := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	readBuf = make([]byte, len(readTestBytes))
	bytesRead, err = ReadAt(ctx, "test-block-id", "file-1", &readBuf, 0)
	log.Printf("read buf : %v", string(readBuf))
	if err != nil {
		t.Errorf("Read Error: %v", err)
	}
	SimpleAssert(t, bytesRead == bytesWritten+4, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf, readTestBytes), "Correct bytes read")
	Cleanup(t, ctx)
}

func AppendSyncWorker(t *testing.T, ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	writeBuf := make([]byte, 1)
	rand.Read(writeBuf)
	bytesWritten, err := AppendData(ctx, "test-block-id-sync", "file-1", writeBuf)
	if err != nil {
		t.Errorf("Worker append err: %v", err)
	}
	SimpleAssert(t, bytesWritten == 1, "Correct bytes written")
}
func TestAppendSync(t *testing.T) {
	InitDBState()
	var wg sync.WaitGroup
	numWorkers := 10
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id-sync", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	FlushCache(ctx)
	for index := 0; index < numWorkers; index++ {
		wg.Add(1)
		go AppendSyncWorker(t, ctx, &wg)
	}
	wg.Wait()
	readBuf := make([]byte, numWorkers)
	bytesRead, err := ReadAt(ctx, "test-block-id-sync", "file-1", &readBuf, 0)
	if err != nil {
		t.Errorf("Read Error: %v", err)
	}
	log.Printf("read buf : %v", readBuf)
	SimpleAssert(t, bytesRead == numWorkers, "Correct bytes read")
	CleanupName(t, ctx, "test-block-id-sync")
}

func TestAppendSyncMultiple(t *testing.T) {
	numTests := 100
	for index := 0; index < numTests; index++ {
		TestAppendSync(t)
		log.Printf("finished test: %v", index)
	}
}

func WriteAtSyncWorker(t *testing.T, ctx context.Context, wg *sync.WaitGroup, index int64) {
	defer wg.Done()
	writeBuf := make([]byte, 1)
	rand.Read(writeBuf)
	bytesWritten, err := WriteAt(ctx, "test-block-id-sync", "file-1", writeBuf, index)
	if err != nil {
		t.Errorf("Worker append err: %v", err)
	}
	log.Printf("worker bytes written: %v %v", bytesWritten, index)
	SimpleAssert(t, bytesWritten == 1 || bytesWritten == int(index+1), "Correct bytes written")
}

func TestWriteAtSync(t *testing.T) {
	InitDBState()
	var wg sync.WaitGroup
	numWorkers := 10
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id-sync", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	FlushCache(ctx)
	for index := 0; index < numWorkers; index++ {
		wg.Add(1)
		go WriteAtSyncWorker(t, ctx, &wg, int64(index))
	}
	wg.Wait()
	readBuf := make([]byte, numWorkers)
	bytesRead, err := ReadAt(ctx, "test-block-id-sync", "file-1", &readBuf, 0)
	if err != nil {
		t.Errorf("Read Error: %v", err)
	}
	log.Printf("read buf : %v", readBuf)
	SimpleAssert(t, bytesRead == numWorkers, "Correct num bytes read")
	CleanupName(t, ctx, "test-block-id-sync")
}

func TestWriteAtSyncMultiple(t *testing.T) {
	numTests := 100
	for index := 0; index < numTests; index++ {
		TestWriteAtSync(t)
	}
}

// time consuming tests

func TestWriteAtMiddle(t *testing.T) {
	ctx := context.Background()
	WriteLargeDataFlush(t, ctx)
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	writeOff := MaxBlockSize + 15
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, writeOff)
	if err != nil {
		t.Errorf("Write at error: %v", err)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	FlushCache(ctx)
	readBuf := make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, writeOff)
	log.Printf("readBuf: %v %v", readBuf, string(readBuf))
	SimpleAssert(t, bytesRead == bytesWritten, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf, testBytesToWrite), "read correct bytes")
	Cleanup(t, ctx)
}

func TestWriteLargeDataFlush(t *testing.T) {
	ctx := context.Background()
	WriteLargeDataFlush(t, ctx)
	Cleanup(t, ctx)
}

func TestWriteLargeDataNoFlush(t *testing.T) {
	writeSize := int64(64 - 16)
	fullWriteSize := int64(1024 * units.Megabyte)
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: int64(5 * units.Gigabyte), Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	writeIndex := int64(0)
	writeBuf := make([]byte, writeSize)
	numWrites := fullWriteSize / writeSize
	hashBuf := make([]byte, 16)
	for i := 0; i < int(numWrites); i++ {
		rand.Read(writeBuf)
		hash := md5.New()
		_, err := hash.Write(hashBuf)
		if err != nil {
			t.Errorf("hashing hashbuf error: %v", err)
		}
		_, err = hash.Write(writeBuf)
		if err != nil {
			t.Errorf("hashing writebuf error: %v", err)
		}
		copy(hashBuf, hash.Sum(nil))
		bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", writeBuf, writeIndex)
		if err != nil {
			log.Printf("error: %v", err)
			t.Errorf("Write At error: %v\n", err)
		}
		writeIndex += int64(bytesWritten)
	}
	log.Printf("final hash: %v writeBuf: %v bytesWritten: %v", hashBuf, writeBuf, writeIndex)

	readBuf := make([]byte, writeSize)
	readHashBuf := make([]byte, 16)
	readIndex := int64(0)
	for i := 0; i < int(numWrites); i++ {
		bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, readIndex)
		readIndex += int64(bytesRead)
		hash := md5.New()
		_, err = hash.Write(readHashBuf)
		if err != nil {
			t.Errorf("hashing hashbuf error: %v", err)
		}
		_, err = hash.Write(readBuf)
		if err != nil {
			t.Errorf("hashing readbuf error: %v", err)
		}
		copy(readHashBuf, hash.Sum(nil))
	}
	log.Printf("final hash: %v readBuf: %v, bytesRead: %v", readHashBuf, readBuf, readIndex)
	SimpleAssert(t, bytes.Equal(readHashBuf, hashBuf), "hashes are equal")
	Cleanup(t, ctx)
}

// saving this code for later
/*

	cacheData, txErr := WithTxRtn(ctx, func(tx *TxWrap) ([]byte, error) {
		var cacheData *[]byte
		query := `SELECT data from block_data where blockid = 'test-block-id' and name = 'file-1'`
		log.Printf("mk2")
		tx.Get(&cacheData, query)
		log.Printf("mk3: %v", cacheData)
		return *cacheData, nil
	})
*/
