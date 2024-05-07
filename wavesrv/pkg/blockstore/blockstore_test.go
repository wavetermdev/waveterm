package blockstore

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"log"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/dbutil"
)

const testOverrideDBName = "test-blockstore.db"
const bigFileSize = 10 * UnitsMB

type TestBlockType struct {
	BlockId string
	Name    string
	Partidx int
	Data    []byte
}

func initTestDb(t *testing.T) {
	log.Printf("initTestDb: %v", t.Name())
	os.Remove(testOverrideDBName)
	overrideDBName = testOverrideDBName
	err := MigrateBlockstore()
	if err != nil {
		t.Fatalf("MigrateBlockstore error: %v", err)
	}
}

func cleanupTestDB(t *testing.T) {
	clearCache()
	CloseDB()
	os.Remove(testOverrideDBName)
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

func TestGetDB(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	GetDBTimeout := 10 * time.Second
	ctx, cancelFn := context.WithTimeout(context.Background(), GetDBTimeout)
	defer cancelFn()
	_, err := GetDB(ctx)
	if err != nil {
		t.Errorf("TestInitDB error: %v", err)
	}
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
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	SetFlushTimeout(2 * time.Minute)
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
}

func TestMultipleChunks(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
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
	initTestDb(t)
	defer cleanupTestDB(t)

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
	curCacheEntry := blockstoreCache[GetCacheId("test-block-id", "file-1")]
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
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	log.Printf("Max Block Size: %v", MaxBlockSize)
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
	if err != nil {
		t.Errorf("Error getting cache: %v", err)
	}
	log.Printf("Cache data received: %v str: %s", cacheData, string(cacheData.data))
	bytesWritten, err := WriteAt(ctx, "test-block-id", "file-1", testBytesToWrite, 0)
	if err != nil {
		t.Errorf("Write At error: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	if bytesWritten != len(testBytesToWrite) {
		t.Errorf("WriteAt error: towrite:%d written:%d err:%v\n", len(testBytesToWrite), bytesWritten, err)
		return
	}
	cacheData, err = GetCacheBlock(ctx, "test-block-id", "file-1", 0, false)
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
}

func TestWriteAtLeftPad(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
	SimpleAssert(t, bytesWritten == 11, "Correct num bytes written")
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
	log.Printf("Got stat: %v %v %v", fInfo, fInfo.Size, len(cacheData.data))
	SimpleAssert(t, int64(len(cacheData.data)) == fInfo.Size, "Correct fInfo size")
}

func TestReadAt(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
}

func TestFlushCache(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
}

var largeDataFlushFullWriteSize int64 = 64 * UnitsKB

func WriteLargeDataFlush(t *testing.T, ctx context.Context) {
	writeSize := int64(64 - 16)
	fullWriteSize := largeDataFlushFullWriteSize
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
	initTestDb(t)
	defer cleanupTestDB(t)

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
}

func TestWriteAtMaxSizeMultipleBlocks(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

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
	SimpleAssert(t, bytesWritten == 4, "Correct num bytes written")
	readTest := []byte{'T', 'E', 'S', 'T'}
	readBuf := make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, (MaxBlockSize*2)-4)
	log.Printf("readbuf multiple: %v %v %v\n", readBuf, bytesRead, bytesWritten)
	SimpleAssert(t, bytesRead == 4, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:4], readTest), "Correct bytes read")
}

func TestWriteAtCircular(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

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
	SimpleAssert(t, bytesWritten == 11, "Correct num bytes written")

	readTest := []byte{'T', 'E', 'S', 'T'}
	readBuf := make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, (MaxBlockSize*2)-4)
	SimpleAssert(t, bytesRead == 11, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:4], readTest), "Correct bytes read")
	SimpleAssert(t, bytes.Equal(readBuf, testBytesToWrite), "Correct bytes read")
	log.Printf("readbuf circular %v %v %v", readBuf, string(readBuf), bytesRead)

	readTest = []byte{'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	readBuf = make([]byte, len(testBytesToWrite))
	bytesRead, err = ReadAt(ctx, "test-block-id", "file-1", &readBuf, 0)
	SimpleAssert(t, bytesRead == 7, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:7], readTest), "Correct bytes read")
	log.Printf("readbuf circular %v %v, %v", readBuf, string(readBuf), bytesRead)
}

func TestWriteAtCircularWierdOffset(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

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
	SimpleAssert(t, bytesWritten == 11, "Correct num bytes written")

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
	SimpleAssert(t, bytesRead == 7, "Correct num bytes read")
	SimpleAssert(t, bytes.Equal(readBuf[:7], readTest), "Correct bytes read")
	log.Printf("readbuf circular %v %v, %v", readBuf, string(readBuf), bytesRead)
}

func TestAppend(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

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
	log.Printf("append mk1\n")
	bytesWritten, err := AppendData(ctx, "test-block-id", "file-1", testAppendBytes1)
	if err != nil {
		t.Errorf("Append Error: %v", err)
	}
	log.Printf("append mk2\n")
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
	initTestDb(t)
	defer cleanupTestDB(t)

	var wg sync.WaitGroup
	numWorkers := 10
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
	initTestDb(t)
	defer cleanupTestDB(t)

	var wg sync.WaitGroup
	numWorkers := 10
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
}

