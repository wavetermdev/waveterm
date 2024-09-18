// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var connCmd = &cobra.Command{
	Use:     "conn [status|reinstall|disconnect|connect|ensure] [connection-name]",
	Short:   "implements connection commands",
	Args:    cobra.RangeArgs(1, 2),
	RunE:    connRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(connCmd)
}

func connStatus() error {
	resp, err := wshclient.ConnStatusCommand(RpcClient, nil)
	if err != nil {
		return fmt.Errorf("getting connection status: %w", err)
	}
	if len(resp) == 0 {
		WriteStdout("no connections\n")
		return nil
	}
	WriteStdout("%-30s %-12s\n", "connection", "status")
	WriteStdout("----------------------------------------------\n")
	for _, conn := range resp {
		str := fmt.Sprintf("%-30s %-12s", conn.Connection, conn.Status)
		if conn.Error != "" {
			str += fmt.Sprintf(" (%s)", conn.Error)
		}
		str += "\n"
		WriteStdout("%s\n", str)
	}
	return nil
}

func connDisconnectAll() error {
	resp, err := wshclient.ConnStatusCommand(RpcClient, nil)
	if err != nil {
		return fmt.Errorf("getting connection status: %w", err)
	}
	if len(resp) == 0 {
		return nil
	}
	for _, conn := range resp {
		if conn.Status == "connected" {
			err := connDisconnect(conn.Connection)
			if err != nil {
				WriteStdout("error disconnecting %q: %v\n", conn.Connection, err)
			}
		}
	}
	return nil
}

func connEnsure(connName string) error {
	err := wshclient.ConnEnsureCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("ensuring connection: %w", err)
	}
	WriteStdout("wsh ensured on connection %q\n", connName)
	return nil
}

func connReinstall(connName string) error {
	err := wshclient.ConnReinstallWshCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("reinstalling connection: %w", err)
	}
	WriteStdout("wsh reinstalled on connection %q\n", connName)
	return nil
}

func connDisconnect(connName string) error {
	err := wshclient.ConnDisconnectCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("disconnecting %q error: %w", connName, err)
	}
	WriteStdout("disconnected %q\n", connName)
	return nil
}

func connConnect(connName string) error {
	err := wshclient.ConnConnectCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("connecting connection: %w", err)
	}
	WriteStdout("connected connection %q\n", connName)
	return nil
}

func connRun(cmd *cobra.Command, args []string) error {
	connCmd := args[0]
	var connName string
	if connCmd != "status" && connCmd != "disconnectall" {
		if len(args) < 2 {
			return fmt.Errorf("connection name is required %q", connCmd)
		}
		connName = args[1]
		_, err := remote.ParseOpts(connName)
		if err != nil {
			return fmt.Errorf("cannot parse connection name: %w", err)
		}
	}
	if connCmd == "status" {
		return connStatus()
	} else if connCmd == "ensure" {
		return connEnsure(connName)
	} else if connCmd == "reinstall" {
		return connReinstall(connName)
	} else if connCmd == "disconnect" {
		return connDisconnect(connName)
	} else if connCmd == "disconnectall" {
		return connDisconnectAll()
	} else if connCmd == "connect" {
		return connConnect(connName)
	} else {
		return fmt.Errorf("unknown command %q", connCmd)
	}
}
