// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cirfile

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
)

// CBUF[version] [maxsize] [fileoffset] [startpos] [endpos]
const HeaderFmt1 = "CBUF%02d %19d %19d %19d %19d\n" // 87 bytes
const HeaderLen = 256                               // set to 256 for future expandability
const FullHeaderFmt = "%-255s\n"                    // 256 bytes (255 + newline)
const CurrentVersion = 1
const FilePosEmpty = -1 // sentinel, if startpos is set to -1, file is empty

const InitialLockDelay = 10 * time.Millisecond
const InitialLockTries = 5
const LockDelay = 100 * time.Millisecond

// File objects are *not* multithread safe, operations must be externally synchronized
type File struct {
	OSFile       *os.File
	Version      byte
	MaxSize      int64
	FileOffset   int64
	StartPos     int64
	EndPos       int64
	FileDataSize int64 // size of data (does not include header size)
	FlockStatus  int
}

type Stat struct {
	Location   string
	Version    byte
	MaxSize    int64
	FileOffset int64
	DataSize   int64
}

func (f *File) flock(ctx context.Context, lockType int) error {
	err := syscall.Flock(int(f.OSFile.Fd()), lockType|syscall.LOCK_NB)
	if err == nil {
		f.FlockStatus = lockType
		return nil
	}
	if err != syscall.EWOULDBLOCK {
		return err
	}

	// Do not busy-wait unless we have a way to cancel the context
	if ctx == nil || ctx.Done() == nil {
		return syscall.EWOULDBLOCK
	}
	// busy-wait with context
	numWaits := 0
	for {
		numWaits++
		var timeout time.Duration
		if numWaits <= InitialLockTries {
			timeout = InitialLockDelay
		} else {
			timeout = LockDelay
		}
		select {
		case <-time.After(timeout):
			// TODO: Ineffective break statement
			break
		case <-ctx.Done():
			return ctx.Err()
		}
		err = syscall.Flock(int(f.OSFile.Fd()), lockType|syscall.LOCK_NB)
		if err == nil {
			f.FlockStatus = lockType
			return nil
		}
		if err != syscall.EWOULDBLOCK {
			return err
		}
	}
}

func (f *File) unflock() {
	if f.FlockStatus != 0 {
		syscall.Flock(int(f.OSFile.Fd()), syscall.LOCK_UN) // ignore error (nothing to do about it anyway)
		f.FlockStatus = 0
	}
}

// cirfile path must not be in the root directory and must not contain more than one period (.) in the filename
var cfRegex = regexp.MustCompile(`([^.\v]+[\\|\/])+([^.\v]+.cf)`)
var tempDir = os.TempDir()
var waveHomeDir = scbase.GetWaveHomeDir()

// returns error if the filename is not a valid cirfile path
func ValidateCirFilePath(fileName string) error {
	// Check that the file path matches the regex
	if !cfRegex.MatchString(fileName) {
		return fmt.Errorf("invalid cirfile path[%s]", fileName)
	}

	// Check that the file is in the wavehomedir or tempdir, these are the only places we allow cirfiles to be created
	absPath, err := filepath.Abs(fileName)
	if err != nil {
		return fmt.Errorf("cannot get absolute path for file[%s]: %w", fileName, err)
	}
	if !strings.HasPrefix(absPath, waveHomeDir) && !strings.HasPrefix(absPath, tempDir) {
		return fmt.Errorf("invalid cirfile path[%s], must be in wavehomedir[%s] or tempdir[%s]", fileName, waveHomeDir, tempDir)
	}
	return nil
}

