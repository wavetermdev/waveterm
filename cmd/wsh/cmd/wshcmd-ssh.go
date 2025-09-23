// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var (
	identityFiles []string
	newBlock      bool
)

var sshCmd = &cobra.Command{
	Use:     "ssh",
	Short:   "connect this terminal to a remote host",
	Args:    cobra.ExactArgs(1),
	RunE:    sshRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	sshCmd.Flags().StringArrayVarP(&identityFiles, "identityfile", "i", []string{}, "add an identity file for publickey authentication")
	sshCmd.Flags().BoolVarP(&newBlock, "new", "n", false, "create a new terminal block with this connection")
	rootCmd.AddCommand(sshCmd)
}

func sshRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("ssh", rtnErr == nil)
	}()

	sshArg := args[0]
	blockId := RpcContext.BlockId
	if blockId == "" && !newBlock {
		return fmt.Errorf("cannot determine blockid (not in JWT)")
	}

	// Create connection request
	connOpts := wshrpc.ConnRequest{
		Host:       sshArg,
		LogBlockId: blockId,
		Keywords: wconfig.ConnKeywords{
			SshIdentityFile: identityFiles,
		},
	}
	wshclient.ConnConnectCommand(RpcClient, connOpts, &wshrpc.RpcOpts{Timeout: 60000})

	if newBlock {
		// Create a new block with the SSH connection
		createMeta := map[string]any{
			waveobj.MetaKey_View:       "term",
			waveobj.MetaKey_Controller: "shell",
			waveobj.MetaKey_Connection: sshArg,
		}
		if RpcContext.Conn != "" {
			createMeta[waveobj.MetaKey_Connection] = RpcContext.Conn
		}
		createBlockData := wshrpc.CommandCreateBlockData{
			BlockDef: &waveobj.BlockDef{
				Meta: createMeta,
			},
		}
		oref, err := wshclient.CreateBlockCommand(RpcClient, createBlockData, nil)
		if err != nil {
			return fmt.Errorf("creating new terminal block: %w", err)
		}
		WriteStdout("new terminal block created with connection to %q: %s\n", sshArg, oref)
		return nil
	}

	// Update existing block with the new connection
	data := wshrpc.CommandSetMetaData{
		ORef: waveobj.MakeORef(waveobj.OType_Block, blockId),
		Meta: map[string]any{
			waveobj.MetaKey_Connection: sshArg,
			waveobj.MetaKey_CmdCwd:     nil,
		},
	}
	err := wshclient.SetMetaCommand(RpcClient, data, nil)
	if err != nil {
		return fmt.Errorf("setting connection in block: %w", err)
	}
	
	// Clear the cmd:hascurcwd rtinfo field
	rtInfoData := wshrpc.CommandSetRTInfoData{
		ORef: waveobj.MakeORef(waveobj.OType_Block, blockId),
		Data: map[string]any{
			"cmd:hascurcwd": nil,
		},
	}
	err = wshclient.SetRTInfoCommand(RpcClient, rtInfoData, nil)
	if err != nil {
		return fmt.Errorf("setting RTInfo in block: %w", err)
	}
	WriteStderr("switched connection to %q\n", sshArg)
	return nil
}
