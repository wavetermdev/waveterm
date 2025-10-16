// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var aiCmd = &cobra.Command{
	Use:   "ai [options] [files...]",
	Short: "Append content to Wave AI sidebar prompt",
	Long: `Append content to Wave AI sidebar prompt (does not auto-submit by default)

Arguments:
  files...               Files to attach (use '-' for stdin)

Examples:
  git diff | wsh ai -                    # Pipe diff to AI, ask question in UI
  wsh ai main.go                         # Attach file, ask question in UI
  wsh ai *.go -m "find bugs"             # Attach files with message
  wsh ai -s - -m "review" < log.txt      # Stdin + message, auto-submit
  wsh ai -n config.json                  # New chat with file attached`,
	RunE:                  aiRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var aiMessageFlag string
var aiSubmitFlag bool
var aiNewBlockFlag bool

func init() {
	rootCmd.AddCommand(aiCmd)
	aiCmd.Flags().StringVarP(&aiMessageFlag, "message", "m", "", "optional message/question to append after files")
	aiCmd.Flags().BoolVarP(&aiSubmitFlag, "submit", "s", false, "submit the prompt immediately after appending")
	aiCmd.Flags().BoolVarP(&aiNewBlockFlag, "new", "n", false, "create a new AI chat instead of using existing")
}

func detectMimeType(data []byte) string {
	mimeType := http.DetectContentType(data)
	return strings.Split(mimeType, ";")[0]
}

func getMaxFileSize(mimeType string) (int, string) {
	if mimeType == "application/pdf" {
		return 5 * 1024 * 1024, "5MB"
	}
	if strings.HasPrefix(mimeType, "image/") {
		return 7 * 1024 * 1024, "7MB"
	}
	return 200 * 1024, "200KB"
}

func aiRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("ai", rtnErr == nil)
	}()

	if len(args) == 0 && aiMessageFlag == "" {
		OutputHelpMessage(cmd)
		return fmt.Errorf("no files or message provided")
	}

	const maxFileCount = 15
	const rpcTimeout = 30000

	var allFiles []wshrpc.AIAttachedFile
	var stdinUsed bool

	if len(args) > maxFileCount {
		return fmt.Errorf("too many files (maximum %d files allowed)", maxFileCount)
	}

	for _, filePath := range args {
		var data []byte
		var fileName string
		var mimeType string
		var err error

		if filePath == "-" {
			if stdinUsed {
				return fmt.Errorf("stdin (-) can only be used once")
			}
			stdinUsed = true

			data, err = io.ReadAll(os.Stdin)
			if err != nil {
				return fmt.Errorf("reading from stdin: %w", err)
			}
			fileName = "stdin"
			mimeType = "text/plain"
		} else {
			fileInfo, err := os.Stat(filePath)
			if err != nil {
				return fmt.Errorf("accessing file %s: %w", filePath, err)
			}
			if fileInfo.IsDir() {
				return fmt.Errorf("%s is a directory, not a file", filePath)
			}

			data, err = os.ReadFile(filePath)
			if err != nil {
				return fmt.Errorf("reading file %s: %w", filePath, err)
			}
			fileName = filepath.Base(filePath)
			mimeType = detectMimeType(data)
		}

		isPDF := mimeType == "application/pdf"
		isImage := strings.HasPrefix(mimeType, "image/")
		
		if !isPDF && !isImage {
			mimeType = "text/plain"
			if utilfn.ContainsBinaryData(data) {
				return fmt.Errorf("file %s contains binary data and cannot be uploaded as text", fileName)
			}
		}

		maxSize, sizeStr := getMaxFileSize(mimeType)
		if len(data) > maxSize {
			return fmt.Errorf("file %s exceeds maximum size of %s for %s files", fileName, sizeStr, mimeType)
		}

		allFiles = append(allFiles, wshrpc.AIAttachedFile{
			Name:   fileName,
			Type:   mimeType,
			Size:   len(data),
			Data64: base64.StdEncoding.EncodeToString(data),
		})
	}

	tabId := os.Getenv("WAVETERM_TABID")
	if tabId == "" {
		return fmt.Errorf("WAVETERM_TABID environment variable not set")
	}

	route := wshutil.MakeTabRouteId(tabId)

	if aiNewBlockFlag {
		newChatData := wshrpc.CommandWaveAIAddContextData{
			NewChat: true,
		}
		err := wshclient.WaveAIAddContextCommand(RpcClient, newChatData, &wshrpc.RpcOpts{
			Route:   route,
			Timeout: rpcTimeout,
		})
		if err != nil {
			return fmt.Errorf("creating new chat: %w", err)
		}
	}

	for _, file := range allFiles {
		contextData := wshrpc.CommandWaveAIAddContextData{
			Files: []wshrpc.AIAttachedFile{file},
		}
		err := wshclient.WaveAIAddContextCommand(RpcClient, contextData, &wshrpc.RpcOpts{
			Route:   route,
			Timeout: rpcTimeout,
		})
		if err != nil {
			return fmt.Errorf("adding file %s: %w", file.Name, err)
		}
	}

	if aiMessageFlag != "" || aiSubmitFlag {
		finalContextData := wshrpc.CommandWaveAIAddContextData{
			Text:   aiMessageFlag,
			Submit: aiSubmitFlag,
		}
		err := wshclient.WaveAIAddContextCommand(RpcClient, finalContextData, &wshrpc.RpcOpts{
			Route:   route,
			Timeout: rpcTimeout,
		})
		if err != nil {
			return fmt.Errorf("adding context: %w", err)
		}
	}

	return nil
}