// does not read metadata because locking could block/fail.  we want to be able
// to return a valid file struct without blocking.
func OpenCirFile(fileName string) (*File, error) {
	err := ValidateCirFilePath(fileName)
	if err != nil {
		return nil, err
	}

	if !cfRegex.MatchString(fileName) {
		return nil, fmt.Errorf("invalid cirfile path[%s]", fileName)
	}

	// Check that the file is in the wavehomedir or tempdir, these are the only places we allow cirfiles to be created
	absPath, err := filepath.Abs(fileName)
	if err != nil {
		return nil, fmt.Errorf("cannot get absolute path for file[%s]: %w", fileName, err)
	}
	if !strings.HasPrefix(absPath, waveHomeDir) && !strings.HasPrefix(absPath, tempDir) {
		return nil, fmt.Errorf("invalid cirfile path[%s], must be in wavehomedir[%s] or tempdir[%s]", fileName, waveHomeDir, tempDir)
	}
	fd, err := os.OpenFile(fileName, os.O_RDWR, 0777)
	if err != nil {
		return nil, err
	}
	finfo, err := fd.Stat()
	if err != nil {
		return nil, err
	}
	if finfo.Size() < HeaderLen {
		return nil, fmt.Errorf("invalid cirfile, file length[%d] less than HeaderLen[%d]", finfo.Size(), HeaderLen)
	}
	rtn := &File{OSFile: fd}
	return rtn, nil
}

func StatCirFile(ctx context.Context, fileName string) (*Stat, error) {
	file, err := OpenCirFile(fileName)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	fileOffset, dataSize, err := file.GetStartOffsetAndSize(ctx)
	if err != nil {
		return nil, err
	}
	return &Stat{
		Location:   fileName,
		Version:    file.Version,
		MaxSize:    file.MaxSize,
		FileOffset: fileOffset,
		DataSize:   dataSize,
	}, nil
}

