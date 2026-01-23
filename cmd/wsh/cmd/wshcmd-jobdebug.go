// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var jobDebugCmd = &cobra.Command{
	Use:               "jobdebug",
	Short:             "debugging commands for the job system",
	Hidden:            true,
	PersistentPreRunE: preRunSetupRpcClient,
}

var jobDebugListCmd = &cobra.Command{
	Use:   "list",
	Short: "list all jobs with debug information",
	RunE:  jobDebugListRun,
}

var jobDebugDeleteCmd = &cobra.Command{
	Use:   "delete",
	Short: "delete a job entry by jobid",
	RunE:  jobDebugDeleteRun,
}

var jobDebugDeleteAllCmd = &cobra.Command{
	Use:   "deleteall",
	Short: "delete all jobs",
	RunE:  jobDebugDeleteAllRun,
}

var jobDebugPruneCmd = &cobra.Command{
	Use:   "prune",
	Short: "remove jobs where the job manager is no longer running",
	RunE:  jobDebugPruneRun,
}

var jobDebugExitCmd = &cobra.Command{
	Use:   "exit",
	Short: "exit a job manager",
	RunE:  jobDebugExitRun,
}

var jobDebugDisconnectCmd = &cobra.Command{
	Use:   "disconnect",
	Short: "disconnect from a job manager",
	RunE:  jobDebugDisconnectRun,
}

var jobDebugReconnectCmd = &cobra.Command{
	Use:   "reconnect",
	Short: "reconnect to a job manager",
	RunE:  jobDebugReconnectRun,
}

var jobDebugReconnectConnCmd = &cobra.Command{
	Use:   "reconnectconn",
	Short: "reconnect all jobs for a connection",
	RunE:  jobDebugReconnectConnRun,
}

var jobDebugGetOutputCmd = &cobra.Command{
	Use:   "getoutput",
	Short: "get the terminal output for a job",
	RunE:  jobDebugGetOutputRun,
}

var jobDebugStartCmd = &cobra.Command{
	Use:   "start",
	Short: "start a new job",
	Args:  cobra.MinimumNArgs(1),
	RunE:  jobDebugStartRun,
}

var jobDebugAttachJobCmd = &cobra.Command{
	Use:   "attachjob",
	Short: "attach a job to a block",
	RunE:  jobDebugAttachJobRun,
}

var jobDebugDetachJobCmd = &cobra.Command{
	Use:   "detachjob",
	Short: "detach a job from its block",
	RunE:  jobDebugDetachJobRun,
}

var jobIdFlag string
var jobDebugJsonFlag bool
var jobConnFlag string
var exitJobIdFlag string
var disconnectJobIdFlag string
var reconnectJobIdFlag string
var reconnectConnNameFlag string
var attachJobIdFlag string
var attachBlockIdFlag string
var detachJobIdFlag string

