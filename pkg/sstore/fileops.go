package sstore

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"

	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
)

func AppendToCmdPtyBlob(ctx context.Context, sessionId string, cmdId string, data []byte, pos int64) error {
	if pos < 0 {
		return fmt.Errorf("invalid seek pos '%d' in AppendToCmdPtyBlob", pos)
	}
	ptyOutFileName, err := scbase.PtyOutFile(sessionId, cmdId)
	if err != nil {
		return err
	}
	fd, err := os.OpenFile(ptyOutFileName, os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return err
	}
	realPos, err := fd.Seek(pos, 0)
	if err != nil {
		return err
	}
	if realPos != pos {
		return fmt.Errorf("could not seek to pos:%d (realpos=%d)", pos, realPos)
	}
	defer fd.Close()
	if len(data) == 0 {
		return nil
	}
	_, err = fd.Write(data)
	if err != nil {
		return err
	}
	data64 := base64.StdEncoding.EncodeToString(data)
	update := &PtyDataUpdate{
		SessionId:  sessionId,
		CmdId:      cmdId,
		PtyPos:     realPos,
		PtyData64:  data64,
		PtyDataLen: int64(len(data)),
	}
	MainBus.SendUpdate(sessionId, update)
	return nil
}
