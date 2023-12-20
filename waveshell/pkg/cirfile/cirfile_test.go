// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cirfile

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
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
	str := string(barr)
	str = strings.ReplaceAll(str, "\x00", ".")
	fmt.Printf("%s<<<\n%s\n>>>\n", name, str)
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

func testFilePath(t *testing.T, name string) string {
	tempDir := t.TempDir()
	return filepath.Join(tempDir, name)
}

func createTestFile(t *testing.T, name string) (*File, string, error) {
	fPath := testFilePath(t, name)
	f, err := CreateCirFile(fPath, 100)
	if err != nil {
		return nil, fPath, err
	}
	return f, fPath, nil
}

func TestCreate(t *testing.T) {
	const fName = "f1.cf"
	fPath := testFilePath(t, fName)
	f, err := OpenCirFile(fPath)
	if err == nil || f != nil {
		t.Fatalf("OpenCirFile %s should fail (no file)", fPath)
	}
	f, err = CreateCirFile(fPath, 100)
	if err != nil {
		t.Fatalf("CreateCirFile %s failed: %v", fPath, err)
	}
	if f == nil {
		t.Fatalf("CreateCirFile %s returned nil", fPath)
	}
	err = f.ReadMeta(context.Background())
	if err != nil {
		t.Fatalf("cannot readmeta from %s: %v", fPath, err)
	}
	validateFileSize(t, fPath, 256)
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
	f2, err := CreateCirFile(fPath, 100)
	if err == nil || f2 != nil {
		t.Fatalf("should be an error to create duplicate CirFile")
	}
}

const cannotAppendData = "cannot append data: %v"
const cannotReadNext = "cannot readnext: %v"
const cannotCreateCirFile = "cannot create cirfile [%s]: %v"

