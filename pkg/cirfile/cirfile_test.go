package cirfile

import (
	"context"
	"fmt"
	"os"
	"path"
	"syscall"
	"testing"
	"time"
)

func validateFileSize(t *testing.T, name string, size int) {
	finfo, err := os.Stat(name)
	if err != nil {
		t.Fatalf("error stating file[%s]: %v", name, err)
	}
	if int(finfo.Size()) != size {
		t.Fatalf("invalid file[%s] expected[%d] got[%d]", name, size, finfo.Size())
	}
}

func validateMeta(t *testing.T, desc string, f *File, startPos int64, endPos int64, dataSize int64, offset int64) {
	if f.StartPos != startPos || f.EndPos != endPos || f.FileDataSize != dataSize || f.FileOffset != offset {
		t.Fatalf("metadata error (%s): startpos[%d %d] endpos[%d %d] filedatasize[%d %d] fileoffset[%d %d]", desc, f.StartPos, startPos, f.EndPos, endPos, f.FileDataSize, dataSize, f.FileOffset, offset)
	}
}

func dumpFile(name string) {
	barr, _ := os.ReadFile(name)
	fmt.Printf("<<<\n%s\n>>>", string(barr))
}

func makeData(size int) string {
	var rtn string
	for {
		if len(rtn) >= size {
			break
		}
		needed := size - len(rtn)
		if needed < 10 {
			rtn += "123456789\n"[0:needed]
			break
		}
		rtn += "123456789\n"
	}
	return rtn
}

func TestCreate(t *testing.T) {
	tempDir := t.TempDir()
	f1Name := path.Join(tempDir, "f1.cf")
	f, err := OpenCirFile(f1Name)
	if err == nil || f != nil {
		t.Fatalf("OpenCirFile f1.cf should fail (no file)")
	}
	f, err = CreateCirFile(f1Name, 100)
	if err != nil {
		t.Fatalf("CreateCirFile f1.cf failed: %v", err)
	}
	if f == nil {
		t.Fatalf("CreateCirFile f1.cf returned nil")
	}
	err = f.ReadMeta(context.Background())
	if err != nil {
		t.Fatalf("cannot readmeta from f1.cf: %v", err)
	}
	validateFileSize(t, f1Name, 256)
	if f.Version != CurrentVersion || f.MaxSize != 100 || f.FileOffset != 0 || f.StartPos != FilePosEmpty || f.EndPos != 0 || f.FileDataSize != 0 || f.FlockStatus != 0 {
		t.Fatalf("error with initial metadata #%v", f)
	}
	buf := make([]byte, 200)
	realOffset, nr, err := f.ReadNext(context.Background(), buf, 0)
	if realOffset != 0 || nr != 0 || err != nil {
		t.Fatalf("error with empty read: real-offset[%d] nr[%d] err[%v]", realOffset, nr, err)
	}
	realOffset, nr, err = f.ReadNext(context.Background(), buf, 1000)
	if realOffset != 0 || nr != 0 || err != nil {
		t.Fatalf("error with empty read: real-offset[%d] nr[%d] err[%v]", realOffset, nr, err)
	}
	f2, err := CreateCirFile(f1Name, 100)
	if err == nil || f2 != nil {
		t.Fatalf("should be an error to create duplicate CirFile")
	}
}

