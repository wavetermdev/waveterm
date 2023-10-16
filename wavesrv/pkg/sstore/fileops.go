package sstore

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path"

	"github.com/wavetermdev/waveterm/waveshell/pkg/cirfile"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/google/uuid"
)

func CreateCmdPtyFile(ctx context.Context, screenId string, lineId string, maxSize int64) error {
	ptyOutFileName, err := scbase.PtyOutFile(screenId, lineId)
	if err != nil {
		return err
	}
	f, err := cirfile.CreateCirFile(ptyOutFileName, maxSize)
	if err != nil {
		return err
	}
	return f.Close()
}

func StatCmdPtyFile(ctx context.Context, screenId string, lineId string) (*cirfile.Stat, error) {
	ptyOutFileName, err := scbase.PtyOutFile(screenId, lineId)
	if err != nil {
		return nil, err
	}
	return cirfile.StatCirFile(ctx, ptyOutFileName)
}

func AppendToCmdPtyBlob(ctx context.Context, screenId string, lineId string, data []byte, pos int64) (*PtyDataUpdate, error) {
	if screenId == "" {
		return nil, fmt.Errorf("cannot append to PtyBlob, screenid is not set")
	}
	if pos < 0 {
		return nil, fmt.Errorf("invalid seek pos '%d' in AppendToCmdPtyBlob", pos)
	}
	ptyOutFileName, err := scbase.PtyOutFile(screenId, lineId)
	if err != nil {
		return nil, err
	}
	f, err := cirfile.OpenCirFile(ptyOutFileName)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	err = f.WriteAt(ctx, data, pos)
	if err != nil {
		return nil, err
	}
	data64 := base64.StdEncoding.EncodeToString(data)
	update := &PtyDataUpdate{
		ScreenId:   screenId,
		LineId:     lineId,
		PtyPos:     pos,
		PtyData64:  data64,
		PtyDataLen: int64(len(data)),
	}
	err = MaybeInsertPtyPosUpdate(ctx, screenId, lineId)
	if err != nil {
		// just log
		log.Printf("error inserting ptypos update %s/%s: %v\n", screenId, lineId, err)
	}
	return update, nil
}

// returns (real-offset, data, err)
func ReadFullPtyOutFile(ctx context.Context, screenId string, lineId string) (int64, []byte, error) {
	ptyOutFileName, err := scbase.PtyOutFile(screenId, lineId)
	if err != nil {
		return 0, nil, err
	}
	f, err := cirfile.OpenCirFile(ptyOutFileName)
	if err != nil {
		return 0, nil, err
	}
	defer f.Close()
	return f.ReadAll(ctx)
}

// returns (real-offset, data, err)
func ReadPtyOutFile(ctx context.Context, screenId string, lineId string, offset int64, maxSize int64) (int64, []byte, error) {
	ptyOutFileName, err := scbase.PtyOutFile(screenId, lineId)
	if err != nil {
		return 0, nil, err
	}
	f, err := cirfile.OpenCirFile(ptyOutFileName)
	if err != nil {
		return 0, nil, err
	}
	defer f.Close()
	return f.ReadAtWithMax(ctx, offset, maxSize)
}

type SessionDiskSizeType struct {
	NumFiles   int
	TotalSize  int64
	ErrorCount int
	Location   string
}

func directorySize(dirName string) (SessionDiskSizeType, error) {
	var rtn SessionDiskSizeType
	rtn.Location = dirName
	entries, err := os.ReadDir(dirName)
	if err != nil {
		return rtn, err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			rtn.ErrorCount++
			continue
		}
		finfo, err := entry.Info()
		if err != nil {
			rtn.ErrorCount++
			continue
		}
		rtn.NumFiles++
		rtn.TotalSize += finfo.Size()
	}
	return rtn, nil
}

func SessionDiskSize(sessionId string) (SessionDiskSizeType, error) {
	sessionDir, err := scbase.EnsureSessionDir(sessionId)
	if err != nil {
		return SessionDiskSizeType{}, err
	}
	return directorySize(sessionDir)
}

func FullSessionDiskSize() (map[string]SessionDiskSizeType, error) {
	sdir := scbase.GetSessionsDir()
	entries, err := os.ReadDir(sdir)
	if err != nil {
		return nil, err
	}
	rtn := make(map[string]SessionDiskSizeType)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		_, err = uuid.Parse(name)
		if err != nil {
			continue
		}
		diskSize, err := directorySize(path.Join(sdir, name))
		if err != nil {
			continue
		}
		rtn[name] = diskSize
	}
	return rtn, nil
}

func DeletePtyOutFile(ctx context.Context, screenId string, lineId string) error {
	ptyOutFileName, err := scbase.PtyOutFile(screenId, lineId)
	if err != nil {
		return err
	}
	err = os.Remove(ptyOutFileName)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func DeleteScreenDir(ctx context.Context, screenId string) error {
	screenDir, err := scbase.EnsureScreenDir(screenId)
	if err != nil {
		return fmt.Errorf("error getting screendir: %w", err)
	}
	log.Printf("remove-all %s\n", screenDir)
	return os.RemoveAll(screenDir)
}
