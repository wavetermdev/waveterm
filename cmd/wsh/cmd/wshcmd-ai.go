// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
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

func init() {
	rootCmd.AddCommand(aiCmd)
}

func aiRun(cmd *cobra.Command, args []string) {
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

	// Get message from args or stdin
	var message string
	if args[0] == "-" {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			WriteStderr("[error] reading from stdin: %v\n", err)
			return
		}
		message = string(data)
	} else {
		message = strings.Join(args, " ")
	}

	messageData := wshrpc.AiMessageData{
		Message: message,
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
