package blockstore

import (
	"context"
	"log"
	"testing"
	"time"

	units "github.com/alecthomas/units"

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
	curFileInfo = &curCacheEntry.Info
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
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0)
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
	cacheData, err = GetCacheBlock(ctx, "test-block-id", "file-1", 0)
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
	cacheData, err = GetCacheBlock(ctx, "test-block-id", "file-1", 0)
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
	cacheData, err = GetCacheBlock(ctx, "test-block-id", "file-1", 0)
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
	SimpleAssert(t, bytesWritten == 22, "Correct num bytes written")
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0)
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
		t.Errorf("Write At error: %v", err)
	} else {
		log.Printf("Write at no errors: %v", bytesWritten)
	}
	SimpleAssert(t, bytesWritten == len(testBytesToWrite), "Correct num bytes written")
	cacheData, err := GetCacheBlock(ctx, "test-block-id", "file-1", 0)
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

	var read []byte
	bytesRead, err := ReadAt(ctx, "test-block-id", "file-1", &read, 0)
	if err != nil {
		t.Errorf("Read error: %v", err)
	}
	SimpleAssert(t, bytesRead == bytesWritten, "Correct num bytes read")
	log.Printf("bytes read: %v string: %s", read, string(read))

	read = []byte{}
	bytesRead, err = ReadAt(ctx, "test-block-id", "file-1", &read, 4)
	if err != nil {
		t.Errorf("Read error: %v", err)
	}
	SimpleAssert(t, bytesRead == (11-4), "Correct num bytes read")
	log.Printf("bytes read: %v string: %s", read, string(read))
	Cleanup(t, ctx)
}

func TestFlushCache(t *testing.T) {
	log.Printf("TODO")
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
