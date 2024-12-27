// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var connCmd = &cobra.Command{
	Use:   "conn",
	Short: "manage Wave Terminal connections",
	Long:  "Commands to manage Wave Terminal SSH and WSL connections",
}

var connStatusCmd = &cobra.Command{
	Use:     "status",
	Short:   "show status of all connections",
	Args:    cobra.NoArgs,
	RunE:    connStatusRun,
	PreRunE: preRunSetupRpcClient,
}

var connReinstallCmd = &cobra.Command{
	Use:     "reinstall CONNECTION",
	Short:   "reinstall wsh on a connection",
	Args:    cobra.ExactArgs(1),
	RunE:    connReinstallRun,
	PreRunE: preRunSetupRpcClient,
}

var connDisconnectCmd = &cobra.Command{
	Use:     "disconnect CONNECTION",
	Short:   "disconnect a connection",
	Args:    cobra.ExactArgs(1),
	RunE:    connDisconnectRun,
	PreRunE: preRunSetupRpcClient,
}

var connDisconnectAllCmd = &cobra.Command{
	Use:     "disconnectall",
	Short:   "disconnect all connections",
	Args:    cobra.NoArgs,
	RunE:    connDisconnectAllRun,
	PreRunE: preRunSetupRpcClient,
}

var connConnectCmd = &cobra.Command{
	Use:     "connect CONNECTION",
	Short:   "connect to a connection",
	Args:    cobra.ExactArgs(1),
	RunE:    connConnectRun,
	PreRunE: preRunSetupRpcClient,
}

var connEnsureCmd = &cobra.Command{
	Use:     "ensure CONNECTION",
	Short:   "ensure wsh is installed on a connection",
	Args:    cobra.ExactArgs(1),
	RunE:    connEnsureRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(connCmd)
	connCmd.AddCommand(connStatusCmd)
	connCmd.AddCommand(connReinstallCmd)
	connCmd.AddCommand(connDisconnectCmd)
	connCmd.AddCommand(connDisconnectAllCmd)
	connCmd.AddCommand(connConnectCmd)
	connCmd.AddCommand(connEnsureCmd)
}

func validateConnectionName(name string) error {
	if !strings.HasPrefix(name, "wsl://") {
		_, err := remote.ParseOpts(name)
		if err != nil {
			return fmt.Errorf("cannot parse connection name: %w", err)
		}
	}
	return nil
}

func getAllConnStatus() ([]wshrpc.ConnStatus, error) {
	var allResp []wshrpc.ConnStatus
	sshResp, err := wshclient.ConnStatusCommand(RpcClient, nil)
	if err != nil {
		return nil, fmt.Errorf("getting ssh connection status: %w", err)
	}
	allResp = append(allResp, sshResp...)
	wslResp, err := wshclient.WslStatusCommand(RpcClient, nil)
	if err != nil {
		return nil, fmt.Errorf("getting wsl connection status: %w", err)
	}
	allResp = append(allResp, wslResp...)
	return allResp, nil
}

func connStatusRun(cmd *cobra.Command, args []string) error {
	allResp, err := getAllConnStatus()
	if err != nil {
		return err
	}
	if len(allResp) == 0 {
		WriteStdout("no connections\n")
		return nil
	}
	WriteStdout("%-30s %-12s\n", "connection", "status")
	WriteStdout("----------------------------------------------\n")
	for _, conn := range allResp {
		str := fmt.Sprintf("%-30s %-12s", conn.Connection, conn.Status)
		if conn.Error != "" {
			str += fmt.Sprintf(" (%s)", conn.Error)
		}
		WriteStdout("%s\n", str)
	}
	return nil
}

func connReinstallRun(cmd *cobra.Command, args []string) error {
	connName := args[0]
	if err := validateConnectionName(connName); err != nil {
		return err
	}
	err := wshclient.ConnReinstallWshCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("reinstalling connection: %w", err)
	}
	WriteStdout("wsh reinstalled on connection %q\n", connName)
	return nil
}

func connDisconnectRun(cmd *cobra.Command, args []string) error {
	connName := args[0]
	if err := validateConnectionName(connName); err != nil {
		return err
	}
	err := wshclient.ConnDisconnectCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("disconnecting %q error: %w", connName, err)
	}
	WriteStdout("disconnected %q\n", connName)
	return nil
}

func connDisconnectAllRun(cmd *cobra.Command, args []string) error {
	allConns, err := getAllConnStatus()
	if err != nil {
		return err
	}
	for _, conn := range allConns {
		if conn.Status != "connected" {
			continue
		}
		err := wshclient.ConnDisconnectCommand(RpcClient, conn.Connection, &wshrpc.RpcOpts{Timeout: 10000})
		if err != nil {
			WriteStdout("error disconnecting %q: %v\n", conn.Connection, err)
		} else {
			WriteStdout("disconnected %q\n", conn.Connection)
		}
	}
	return nil
}

func connConnectRun(cmd *cobra.Command, args []string) error {
	connName := args[0]
	if err := validateConnectionName(connName); err != nil {
		return err
	}
	err := wshclient.ConnConnectCommand(RpcClient, wshrpc.ConnRequest{Host: connName}, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("connecting connection: %w", err)
	}
	WriteStdout("connected connection %q\n", connName)
	return nil
}

func connEnsureRun(cmd *cobra.Command, args []string) error {
	connName := args[0]
	if err := validateConnectionName(connName); err != nil {
		return err
	}
	err := wshclient.ConnEnsureCommand(RpcClient, connName, &wshrpc.RpcOpts{Timeout: 60000})
	if err != nil {
		return fmt.Errorf("ensuring connection: %w", err)
	}
	WriteStdout("wsh ensured on connection %q\n", connName)
	return nil
}