func TestFile(t *testing.T) {
	tempDir := t.TempDir()
	f1Name := path.Join(tempDir, "f1.cf")
	f, err := CreateCirFile(f1Name, 100)
	if err != nil {
		t.Fatalf("cannot create cirfile: %v", err)
	}
	err = f.AppendData(context.Background(), nil)
	if err != nil {
		t.Fatalf("cannot append data: %v", err)
	}
	validateFileSize(t, f1Name, HeaderLen)
	if f.StartPos != FilePosEmpty || f.EndPos != 0 || f.FileDataSize != 0 {
		t.Fatalf("metadata error (1): %#v", f)
	}
	err = f.AppendData(context.Background(), []byte("hello"))
	if err != nil {
		t.Fatalf("cannot append data: %v", err)
	}
	validateFileSize(t, f1Name, HeaderLen+5)
	if f.StartPos != 0 || f.EndPos != 4 || f.FileDataSize != 5 {
		t.Fatalf("metadata error (2): %#v", f)
	}
	err = f.AppendData(context.Background(), []byte(" foo"))
	if err != nil {
		t.Fatalf("cannot append data: %v", err)
	}
	validateFileSize(t, f1Name, HeaderLen+9)
	validateMeta(t, "3", f, 0, 8, 9, 0)
	err = f.AppendData(context.Background(), []byte("\n"+makeData(20)))
	if err != nil {
		t.Fatalf("cannot append data: %v", err)
	}
	validateFileSize(t, f1Name, HeaderLen+30)
	validateMeta(t, "4", f, 0, 29, 30, 0)

	data120 := makeData(120)
	err = f.AppendData(context.Background(), []byte(data120))
	if err != nil {
		t.Fatalf("cannot append data: %v", err)
	}
	validateFileSize(t, f1Name, HeaderLen+100)
	validateMeta(t, "5", f, 0, 99, 100, 50)
	err = f.AppendData(context.Background(), []byte("foo "))
	if err != nil {
		t.Fatalf("cannot append data: %v", err)
	}
	validateFileSize(t, f1Name, HeaderLen+100)
	validateMeta(t, "6", f, 4, 3, 100, 54)

	buf := make([]byte, 5)
	realOffset, nr, err := f.ReadNext(context.Background(), buf, 0)
	if err != nil {
		t.Fatalf("cannot ReadNext: %v", err)
	}
	if realOffset != 54 {
		t.Fatalf("wrong realoffset got[%d] expected[%d]", realOffset, 54)
	}
	if nr != 5 {
		t.Fatalf("wrong nr got[%d] expected[%d]", nr, 5)
	}
	if string(buf[0:nr]) != "56789" {
		t.Fatalf("wrong buf return got[%s] expected[%s]", string(buf[0:nr]), "56789")
	}
	realOffset, nr, err = f.ReadNext(context.Background(), buf, 60)
	if err != nil {
		t.Fatalf("cannot readnext: %v", err)
	}
	if realOffset != 60 && nr != 5 {
		t.Fatalf("invalid rtn realoffset[%d] nr[%d]", realOffset, nr)
	}
	if string(buf[0:nr]) != "12345" {
		t.Fatalf("invalid rtn buf[%s]", string(buf[0:nr]))
	}
	realOffset, nr, err = f.ReadNext(context.Background(), buf, 800)
	if err != nil || realOffset != 154 || nr != 0 {
		t.Fatalf("invalid past end read: err[%v] realoffset[%d] nr[%d]", err, realOffset, nr)
	}
	realOffset, nr, err = f.ReadNext(context.Background(), buf, 150)
	if err != nil || realOffset != 150 || nr != 4 || string(buf[0:nr]) != "foo " {
		t.Fatalf("invalid end read: err[%v] realoffset[%d] nr[%d] buf[%s]", err, realOffset, nr, string(buf[0:nr]))
	}
}

func TestFlock(t *testing.T) {
	tempDir := t.TempDir()
	f1Name := path.Join(tempDir, "f1.cf")
	f, err := CreateCirFile(f1Name, 100)
	if err != nil {
		t.Fatalf("cannot create cirfile: %v", err)
	}
	fd2, err := os.OpenFile(f1Name, os.O_RDWR, 0777)
	if err != nil {
		t.Fatalf("cannot open file: %v", err)
	}
	err = syscall.Flock(int(fd2.Fd()), syscall.LOCK_EX)
	if err != nil {
		t.Fatalf("cannot lock fd: %v", err)
	}
	err = f.AppendData(nil, []byte("hello"))
	if err != syscall.EWOULDBLOCK {
		t.Fatalf("append should fail with EWOULDBLOCK")
	}
	timeoutCtx, _ := context.WithTimeout(context.Background(), 20*time.Millisecond)
	startTs := time.Now()
	err = f.ReadMeta(timeoutCtx)
	if err != context.DeadlineExceeded {
		t.Fatalf("readmeta should fail with context.DeadlineExceeded")
	}
	dur := time.Now().Sub(startTs)
	if dur < 20*time.Millisecond {
		t.Fatalf("readmeta should take at least 20ms")
	}
	syscall.Flock(int(fd2.Fd()), syscall.LOCK_UN)
	err = f.ReadMeta(timeoutCtx)
	if err != nil {
		t.Fatalf("readmeta err: %v", err)
	}
	err = syscall.Flock(int(fd2.Fd()), syscall.LOCK_SH)
	if err != nil {
		t.Fatalf("cannot flock: %v", err)
	}
	err = f.AppendData(nil, []byte("hello"))
	if err != syscall.EWOULDBLOCK {
		t.Fatalf("append should fail with EWOULDBLOCK")
	}
	err = f.ReadMeta(timeoutCtx)
	if err != nil {
		t.Fatalf("readmeta err (should work because LOCK_SH): %v", err)
	}
	fd2.Close()
	err = f.AppendData(nil, []byte("hello"))
	if err != nil {
		t.Fatalf("append error (should work fd2 was closed): %v", err)
	}
}
