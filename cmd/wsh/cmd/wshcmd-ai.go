// Copyright 2025, Command Line Inc.
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
	RunE:                  aiRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var aiFileFlags []string
var aiNewBlockFlag bool

func init() {
	rootCmd.AddCommand(aiCmd)
	aiCmd.Flags().BoolVarP(&aiNewBlockFlag, "new", "n", false, "create a new AI block")
	aiCmd.Flags().StringArrayVarP(&aiFileFlags, "file", "f", nil, "attach file content (use '-' for stdin)")
}

func encodeFile(builder *strings.Builder, file io.Reader, fileName string) error {
	data, err := io.ReadAll(file)
	if err != nil {
		return fmt.Errorf("error reading file: %w", err)
	}
	// Start delimiter with the file name
	builder.WriteString(fmt.Sprintf("\n@@@start file %q\n", fileName))
	// Read the file content and write it to the builder
	builder.Write(data)
	// End delimiter with the file name
	builder.WriteString(fmt.Sprintf("\n@@@end file %q\n\n", fileName))
	return nil
}

func aiRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("ai", rtnErr == nil)
	}()

	if len(args) == 0 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("no message provided")
	}

	var stdinUsed bool
	var message strings.Builder

	// Handle file attachments first
	for _, file := range aiFileFlags {
		if file == "-" {
			if stdinUsed {
				return fmt.Errorf("stdin (-) can only be used once")
			}
			stdinUsed = true
			if err := encodeFile(&message, os.Stdin, "<stdin>"); err != nil {
				return fmt.Errorf("reading from stdin: %w", err)
			}
		} else {
			fd, err := os.Open(file)
			if err != nil {
				return fmt.Errorf("opening file %s: %w", file, err)
			}
			defer fd.Close()
			if err := encodeFile(&message, fd, file); err != nil {
				return fmt.Errorf("reading file %s: %w", file, err)
			}
		}
	}

	// Default to "waveai" block
	isDefaultBlock := blockArg == ""
	if isDefaultBlock {
		blockArg = "view@waveai"
	}
	var fullORef *waveobj.ORef
	var err error
	if !aiNewBlockFlag {
		fullORef, err = resolveSimpleId(blockArg)
	}
	if (err != nil && isDefaultBlock) || aiNewBlockFlag {
		// Create new AI block if default block doesn't exist
		data := &wshrpc.CommandCreateBlockData{
			BlockDef: &waveobj.BlockDef{
				Meta: map[string]interface{}{
					waveobj.MetaKey_View: "waveai",
				},
			},
			Focused: true,
		}

		newORef, err := wshclient.CreateBlockCommand(RpcClient, *data, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("creating AI block: %w", err)
		}
		fullORef = &newORef
		// Wait for the block's route to be available
		gotRoute, err := wshclient.WaitForRouteCommand(RpcClient, wshrpc.CommandWaitForRouteData{
			RouteId: wshutil.MakeFeBlockRouteId(fullORef.OID),
			WaitMs:  4000,
		}, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			return fmt.Errorf("waiting for AI block: %w", err)
		}
		if !gotRoute {
			return fmt.Errorf("AI block route could not be established")
		}
	} else if err != nil {
		return fmt.Errorf("resolving block: %w", err)
	}

	// Create the route for this block
	route := wshutil.MakeFeBlockRouteId(fullORef.OID)

	// Then handle main message
	if args[0] == "-" {
		if stdinUsed {
			return fmt.Errorf("stdin (-) can only be used once")
		}
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return fmt.Errorf("reading from stdin: %w", err)
		}
		message.Write(data)
		
		// Also include any remaining arguments (excluding the "-" itself)
		if len(args) > 1 {
			if message.Len() > 0 {
				message.WriteString(" ")
			}
			message.WriteString(strings.Join(args[1:], " "))
		}
	} else {
		message.WriteString(strings.Join(args, " "))
	}

	if message.Len() == 0 {
		return fmt.Errorf("message is empty")
	}
	if message.Len() > 50*1024 {
		return fmt.Errorf("current max message size is 50k")
	}

	messageData := wshrpc.AiMessageData{
		Message: message.String(),
	}
	err = wshclient.AiSendMessageCommand(RpcClient, messageData, &wshrpc.RpcOpts{
		Route:   route,
		Timeout: 2000,
	})
	if err != nil {
		return fmt.Errorf("sending message: %w", err)
	}

	return nil
}
