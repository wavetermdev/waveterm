// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var sessionCmd = &cobra.Command{
	Use:   "session",
	Short: "manage session daemons",
	Long:  "Commands to create, list, attach to, and manage session daemons for persistent remote shells.",
}

var sessionCreateCmd = &cobra.Command{
	Use:     "create",
	Short:   "create a new session daemon",
	Long:    `Create a named session daemon. Anonymous daemons are created automatically for SSH blocks.`,
	Args:    cobra.NoArgs,
	RunE:    sessionCreateRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionDeleteCmd = &cobra.Command{
	Use:     "delete DAEMONID",
	Short:   "delete a session daemon",
	Long:    `Delete a session daemon, stopping any attached job and detaching all blocks.`,
	Args:    cobra.ExactArgs(1),
	RunE:    sessionDeleteRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list session daemons",
	Long:    `List all named session daemons. Use --all to include anonymous daemons.`,
	Args:    cobra.NoArgs,
	RunE:    sessionListRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionAttachCmd = &cobra.Command{
	Use:     "attach DAEMONID",
	Short:   "attach current block to a session daemon",
	Long:    `Attach the current block to the specified session daemon.`,
	Args:    cobra.ExactArgs(1),
	RunE:    sessionAttachRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionDetachCmd = &cobra.Command{
	Use:     "detach",
	Short:   "detach current block from its session daemon",
	Long:    `Detach the current block from its attached session daemon.`,
	Args:    cobra.NoArgs,
	RunE:    sessionDetachRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionInfoCmd = &cobra.Command{
	Use:     "info DAEMONID",
	Short:   "show session daemon info",
	Long:    `Show detailed information about a session daemon.`,
	Args:    cobra.ExactArgs(1),
	RunE:    sessionInfoRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionTagCmd = &cobra.Command{
	Use:     "tag DAEMONID",
	Short:   "tag an anonymous session daemon with a name",
	Long:    `Convert an anonymous session daemon to a named one, preventing auto-cleanup.`,
	Args:    cobra.ExactArgs(1),
	RunE:    sessionTagRun,
	PreRunE: preRunSetupRpcClient,
}

var sessionCreateFlagName string
var sessionCreateFlagConnection string
var sessionCreateFlagIdleTimeout int64
var sessionListFlagAll bool
var sessionTagFlagName string

func init() {
	rootCmd.AddCommand(sessionCmd)
	sessionCmd.AddCommand(sessionCreateCmd)
	sessionCmd.AddCommand(sessionDeleteCmd)
	sessionCmd.AddCommand(sessionListCmd)
	sessionCmd.AddCommand(sessionAttachCmd)
	sessionCmd.AddCommand(sessionDetachCmd)
	sessionCmd.AddCommand(sessionInfoCmd)
	sessionCmd.AddCommand(sessionTagCmd)

	sessionCreateCmd.Flags().StringVarP(&sessionCreateFlagName, "name", "n", "", "session name (creates a named daemon)")
	sessionCreateCmd.Flags().StringVarP(&sessionCreateFlagConnection, "connection", "c", "", "connection name (e.g. ssh://host)")
	sessionCreateCmd.Flags().Int64Var(&sessionCreateFlagIdleTimeout, "idle-timeout", 0, "idle timeout in seconds (default: 86400 for named, 3600 for anonymous)")

	sessionListCmd.Flags().BoolVarP(&sessionListFlagAll, "all", "a", false, "include anonymous session daemons")

	sessionTagCmd.Flags().StringVarP(&sessionTagFlagName, "name", "n", "", "new name for the session daemon")
	sessionTagCmd.MarkFlagRequired("name")
}

func sessionCreateRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("session:create", rtnErr == nil)
	}()

	data := wshrpc.CommandSessionCreateData{
		Name:        sessionCreateFlagName,
		Connection:  sessionCreateFlagConnection,
		IdleTimeout: sessionCreateFlagIdleTimeout,
	}

	info, err := wshclient.SessionCreateCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("creating session daemon: %w", err)
	}

	WriteStdout("session daemon %s created\n", info.DaemonId)
	WriteStdout("  name:       %s\n", info.Name)
	WriteStdout("  connection: %s\n", info.Connection)
	return nil
}

func sessionDeleteRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("session:delete", rtnErr == nil)
	}()

	daemonId := args[0]
	err := wshclient.SessionDeleteCommand(RpcClient, wshrpc.CommandSessionDeleteData{DaemonId: daemonId}, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("deleting session daemon: %w", err)
	}
	WriteStdout("session daemon %s deleted\n", daemonId)
	return nil
}

func sessionListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("session:list", rtnErr == nil)
	}()

	data := wshrpc.CommandSessionListData{ShowAll: sessionListFlagAll}
	sessions, err := wshclient.SessionListCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("listing session daemons: %w", err)
	}

	if len(sessions) == 0 {
		WriteStdout("no session daemons\n")
		return nil
	}

	WriteStdout("%-36s %-20s %-30s %-12s %s\n", "daemonid", "name", "connection", "status", "blocks")
	WriteStdout("----------------------------------------------------------------------\n")
	for _, s := range sessions {
		blocks := fmt.Sprintf("%d", len(s.Blocks))
		if s.IsAnonymous {
			blocks += " (anon)"
		}
		WriteStdout("%-36s %-20s %-30s %-12s %s\n", s.DaemonId, s.Name, s.Connection, s.Status, blocks)
	}
	return nil
}

func sessionAttachRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("session:attach", rtnErr == nil)
	}()

	daemonId := args[0]
	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}

	data := wshrpc.CommandSessionAttachData{
		DaemonId: daemonId,
		BlockId:  fullORef.OID,
	}
	err = wshclient.SessionAttachCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("attaching block: %w", err)
	}
	WriteStdout("block %s attached to session daemon %s\n", fullORef.OID, daemonId)
	return nil
}

func sessionDetachRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("session:detach", rtnErr == nil)
	}()

	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}
	blockId := fullORef.OID

	info, err := wshclient.BlockInfoCommand(RpcClient, blockId, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("getting block info: %w", err)
	}
	if info.Block == nil {
		return fmt.Errorf("block %s not found", blockId)
	}

	daemonId := info.Block.Meta.GetString(waveobj.MetaKey_SessionDaemonId, "")
	if daemonId == "" {
		return fmt.Errorf("block %s is not attached to any session daemon", blockId)
	}

	err = wshclient.SessionDetachCommand(RpcClient, wshrpc.CommandSessionDetachData{DaemonId: daemonId, BlockId: blockId}, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("detaching block: %w", err)
	}
	WriteStdout("block %s detached from session daemon %s\n", blockId, daemonId)
	return nil
}

func sessionInfoRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("session:info", rtnErr == nil)
	}()

	daemonId := args[0]
	info, err := wshclient.SessionInfoCommand(RpcClient, wshrpc.CommandSessionInfoData{DaemonId: daemonId}, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("getting session info: %w", err)
	}

	createdAt := time.UnixMilli(info.CreatedAt).Format("2006-01-02 15:04:05")
	WriteStdout("daemonid:    %s\n", info.DaemonId)
	WriteStdout("name:        %s\n", info.Name)
	WriteStdout("connection:  %s\n", info.Connection)
	WriteStdout("jobid:       %s\n", info.JobId)
	WriteStdout("status:      %s\n", info.Status)
	WriteStdout("anonymous:   %v\n", info.IsAnonymous)
	WriteStdout("created:     %s\n", createdAt)
	WriteStdout("timeout:     %ds\n", info.IdleTimeout)
	if info.IdleSince > 0 {
		WriteStdout("idle since:  %s\n", time.UnixMilli(info.IdleSince).Format("2006-01-02 15:04:05"))
	}
	WriteStdout("blocks:      %d\n", len(info.Blocks))
	for _, b := range info.Blocks {
		WriteStdout("  - %s\n", b)
	}
	return nil
}

func sessionTagRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("session:tag", rtnErr == nil)
	}()

	daemonId := args[0]
	data := wshrpc.CommandSessionTagData{
		DaemonId: daemonId,
		Name:     sessionTagFlagName,
	}

	err := wshclient.SessionTagCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("tagging session daemon: %w", err)
	}
	WriteStdout("session daemon %s tagged as %q\n", daemonId, sessionTagFlagName)
	return nil
}
