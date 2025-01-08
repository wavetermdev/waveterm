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

func ContextWithLogBlockId(ctx context.Context, blockId string) context.Context {
	return context.WithValue(ctx, logBlockIdContextKey, blockId)
}

func GetLogBlockIdFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	blockId, _ := ctx.Value(logBlockIdContextKey).(string)
	return blockId
}

func Logf(ctx context.Context, format string, args ...interface{}) {
	logBlockId := GetLogBlockIdFromContext(ctx)
	if logBlockId == "" {
		return
	}
	logStr := fmt.Sprintf(format, args...)
	logStr = strings.ReplaceAll(logStr, "\n", "\r\n")
	client := wshclient.GetBareRpcClient()
	data := wshrpc.CommandControllerAppendOutputData{
		BlockId: logBlockId,
		Data64:  base64.StdEncoding.EncodeToString([]byte(logStr)),
	}
	wshclient.ControllerAppendOutputCommand(client, data, &wshrpc.RpcOpts{NoResponse: true})
}
