package sstore

import (
	"context"
	"os"

	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
)

func AppendToCmdPtyBlob(ctx context.Context, sessionId string, cmdId string, data []byte) error {
	ptyOutFileName, err := scbase.PtyOutFile(sessionId, cmdId)
	if err != nil {
		return err
	}
	fd, err := os.OpenFile(ptyOutFileName, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return err
	}
	defer fd.Close()
	if len(data) == 0 {
		return nil
	}
	_, err = fd.Write(data)
	if err != nil {
		return err
	}
	return nil
}
