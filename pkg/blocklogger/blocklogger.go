// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blocklogger

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// Buffer size for the output channel
const outputBufferSize = 1000

var outputChan chan wshrpc.CommandControllerAppendOutputData

func InitBlockLogger() {
	outputChan = make(chan wshrpc.CommandControllerAppendOutputData, outputBufferSize)
	// Start the output runner
	go outputRunner()
}

func outputRunner() {
	defer log.Printf("blocklogger: outputRunner exiting")
	client := wshclient.GetBareRpcClient()
	for data := range outputChan {
		// Process each output request synchronously, waiting for response
		wshclient.ControllerAppendOutputCommand(client, data, nil)
	}
}

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

func queueLogData(data wshrpc.CommandControllerAppendOutputData) {
	select {
	case outputChan <- data:
	default:
	}
}

func writeLogf(blockId string, format string, args []any) {
	logStr := fmt.Sprintf(format, args...)
	logStr = strings.ReplaceAll(logStr, "\n", "\r\n")
	data := wshrpc.CommandControllerAppendOutputData{
		BlockId: blockId,
		Data64:  base64.StdEncoding.EncodeToString([]byte(logStr)),
	}
	queueLogData(data)
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
