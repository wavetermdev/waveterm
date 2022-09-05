package sstore

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/scripthaus-dev/mshell/pkg/cirfile"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
)

func CreateCmdPtyFile(ctx context.Context, sessionId string, cmdId string, maxSize int64) error {
	ptyOutFileName, err := scbase.PtyOutFile(sessionId, cmdId)
	if err != nil {
		return err
	}
	f, err := cirfile.CreateCirFile(ptyOutFileName, maxSize)
	if err != nil {
		return err
	}
	return f.Close()
}

func AppendToCmdPtyBlob(ctx context.Context, sessionId string, cmdId string, data []byte, pos int64) (*PtyDataUpdate, error) {
	if pos < 0 {
		return nil, fmt.Errorf("invalid seek pos '%d' in AppendToCmdPtyBlob", pos)
	}
	ptyOutFileName, err := scbase.PtyOutFile(sessionId, cmdId)
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
		SessionId:  sessionId,
		CmdId:      cmdId,
		PtyPos:     pos,
		PtyData64:  data64,
		PtyDataLen: int64(len(data)),
	}
	return update, nil
}

// returns (offset, data, err)
func ReadFullPtyOutFile(ctx context.Context, sessionId string, cmdId string) (int64, []byte, error) {
	ptyOutFileName, err := scbase.PtyOutFile(sessionId, cmdId)
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
