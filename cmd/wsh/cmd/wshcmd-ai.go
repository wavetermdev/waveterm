// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var aiCmd = &cobra.Command{
	Use:                   "ai [-] [message...]",
	Short:                 "Send a message to an AI block",
	Args:                  cobra.MinimumNArgs(1),
	Run:                   aiRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var aiFileFlags []string

func init() {
	rootCmd.AddCommand(aiCmd)
	aiCmd.Flags().StringArrayVarP(&aiFileFlags, "file", "f", nil, "attach file content (use '-' for stdin)")
}

func aiRun(cmd *cobra.Command, args []string) {
	// Then in aiRun, we'd need logic like:
	var stdinUsed bool
	var message strings.Builder

	// Handle file attachments first
	for _, file := range aiFileFlags {
		if file == "-" {
			if stdinUsed {
				WriteStderr("[error] stdin (-) can only be used once\n")
				return
			}
			stdinUsed = true
			data, err := io.ReadAll(os.Stdin)
			if err != nil {
				WriteStderr("[error] reading from stdin: %v\n", err)
				return
			}
			message.WriteString("Content from stdin:\n")
			message.Write(data)
		} else {
			data, err := os.ReadFile(file)
			if err != nil {
				WriteStderr("[error] reading file %s: %v\n", file, err)
				return
			}
			message.WriteString(fmt.Sprintf("Content of %s:\n", file))
			message.Write(data)
		}
		message.WriteString("\n\n---------\n\n")
	}

	// Default to "waveai" block
	isDefaultBlock := blockArg == "" || blockArg == "this"
	if isDefaultBlock {
		blockArg = "view@waveai"
	}

	fullORef, err := resolveSimpleId(blockArg)
	if err != nil && isDefaultBlock {
		// Create new AI block if default block doesn't exist
		data := &wshrpc.CommandCreateBlockData{
			BlockDef: &waveobj.BlockDef{
				Meta: map[string]interface{}{
					waveobj.MetaKey_View: "waveai",
				},
			},
		}

		newORef, err := wshclient.CreateBlockCommand(RpcClient, *data, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			WriteStderr("[error] creating AI block: %v\n", err)
			return
		}
		fullORef = &newORef
		// Wait for the block's route to be available
		gotRoute, err := wshclient.WaitForRouteCommand(RpcClient, wshrpc.CommandWaitForRouteData{
			RouteId: wshutil.MakeFeBlockRouteId(fullORef.OID),
			WaitMs:  4000,
		}, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			WriteStderr("[error] waiting for AI block: %v\n", err)
			return
		}
		if !gotRoute {
			WriteStderr("[error] AI block route could not be established\n")
			return
		}
	} else if err != nil {
		WriteStderr("[error] resolving block: %v\n", err)
		return
	}

	// Create the route for this block
	route := wshutil.MakeFeBlockRouteId(fullORef.OID)

	// Then handle main message
	if args[0] == "-" {
		if stdinUsed {
			WriteStderr("[error] stdin (-) can only be used once\n")
			return
		}
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			WriteStderr("[error] reading from stdin: %v\n", err)
			return
		}
		message.Write(data)
	} else {
		message.WriteString(strings.Join(args, " "))
	}

	if message.Len() == 0 {
		WriteStderr("[error] message is empty\n")
		return
	}
	if message.Len() > 10*1024 {
		WriteStderr("[error] current max message size is 10k\n")
		return
	}

	messageData := wshrpc.AiMessageData{
		Message: message.String(),
	}
	err = wshclient.AiSendMessageCommand(RpcClient, messageData, &wshrpc.RpcOpts{
		Route:   route,
		Timeout: 2000,
	})
	if err != nil {
		WriteStderr("[error] sending message: %v\n", err)
		return
	}
}