func init() {
	rootCmd.AddCommand(jobDebugCmd)
	jobDebugCmd.AddCommand(jobDebugListCmd)
	jobDebugCmd.AddCommand(jobDebugDeleteCmd)
	jobDebugCmd.AddCommand(jobDebugDeleteAllCmd)
	jobDebugCmd.AddCommand(jobDebugPruneCmd)
	jobDebugCmd.AddCommand(jobDebugExitCmd)
	jobDebugCmd.AddCommand(jobDebugDisconnectCmd)
	jobDebugCmd.AddCommand(jobDebugReconnectCmd)
	jobDebugCmd.AddCommand(jobDebugReconnectConnCmd)
	jobDebugCmd.AddCommand(jobDebugGetOutputCmd)
	jobDebugCmd.AddCommand(jobDebugStartCmd)
	jobDebugCmd.AddCommand(jobDebugAttachJobCmd)
	jobDebugCmd.AddCommand(jobDebugDetachJobCmd)

	jobDebugListCmd.Flags().BoolVar(&jobDebugJsonFlag, "json", false, "output as JSON")

	jobDebugDeleteCmd.Flags().StringVar(&jobIdFlag, "jobid", "", "job id to delete (required)")
	jobDebugDeleteCmd.MarkFlagRequired("jobid")

	jobDebugExitCmd.Flags().StringVar(&exitJobIdFlag, "jobid", "", "job id to exit (required)")
	jobDebugExitCmd.MarkFlagRequired("jobid")

	jobDebugDisconnectCmd.Flags().StringVar(&disconnectJobIdFlag, "jobid", "", "job id to disconnect (required)")
	jobDebugDisconnectCmd.MarkFlagRequired("jobid")

	jobDebugReconnectCmd.Flags().StringVar(&reconnectJobIdFlag, "jobid", "", "job id to reconnect (required)")
	jobDebugReconnectCmd.MarkFlagRequired("jobid")

	jobDebugReconnectConnCmd.Flags().StringVar(&reconnectConnNameFlag, "conn", "", "connection name (required)")
	jobDebugReconnectConnCmd.MarkFlagRequired("conn")

	jobDebugGetOutputCmd.Flags().StringVar(&jobIdFlag, "jobid", "", "job id to get output for (required)")
	jobDebugGetOutputCmd.MarkFlagRequired("jobid")

	jobDebugStartCmd.Flags().StringVar(&jobConnFlag, "conn", "", "connection name (required)")
	jobDebugStartCmd.MarkFlagRequired("conn")

	jobDebugAttachJobCmd.Flags().StringVar(&attachJobIdFlag, "jobid", "", "job id to attach (required)")
	jobDebugAttachJobCmd.MarkFlagRequired("jobid")
	jobDebugAttachJobCmd.Flags().StringVar(&attachBlockIdFlag, "blockid", "", "block id to attach to (required)")
	jobDebugAttachJobCmd.MarkFlagRequired("blockid")

	jobDebugDetachJobCmd.Flags().StringVar(&detachJobIdFlag, "jobid", "", "job id to detach (required)")
	jobDebugDetachJobCmd.MarkFlagRequired("jobid")
}

func jobDebugListRun(cmd *cobra.Command, args []string) error {
	rtnData, err := wshclient.JobControllerListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("getting job debug list: %w", err)
	}

	connectedJobIds, err := wshclient.JobControllerConnectedJobsCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("getting connected job ids: %w", err)
	}

	connectedMap := make(map[string]bool)
	for _, jobId := range connectedJobIds {
		connectedMap[jobId] = true
	}

	if jobDebugJsonFlag {
		jsonData, err := json.MarshalIndent(rtnData, "", "  ")
		if err != nil {
			return fmt.Errorf("marshaling json: %w", err)
		}
		fmt.Printf("%s\n", string(jsonData))
		return nil
	}

	fmt.Printf("%-36s %-20s %-9s %-10s %-6s %-30s %-8s %-10s\n", "OID", "Connection", "Connected", "Manager", "Reason", "Cmd", "ExitCode", "Stream")
	for _, job := range rtnData {
		connectedStatus := "no"
		if connectedMap[job.OID] {
			connectedStatus = "yes"
		}

		streamStatus := "-"
		if job.StreamDone {
			if job.StreamError == "" {
				streamStatus = "EOF"
			} else {
				streamStatus = fmt.Sprintf("%q", job.StreamError)
			}
		}

		exitCode := "-"
		if job.CmdExitTs > 0 {
			if job.CmdExitCode != nil {
				exitCode = fmt.Sprintf("%d", *job.CmdExitCode)
			} else if job.CmdExitSignal != "" {
				exitCode = job.CmdExitSignal
			} else {
				exitCode = "?"
			}
		}

		doneReason := "-"
		if job.JobManagerDoneReason == "startuperror" {
			doneReason = "serr"
		} else if job.JobManagerDoneReason == "gone" {
			doneReason = "gone"
		} else if job.JobManagerDoneReason == "terminated" {
			doneReason = "term"
		}

		fmt.Printf("%-36s %-20s %-9s %-10s %-6s %-30s %-8s %-10s\n",
			job.OID, job.Connection, connectedStatus, job.JobManagerStatus, doneReason, job.Cmd, exitCode, streamStatus)
	}
	return nil
}

func jobDebugDeleteRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobControllerDeleteJobCommand(RpcClient, jobIdFlag, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("deleting job: %w", err)
	}

	fmt.Printf("Job %s deleted successfully\n", jobIdFlag)
	return nil
}

