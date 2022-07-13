package sstore

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"

	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
)

const PosAppend = -1

// when calling with PosAppend, this is not multithread safe (since file could be modified).
// we need to know the real position of the write to send a proper pty update to the frontends
// in practice this is fine since we only use PosAppend in non-detached mode where
//   we are reading/writing a stream in order with a single goroutine
func AppendToCmdPtyBlob(ctx context.Context, sessionId string, cmdId string, data []byte, pos int64) error {
	ptyOutFileName, err := scbase.PtyOutFile(sessionId, cmdId)
	if err != nil {
		return err
	}
	var fd *os.File
	var realPos int64
	if pos == PosAppend {
		fd, err = os.OpenFile(ptyOutFileName, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
		if err != nil {
			return err
		}
		finfo, err := fd.Stat()
		if err != nil {
			return err
		}
		realPos = finfo.Size()
	} else {
		fd, err = os.OpenFile(ptyOutFileName, os.O_WRONLY|os.O_CREATE, 0600)
		if err != nil {
			return err
		}
		realPos, err = fd.Seek(pos, 0)
		if err != nil {
			return err
		}
		if realPos != pos {
			return fmt.Errorf("could not seek to pos:%d (realpos=%d)", pos, realPos)
		}
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