func TestFile(t *testing.T) {
	const fName = "f1.cf"
	f, fPath, err := createTestFile(t, fName)
	if err != nil {
		t.Fatalf(cannotCreateCirFile, fPath, err)
	}
	err = f.AppendData(context.Background(), nil)
	if err != nil {
		t.Fatalf(cannotAppendData, err)
	}
	validateFileSize(t, fPath, HeaderLen)
	validateMeta(t, "1", f, FilePosEmpty, 0, 0, 0)
	err = f.AppendData(context.Background(), []byte("hello"))
	if err != nil {
		t.Fatalf(cannotAppendData, err)
	}
	validateFileSize(t, fPath, HeaderLen+5)
	validateMeta(t, "2", f, 0, 4, 5, 0)
	err = f.AppendData(context.Background(), []byte(" foo"))
	if err != nil {
		t.Fatalf(cannotAppendData, err)
	}
	validateFileSize(t, fPath, HeaderLen+9)
	validateMeta(t, "3", f, 0, 8, 9, 0)
	err = f.AppendData(context.Background(), []byte("\n"+makeData(20)))
	if err != nil {
		t.Fatalf(cannotAppendData, err)
	}
	validateFileSize(t, fPath, HeaderLen+30)
	validateMeta(t, "4", f, 0, 29, 30, 0)

	data120 := makeData(120)
	err = f.AppendData(context.Background(), []byte(data120))
	if err != nil {
		t.Fatalf(cannotAppendData, err)
	}
	validateFileSize(t, fPath, HeaderLen+100)
	validateMeta(t, "5", f, 0, 99, 100, 50)
	err = f.AppendData(context.Background(), []byte("foo "))
	if err != nil {
		t.Fatalf(cannotAppendData, err)
	}
	validateFileSize(t, fPath, HeaderLen+100)
	validateMeta(t, "6", f, 4, 3, 100, 54)

	buf := make([]byte, 5)
	realOffset, nr, err := f.ReadNext(context.Background(), buf, 0)
	if err != nil {
		t.Fatalf(cannotReadNext, err)
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
		t.Fatalf(cannotReadNext, err)
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
	const fName = "f1.cf"
	f, fPath, err := createTestFile(t, fName)
	if err != nil {
		t.Fatalf(cannotCreateCirFile, fPath, err)
	}
	fd2, err := os.OpenFile(fPath, os.O_RDWR, 0777)
	if err != nil {
		t.Fatalf("cannot open file: %v", err)
	}
	err = syscall.Flock(int(fd2.Fd()), syscall.LOCK_EX)
	if err != nil {
		t.Fatalf("cannot lock fd: %v", err)
	}
	err = f.AppendData(context.TODO(), []byte("hello"))
	if err != syscall.EWOULDBLOCK {
		t.Fatalf("append should fail with EWOULDBLOCK")
	}
	timeoutCtx, cancelFn := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancelFn()
	startTs := time.Now()
	err = f.ReadMeta(timeoutCtx)
	if err != context.DeadlineExceeded {
		t.Fatalf("readmeta should fail with context.DeadlineExceeded")
	}
	dur := time.Since(startTs)
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
	err = f.AppendData(context.TODO(), []byte("hello"))
	if err != syscall.EWOULDBLOCK {
		t.Fatalf("append should fail with EWOULDBLOCK")
	}
	err = f.ReadMeta(timeoutCtx)
	if err != nil {
		t.Fatalf("readmeta err (should work because LOCK_SH): %v", err)
	}
	fd2.Close()
	err = f.AppendData(context.TODO(), []byte("hello"))
	if err != nil {
		t.Fatalf("append error (should work fd2 was closed): %v", err)
	}
}

const writeAtError = "writeat error: %v"

func TestWriteAt(t *testing.T) {
	const fName = "f1.cf"
	f, fPath, err := createTestFile(t, fName)
	if err != nil {
		t.Fatalf("cannot create cirfile: %v", err)
	}
	err = f.WriteAt(context.TODO(), []byte("hello\nmike"), 4)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	err = f.WriteAt(context.TODO(), []byte("t"), 2)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	err = f.WriteAt(context.TODO(), []byte("more"), 30)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	err = f.WriteAt(context.TODO(), []byte("\n"), 19)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	dumpFile(fPath)
	err = f.WriteAt(context.TODO(), []byte("hello"), 200)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	buf := make([]byte, 10)
	realOffset, nr, err := f.ReadNext(context.Background(), buf, 200)
	if err != nil || realOffset != 200 || nr != 5 || string(buf[0:nr]) != "hello" {
		t.Fatalf("invalid readnext: err[%v] realoffset[%d] nr[%d] buf[%s]", err, realOffset, nr, string(buf[0:nr]))
	}
	err = f.WriteAt(context.TODO(), []byte("0123456789\n"), 100)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	dumpFile(fPath)
	dataStr := makeData(200)
	err = f.WriteAt(context.TODO(), []byte(dataStr), 50)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	dumpFile(fPath)

	dataStr = makeData(1000)
	err = f.WriteAt(context.TODO(), []byte(dataStr), 1002)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	err = f.WriteAt(context.TODO(), []byte("hello\n"), 2010)
	if err != nil {
		t.Fatalf(writeAtError, err)
	}
	err = f.AppendData(context.TODO(), []byte("foo\n"))
	if err != nil {
		t.Fatalf("appenddata error: %v", err)
	}
	dumpFile(fPath)
}

func testOpenCirFile(t *testing.T, fileName string, shouldError bool) {
	f, err := OpenCirFile(fileName)
	if shouldError {
		if err == nil {
			t.Fatalf("should be an error opening file[%s]", fileName)
		}
		return
	}
	if err != nil {
		t.Fatalf("unexpected error opening file[%s]: %v", fileName, err)
	}
	if f == nil {
		t.Fatalf("nil file returned")
	}
}

func testValidateCirFilePath(t *testing.T, fileName string, shouldError bool) {
	err := ValidateCirFilePath(fileName)
	if shouldError {
		if err == nil {
			t.Fatalf("should be an error validating cirfile path[%s]", fileName)
		}
		return
	}
	if err != nil {
		t.Fatalf("unexpected error validating cirfile path[%s]: %v", fileName, err)
	}
}

// Get the wave home dir, creating the env var if necessary
func getWaveHomeDir(t *testing.T) string {
	// Test whether we can open a file in the wave home dir
	waveHomeDir := scbase.GetWaveHomeDir()
	// this could happen on test agents
	if waveHomeDir == "" {
		userHomeDir, err := os.UserHomeDir()
		if err != nil {
			t.Fatalf("cannot get user home dir as fallback for missing waveHomeDir env var: %v", err)
		}
		os.Setenv(scbase.WaveHomeVarName, userHomeDir)
		t.Cleanup(func() {
			os.Unsetenv(scbase.WaveHomeVarName)
		})
	}
	return waveHomeDir
}

func TestValidateCirFilePath(t *testing.T) {
	testValidateCirFilePath(t, "testdata/invalid.cf", true)
	testValidateCirFilePath(t, "testdata/invalid", true)
	testValidateCirFilePath(t, "", true)
	testValidateCirFilePath(t, "invalid.cf", true)

	tempDir := t.TempDir()
	testValidateCirFilePath(t, filepath.Join(tempDir, "no-such-file"), true)
	testValidateCirFilePath(t, filepath.Join(tempDir, "should-succeed.cf"), false)
	testValidateCirFilePath(t, filepath.Join(tempDir, "should-succeed.ptyout.cf"), false)
	testValidateCirFilePath(t, filepath.Join(tempDir, "should-fail.x.ptyout.cf"), true)

	waveHomeDir := getWaveHomeDir(t)
	testValidateCirFilePath(t, filepath.Join(waveHomeDir, "no-such-file"), true)
	testValidateCirFilePath(t, filepath.Join(waveHomeDir, "should-succeed.cf"), false)
	testValidateCirFilePath(t, filepath.Join(tempDir, "should-succeed.ptyout.cf"), false)
	testValidateCirFilePath(t, filepath.Join(tempDir, "should-fail.x.ptyout.cf"), true)

}

func TestOpenCirFile(t *testing.T) {
	const noSuchFile = "no such file"
	testOpenCirFile(t, noSuchFile, true)
	testOpenCirFile(t, "testdata/empty.cf", true)
	testOpenCirFile(t, "", true)
	testOpenCirFile(t, "invalid.cf", true)

	// Test whether we can open a file in the temp dir
	testOpenCirFile(t, filepath.Join(os.TempDir(), noSuchFile), true)
	_, fPath, err := createTestFile(t, "f1.cf")
	if err != nil {
		t.Fatalf(cannotCreateCirFile, fPath, err)
	}
	testOpenCirFile(t, fPath, false)

	// Test whether we can open a file in the wave home dir
	waveHomeDir := getWaveHomeDir(t)
	waveHomeCirFileUuid := uuid.New().String()
	waveHomeCirFilePath := filepath.Join(waveHomeDir, waveHomeCirFileUuid+".cf")
	t.Cleanup(func() {
		os.Remove(waveHomeCirFilePath)
	})
	testOpenCirFile(t, waveHomeCirFilePath, true)
	_, err = CreateCirFile(waveHomeCirFilePath, 100)
	if err != nil {
		t.Fatalf(cannotCreateCirFile, waveHomeCirFilePath, err)
	}
	testOpenCirFile(t, waveHomeCirFilePath, false)
}
