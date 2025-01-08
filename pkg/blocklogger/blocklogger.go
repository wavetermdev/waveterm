// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blocklogger

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

type logBlockIdContextKeyType struct{}

var logBlockIdContextKey = logBlockIdContextKeyType{}

type logBlockIdData struct {
	BlockId string
	Verbose bool
}

func ContextWithLogBlockId(ctx context.Context, blockId string, verbose bool) context.Context {
	return context.WithValue(ctx, logBlockIdContextKey, &logBlockIdData{BlockId: blockId, Verbose: verbose})
}

func getLogBlockData(ctx context.Context) *logBlockIdData {
	if ctx == nil {
		return nil
	}
	dataPtr := ctx.Value(logBlockIdContextKey)
	if dataPtr == nil {
		return nil
	}
	return dataPtr.(*logBlockIdData)
}

func writeLogf(blockId string, format string, args []any) {
	logStr := fmt.Sprintf(format, args...)
	logStr = strings.ReplaceAll(logStr, "\n", "\r\n")
	client := wshclient.GetBareRpcClient()
	data := wshrpc.CommandControllerAppendOutputData{
		BlockId: blockId,
		Data64:  base64.StdEncoding.EncodeToString([]byte(logStr)),
	}
	wshclient.ControllerAppendOutputCommand(client, data, &wshrpc.RpcOpts{NoResponse: true})
}

func Infof(ctx context.Context, format string, args ...any) {
	logData := getLogBlockData(ctx)
	if logData == nil {
		return
	}
	writeLogf(logData.BlockId, format, args)
}

func Debugf(ctx context.Context, format string, args ...interface{}) {
	logData := getLogBlockData(ctx)
	if logData == nil || !logData.Verbose {
		return
	}
	writeLogf(logData.BlockId, format, args)
}