func TestWriteFile(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
	testBytesToWrite := []byte{'T', 'E', 'S', 'T', 'M', 'E', 'S', 'S', 'A', 'G', 'E'}
	bytesWritten, err := WriteFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts, testBytesToWrite)
	if err != nil {
		t.Errorf("write at error: %v", err)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	var read []byte = make([]byte, len(testBytesToWrite))
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &read, 0)
	if err != nil {
		t.Errorf("Read error: %v", err)
	}
	SimpleAssert(t, bytesRead == bytesWritten, "Correct num bytes read")
	log.Printf("bytes read: %v string: %s", read, string(read))
	SimpleAssert(t, bytes.Equal(read, testBytesToWrite), "Correct bytes read")
}

func TestWriteMeta(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	if err != nil {
		t.Fatalf("MakeFile error: %v", err)
	}
	fInfo, err := Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("stat error: %v", err)
	}
	SimpleAssert(t, fInfo.Meta["test-descriptor"] == true, "Retrieved meta correctly")
	fInfo.Meta["second-test-descriptor"] = "test1"
	fInfo, err = Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("stat error: %v", err)
	}
	log.Printf("meta: %v", fInfo.Meta)
	SimpleAssert(t, fInfo.Meta["second-test-descriptor"] != "test1", "Stat returned deep copy")
	fInfo.Meta["second-test-descriptor"] = "test1"
	err = WriteMeta(ctx, "test-block-id", "file-1", fInfo.Meta)
	if err != nil {
		t.Errorf("write meta error: %v", err)
	}
	fInfo, err = Stat(ctx, "test-block-id", "file-1")
	if err != nil {
		t.Errorf("stat error: %v", err)
	}
	log.Printf("meta: %v", fInfo.Meta)
	SimpleAssert(t, fInfo.Meta["second-test-descriptor"] == "test1", "Retrieved second meta correctly")
}

func TestGetAllBlockIds(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	err = MakeFile(ctx, "test-block-id-2", "file-1", fileMeta, fileOpts)
	err = MakeFile(ctx, "test-block-id-2", "file-2", fileMeta, fileOpts)
	err = MakeFile(ctx, "test-block-id-3", "file-2", fileMeta, fileOpts)
	if err != nil {
		t.Errorf("error making file: %v", err)
	}
	blockIds := GetAllBlockIds(ctx)
	log.Printf("blockids: %v", blockIds)
	testBlockIdArr := []string{"test-block-id", "test-block-id-2", "test-block-id-3"}
	for idx, val := range blockIds {
		SimpleAssert(t, testBlockIdArr[idx] == val, "Correct blockid value")
	}
}

func TestListFiles(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
	err := MakeFile(ctx, "test-block-id", "file-1", fileMeta, fileOpts)
	err = MakeFile(ctx, "test-block-id-2", "file-1", fileMeta, fileOpts)
	err = MakeFile(ctx, "test-block-id-2", "file-2", fileMeta, fileOpts)
	err = MakeFile(ctx, "test-block-id-3", "file-2", fileMeta, fileOpts)
	if err != nil {
		t.Errorf("error making file: %v", err)
	}
	files := ListFiles(ctx, "test-block-id-2")
	blockid_2_files := []string{"file-1", "file-2"}
	log.Printf("files: %v", files)
	for idx, val := range files {
		SimpleAssert(t, val.Name == blockid_2_files[idx], "Correct file name")
	}
	blockid_1_files := []string{"file-1"}
	files = ListFiles(ctx, "test-block-id")
	log.Printf("files: %v", files)
	for idx, val := range files {
		SimpleAssert(t, val.Name == blockid_1_files[idx], "Correct file name")
	}
}

func TestFlushTimer(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	testFlushTimeout := 10 * time.Second
	SetFlushTimeout(testFlushTimeout)
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
	time.Sleep(testFlushTimeout)
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
}

func TestWriteAtMiddle(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

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
}

func TestWriteLargeDataFlush(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	ctx := context.Background()
	WriteLargeDataFlush(t, ctx)
}

func TestWriteLargeDataNoFlush(t *testing.T) {
	initTestDb(t)
	defer cleanupTestDB(t)

	writeSize := int64(64 - 16)
	fullWriteSize := int64(64 * UnitsKB)
	ctx := context.Background()
	fileMeta := make(FileMeta)
	fileMeta["test-descriptor"] = true
	fileOpts := FileOptsType{MaxSize: bigFileSize, Circular: false, IJson: false}
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
		if int64(bytesWritten) != writeSize {
			t.Errorf("write issue: %v %v %v err:%v\n", bytesWritten, writeSize, writeIndex, err)
			return
		}
		if err != nil {
			log.Printf("error: %v", err)
			t.Errorf("Write At error: %v\n", err)
			return
		}
		writeIndex += int64(bytesWritten)
	}
	log.Printf("final hash: %v writeBuf: %v bytesWritten: %v", hashBuf, writeBuf, writeIndex)

	readBuf := make([]byte, writeSize)
	readHashBuf := make([]byte, 16)
	readIndex := int64(0)
	for i := 0; i < int(numWrites); i++ {
		bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &readBuf, readIndex)
		/*if int64(bytesRead) != writeSize {
			log.Printf("read issue: %v %v \n", bytesRead, writeSize)
		} */
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