// if the file already exists, it is an error.
// there is a race condition if two goroutines try to create the same file between Stat() and Create(), so
//
//	they both might get no error, but only one file will be valid.  if this is a concern, this call
//	should be externally synchronized.
func CreateCirFile(fileName string, maxSize int64) (*File, error) {
	if maxSize <= 0 {
		return nil, fmt.Errorf("invalid maxsize[%d]", maxSize)
	}
	_, err := os.Stat(fileName)
	if err == nil {
		return nil, fmt.Errorf("file[%s] already exists", fileName)
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("cannot stat: %w", err)
	}
	fd, err := os.Create(fileName)
	if err != nil {
		return nil, err
	}
	rtn := &File{OSFile: fd, Version: CurrentVersion, MaxSize: maxSize, StartPos: FilePosEmpty}
	err = rtn.flock(context.TODO(), syscall.LOCK_EX)
	if err != nil {
		return nil, err
	}
	defer rtn.unflock()
	err = rtn.writeMeta()
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func (f *File) Close() error {
	return f.OSFile.Close()
}

func (f *File) ReadMeta(ctx context.Context) error {
	err := f.flock(ctx, syscall.LOCK_SH)
	if err != nil {
		return err
	}
	defer f.unflock()
	return f.readMeta()
}

func (f *File) hasShLock() bool {
	return f.FlockStatus == syscall.LOCK_EX || f.FlockStatus == syscall.LOCK_SH
}

func (f *File) hasExLock() bool {
	return f.FlockStatus == syscall.LOCK_EX
}

func (f *File) readMeta() error {
	if f.OSFile == nil {
		return fmt.Errorf("no *os.File")
	}
	if !f.hasShLock() {
		return fmt.Errorf("writeMeta must hold LOCK_SH")
	}
	_, err := f.OSFile.Seek(0, 0)
	if err != nil {
		return fmt.Errorf("cannot seek file: %w", err)
	}
	finfo, err := f.OSFile.Stat()
	if err != nil {
		return fmt.Errorf("cannot stat file: %w", err)
	}
	if finfo.Size() < 256 {
		return fmt.Errorf("invalid cbuf file size[%d] < 256", finfo.Size())
	}
	f.FileDataSize = finfo.Size() - 256
	buf := make([]byte, 256)
	_, err = io.ReadFull(f.OSFile, buf)
	if err != nil {
		return fmt.Errorf("error reading header: %w", err)
	}
	// currently only one version, so we don't need to have special logic here yet
	_, err = fmt.Sscanf(string(buf), HeaderFmt1, &f.Version, &f.MaxSize, &f.FileOffset, &f.StartPos, &f.EndPos)
	if err != nil {
		return fmt.Errorf("sscanf error: %w", err)
	}
	if f.Version != CurrentVersion {
		return fmt.Errorf("invalid cbuf version[%d]", f.Version)
	}
	// possible incomplete write, fix start/end pos to be within filesize
	if f.FileDataSize == 0 || (f.StartPos >= f.FileDataSize && f.EndPos >= f.FileDataSize) {
		f.StartPos = FilePosEmpty
		f.EndPos = 0
	} else if f.StartPos >= f.FileDataSize {
		f.StartPos = 0
	} else if f.EndPos >= f.FileDataSize {
		f.EndPos = f.FileDataSize - 1
	}
	if f.MaxSize <= 0 || f.FileOffset < 0 || (f.StartPos < 0 && f.StartPos != FilePosEmpty) || f.StartPos >= f.MaxSize || f.EndPos < 0 || f.EndPos >= f.MaxSize {
		return fmt.Errorf("invalid cbuf metadata version[%d] filedatasize[%d] maxsize[%d] fileoffset[%d] startpos[%d] endpos[%d]", f.Version, f.FileDataSize, f.MaxSize, f.FileOffset, f.StartPos, f.EndPos)
	}
	return nil
}

// no error checking of meta values
func (f *File) writeMeta() error {
	if f.OSFile == nil {
		return fmt.Errorf("no *os.File")
	}
	if !f.hasExLock() {
		return fmt.Errorf("writeMeta must hold LOCK_EX")
	}
	_, err := f.OSFile.Seek(0, 0)
	if err != nil {
		return fmt.Errorf("cannot seek file: %w", err)
	}
	metaStr := fmt.Sprintf(HeaderFmt1, f.Version, f.MaxSize, f.FileOffset, f.StartPos, f.EndPos)
	fullMetaStr := fmt.Sprintf(FullHeaderFmt, metaStr)
	_, err = f.OSFile.WriteString(fullMetaStr)
	if err != nil {
		return fmt.Errorf("write error: %w", err)
	}
	return nil
}

// returns (fileOffset, datasize, error)
// datasize is the current amount of readable data held in the cirfile
func (f *File) GetStartOffsetAndSize(ctx context.Context) (int64, int64, error) {
	err := f.flock(ctx, syscall.LOCK_SH)
	if err != nil {
		return 0, 0, err
	}
	defer f.unflock()
	err = f.readMeta()
	if err != nil {
		return 0, 0, err
	}
	chunks := f.getFileChunks()
	return f.FileOffset, totalChunksSize(chunks), nil
}

type fileChunk struct {
	StartPos int64
	Len      int64
}

func totalChunksSize(chunks []fileChunk) int64 {
	var rtn int64
	for _, chunk := range chunks {
		rtn += chunk.Len
	}
	return rtn
}

func advanceChunks(chunks []fileChunk, offset int64) []fileChunk {
	if offset < 0 {
		panic(fmt.Sprintf("invalid negative offset: %d", offset))
	}
	if offset == 0 {
		return chunks
	}
	var rtn []fileChunk
	for _, chunk := range chunks {
		if offset >= chunk.Len {
			offset = offset - chunk.Len
			continue
		}
		if offset == 0 {
			rtn = append(rtn, chunk)
		} else {
			rtn = append(rtn, fileChunk{chunk.StartPos + offset, chunk.Len - offset})
			offset = 0
		}
	}
	return rtn
}

func (f *File) getFileChunks() []fileChunk {
	if f.StartPos == FilePosEmpty {
		return nil
	}
	if f.EndPos >= f.StartPos {
		return []fileChunk{{f.StartPos, f.EndPos - f.StartPos + 1}}
	}
	return []fileChunk{
		{f.StartPos, f.FileDataSize - f.StartPos},
		{0, f.EndPos + 1},
	}
}

func (f *File) getFreeChunks() []fileChunk {
	if f.StartPos == FilePosEmpty {
		return []fileChunk{{0, f.MaxSize}}
	}
	if (f.EndPos == f.StartPos-1) || (f.StartPos == 0 && f.EndPos == f.MaxSize-1) {
		return nil
	}
	if f.EndPos < f.StartPos {
		return []fileChunk{{f.EndPos + 1, f.StartPos - f.EndPos - 1}}
	}
	var rtn []fileChunk
	if f.EndPos < f.MaxSize-1 {
		rtn = append(rtn, fileChunk{f.EndPos + 1, f.MaxSize - f.EndPos - 1})
	}
	if f.StartPos > 0 {
		rtn = append(rtn, fileChunk{0, f.StartPos})
	}
	return rtn
}

// returns (offset, data, err)
func (f *File) ReadAll(ctx context.Context) (int64, []byte, error) {
	err := f.flock(ctx, syscall.LOCK_SH)
	if err != nil {
		return 0, nil, err
	}
	defer f.unflock()
	err = f.readMeta()
	if err != nil {
		return 0, nil, err
	}
	chunks := f.getFileChunks()
	curSize := totalChunksSize(chunks)
	buf := make([]byte, curSize)
	realOffset, nr, err := f.internalReadNext(buf, 0)
	return realOffset, buf[0:nr], err
}

func (f *File) ReadAtWithMax(ctx context.Context, offset int64, maxSize int64) (int64, []byte, error) {
	err := f.flock(ctx, syscall.LOCK_SH)
	if err != nil {
		return 0, nil, err
	}
	defer f.unflock()
	err = f.readMeta()
	if err != nil {
		return 0, nil, err
	}
	chunks := f.getFileChunks()
	curSize := totalChunksSize(chunks)
	var buf []byte
	if maxSize > curSize {
		buf = make([]byte, curSize)
	} else {
		buf = make([]byte, maxSize)
	}
	realOffset, nr, err := f.internalReadNext(buf, offset)
	return realOffset, buf[0:nr], err
}

func (f *File) internalReadNext(buf []byte, offset int64) (int64, int, error) {
	if offset < f.FileOffset {
		offset = f.FileOffset
	}
	relativeOffset := offset - f.FileOffset
	chunks := f.getFileChunks()
	curSize := totalChunksSize(chunks)
	if offset >= f.FileOffset+curSize {
		return f.FileOffset + curSize, 0, nil
	}
	chunks = advanceChunks(chunks, relativeOffset)
	numRead := 0
	for _, chunk := range chunks {
		if numRead >= len(buf) {
			break
		}
		toRead := len(buf) - numRead
		if toRead > int(chunk.Len) {
			toRead = int(chunk.Len)
		}
		nr, err := f.OSFile.ReadAt(buf[numRead:numRead+toRead], chunk.StartPos+HeaderLen)
		if err != nil {
			return offset, 0, err
		}
		numRead += nr
	}
	return offset, numRead, nil
}

// returns (realOffset, numread, error)
// will only return io.EOF when len(data) == 0, otherwise will just do a short read
func (f *File) ReadNext(ctx context.Context, buf []byte, offset int64) (int64, int, error) {
	err := f.flock(ctx, syscall.LOCK_SH)
	if err != nil {
		return 0, 0, err
	}
	defer f.unflock()
	err = f.readMeta()
	if err != nil {
		return 0, 0, err
	}
	return f.internalReadNext(buf, offset)
}

func (f *File) ensureFreeSpace(requiredSpace int64) error {
	chunks := f.getFileChunks()
	curSpace := f.MaxSize - totalChunksSize(chunks)
	if curSpace >= requiredSpace {
		return nil
	}
	neededSpace := requiredSpace - curSpace
	if requiredSpace >= f.MaxSize || f.StartPos == FilePosEmpty {
		f.StartPos = FilePosEmpty
		f.EndPos = 0
		f.FileOffset += neededSpace
	} else {
		f.StartPos = (f.StartPos + neededSpace) % f.MaxSize
		f.FileOffset += neededSpace
	}
	return f.writeMeta()
}

// does not implement io.WriterAt (needs context)
func (f *File) WriteAt(ctx context.Context, buf []byte, writePos int64) error {
	if writePos < 0 {
		return fmt.Errorf("WriteAt got invalid writePos[%d]", writePos)
	}
	err := f.flock(ctx, syscall.LOCK_EX)
	if err != nil {
		return err
	}
	defer f.unflock()
	err = f.readMeta()
	if err != nil {
		return err
	}
	chunks := f.getFileChunks()
	currentSize := totalChunksSize(chunks)
	if writePos < f.FileOffset {
		negOffset := f.FileOffset - writePos
		if negOffset >= int64(len(buf)) {
			return nil
		}
		buf = buf[negOffset:]
		writePos = f.FileOffset
	}
	if writePos > f.FileOffset+currentSize {
		// fill gap with zero bytes
		posOffset := writePos - (f.FileOffset + currentSize)
		err = f.ensureFreeSpace(int64(posOffset))
		if err != nil {
			return err
		}
		var zeroBuf []byte
		if posOffset >= f.MaxSize {
			zeroBuf = make([]byte, f.MaxSize)
		} else {
			zeroBuf = make([]byte, posOffset)
		}
		err = f.internalAppendData(zeroBuf)
		if err != nil {
			return err
		}
		// recalc chunks/currentSize
		chunks = f.getFileChunks()
		currentSize = totalChunksSize(chunks)
		// after writing the zero bytes, writePos == f.FileOffset+currentSize (the rest is a straight append)
	}
	// now writePos >= f.FileOffset && writePos <= f.FileOffset+currentSize (check invariant)
	if writePos < f.FileOffset || writePos > f.FileOffset+currentSize {
		panic(fmt.Sprintf("invalid writePos, invariant violated writepos[%d] fileoffset[%d] currentsize[%d]", writePos, f.FileOffset, currentSize))
	}
	// overwrite existing data (in chunks).  advance by writePosOffset
	writePosOffset := writePos - f.FileOffset
	if writePosOffset < currentSize {
		advChunks := advanceChunks(chunks, writePosOffset)
		nw, err := f.writeToChunks(buf, advChunks, false)
		if err != nil {
			return err
		}
		buf = buf[nw:]
		if len(buf) == 0 {
			return nil
		}
	}
	// buf contains what was unwritten.  this unwritten data is now just a straight append
	return f.internalAppendData(buf)
}

// try writing to chunks, returns (nw, error)
func (f *File) writeToChunks(buf []byte, chunks []fileChunk, updatePos bool) (int64, error) {
	var numWrite int64
	for _, chunk := range chunks {
		if numWrite >= int64(len(buf)) {
			break
		}
		if chunk.Len == 0 {
			continue
		}
		toWrite := int64(len(buf)) - numWrite
		if toWrite > chunk.Len {
			toWrite = chunk.Len
		}
		nw, err := f.OSFile.WriteAt(buf[numWrite:numWrite+toWrite], chunk.StartPos+HeaderLen)
		if err != nil {
			return 0, err
		}
		if updatePos {
			if chunk.StartPos+int64(nw) > f.FileDataSize {
				f.FileDataSize = chunk.StartPos + int64(nw)
			}
			if f.StartPos == FilePosEmpty {
				f.StartPos = chunk.StartPos
			}
			f.EndPos = chunk.StartPos + int64(nw) - 1
		}
		numWrite += int64(nw)
	}
	return numWrite, nil
}

func (f *File) internalAppendData(buf []byte) error {
	err := f.ensureFreeSpace(int64(len(buf)))
	if err != nil {
		return err
	}
	if len(buf) >= int(f.MaxSize) {
		buf = buf[len(buf)-int(f.MaxSize):]
	}
	chunks := f.getFreeChunks()
	// don't track nw because we know we have enough free space to write entire buf
	_, err = f.writeToChunks(buf, chunks, true)
	if err != nil {
		return err
	}
	err = f.writeMeta()
	if err != nil {
		return err
	}
	return nil
}

func (f *File) AppendData(ctx context.Context, buf []byte) error {
	err := f.flock(ctx, syscall.LOCK_EX)
	if err != nil {
		return err
	}
	defer f.unflock()
	err = f.readMeta()
	if err != nil {
		return err
	}
	return f.internalAppendData(buf)
}