func jobDebugDeleteAllRun(cmd *cobra.Command, args []string) error {
	rtnData, err := wshclient.JobControllerListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("getting job debug list: %w", err)
	}

	if len(rtnData) == 0 {
		fmt.Printf("No jobs to delete\n")
		return nil
	}

	deletedCount := 0
	for _, job := range rtnData {
		err := wshclient.JobControllerDeleteJobCommand(RpcClient, job.OID, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			fmt.Printf("Error deleting job %s: %v\n", job.OID, err)
		} else {
			deletedCount++
		}
	}

	fmt.Printf("Deleted %d of %d job(s)\n", deletedCount, len(rtnData))
	return nil
}

func jobDebugPruneRun(cmd *cobra.Command, args []string) error {
	rtnData, err := wshclient.JobControllerListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("getting job debug list: %w", err)
	}

	if len(rtnData) == 0 {
		fmt.Printf("No jobs to prune\n")
		return nil
	}

	deletedCount := 0
	for _, job := range rtnData {
		if job.JobManagerStatus != "running" {
			err := wshclient.JobControllerDeleteJobCommand(RpcClient, job.OID, &wshrpc.RpcOpts{Timeout: 5000})
			if err != nil {
				fmt.Printf("Error deleting job %s: %v\n", job.OID, err)
			} else {
				deletedCount++
			}
		}
	}

	if deletedCount == 0 {
		fmt.Printf("No jobs with stopped job managers to prune\n")
	} else {
		fmt.Printf("Pruned %d job(s) with stopped job managers\n", deletedCount)
	}
	return nil
}

func jobDebugExitRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobControllerExitJobCommand(RpcClient, exitJobIdFlag, nil)
	if err != nil {
		return fmt.Errorf("exiting job manager: %w", err)
	}

	fmt.Printf("Job manager for %s exited successfully\n", exitJobIdFlag)
	return nil
}

func jobDebugDisconnectRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobControllerDisconnectJobCommand(RpcClient, disconnectJobIdFlag, nil)
	if err != nil {
		return fmt.Errorf("disconnecting from job manager: %w", err)
	}

	fmt.Printf("Disconnected from job manager for %s successfully\n", disconnectJobIdFlag)
	return nil
}

func jobDebugReconnectRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobControllerReconnectJobCommand(RpcClient, reconnectJobIdFlag, nil)
	if err != nil {
		return fmt.Errorf("reconnecting to job manager: %w", err)
	}

	fmt.Printf("Reconnected to job manager for %s successfully\n", reconnectJobIdFlag)
	return nil
}

func jobDebugReconnectConnRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobControllerReconnectJobsForConnCommand(RpcClient, reconnectConnNameFlag, nil)
	if err != nil {
		return fmt.Errorf("reconnecting jobs for connection: %w", err)
	}

	fmt.Printf("Reconnected all jobs for connection %s successfully\n", reconnectConnNameFlag)
	return nil
}

func jobDebugGetOutputRun(cmd *cobra.Command, args []string) error {
	fileData, err := wshclient.FileReadCommand(RpcClient, wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: fmt.Sprintf("wavefile://%s/term", jobIdFlag),
		},
	}, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("reading job output: %w", err)
	}

	if fileData.Data64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(fileData.Data64)
		if err != nil {
			return fmt.Errorf("decoding output data: %w", err)
		}
		fmt.Printf("%s", string(decoded))
	}
	return nil
}

func jobDebugStartRun(cmd *cobra.Command, args []string) error {
	cmdToRun := args[0]
	cmdArgs := args[1:]

	data := wshrpc.CommandJobControllerStartJobData{
		ConnName: jobConnFlag,
		Cmd:      cmdToRun,
		Args:     cmdArgs,
		Env:      make(map[string]string),
		TermSize: nil,
	}

	jobId, err := wshclient.JobControllerStartJobCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("starting job: %w", err)
	}

	fmt.Printf("Job started successfully with ID: %s\n", jobId)
	return nil
}

func jobDebugAttachJobRun(cmd *cobra.Command, args []string) error {
	data := wshrpc.CommandJobControllerAttachJobData{
		JobId:   attachJobIdFlag,
		BlockId: attachBlockIdFlag,
	}

	err := wshclient.JobControllerAttachJobCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("attaching job: %w", err)
	}

	fmt.Printf("Job %s attached to block %s successfully\n", attachJobIdFlag, attachBlockIdFlag)
	return nil
}

func jobDebugDetachJobRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobControllerDetachJobCommand(RpcClient, detachJobIdFlag, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("detaching job: %w", err)
	}

	fmt.Printf("Job %s detached successfully\n", detachJobIdFlag)
	return nil
}
