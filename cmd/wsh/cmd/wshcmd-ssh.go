// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var identityFiles []string

var sshCmd = &cobra.Command{
	Use:     "ssh",
	Short:   "connect this terminal to a remote host",
	Args:    cobra.ExactArgs(1),
	RunE:    sshRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	sshCmd.Flags().StringArrayVarP(&identityFiles, "identityfile", "i", []string{}, "add an identity file for publickey authentication")
	rootCmd.AddCommand(sshCmd)
}

func sshRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("ssh", rtnErr == nil)
	}()

	sshArg := args[0]
	blockId := RpcContext.BlockId
	if blockId == "" {
		return fmt.Errorf("cannot determine blockid (not in JWT)")
	}
	// first, make a connection independent of the block
	connOpts := wshrpc.ConnRequest{
		Host:       sshArg,
		LogBlockId: blockId,
		Keywords: wshrpc.ConnKeywords{
			SshIdentityFile: identityFiles,
		},
	}
	wshclient.ConnConnectCommand(RpcClient, connOpts, &wshrpc.RpcOpts{Timeout: 60000})

	// now, with that made, it will be straightforward to connect
	data := wshrpc.CommandSetMetaData{
		ORef: waveobj.MakeORef(waveobj.OType_Block, blockId),
		Meta: map[string]any{
			waveobj.MetaKey_Connection: sshArg,
		},
	}
	err := wshclient.SetMetaCommand(RpcClient, data, nil)
	if err != nil {
		return fmt.Errorf("setting connection in block: %w", err)
	}
	WriteStderr("switched connection to %q\n", sshArg)
	return nil
}
