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

var jobDebugTerminateCmdCmd = &cobra.Command{
	Use:   "terminate-cmd",
	Short: "terminate a command process",
	RunE:  jobDebugTerminateCmdRun,
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

var jobDebugGetOutputCmd = &cobra.Command{
	Use:   "getoutput",
	Short: "get the terminal output for a job",
	RunE:  jobDebugGetOutputRun,
}

var jobDebugStartCmd = &cobra.Command{
	Use:   "start",
	Short: "start a new job",
	RunE:  jobDebugStartRun,
}

var jobIdFlag string
var jobDebugJsonFlag bool
var jobConnFlag string
var exitJobIdFlag string
var disconnectJobIdFlag string
var reconnectJobIdFlag string

func init() {
	rootCmd.AddCommand(jobDebugCmd)
	jobDebugCmd.AddCommand(jobDebugListCmd)
	jobDebugCmd.AddCommand(jobDebugDeleteCmd)
	jobDebugCmd.AddCommand(jobDebugDeleteAllCmd)
	jobDebugCmd.AddCommand(jobDebugPruneCmd)
	jobDebugCmd.AddCommand(jobDebugTerminateCmdCmd)
	jobDebugCmd.AddCommand(jobDebugExitCmd)
	jobDebugCmd.AddCommand(jobDebugDisconnectCmd)
	jobDebugCmd.AddCommand(jobDebugReconnectCmd)
	jobDebugCmd.AddCommand(jobDebugGetOutputCmd)
	jobDebugCmd.AddCommand(jobDebugStartCmd)

	jobDebugListCmd.Flags().BoolVar(&jobDebugJsonFlag, "json", false, "output as JSON")

	jobDebugDeleteCmd.Flags().StringVar(&jobIdFlag, "jobid", "", "job id to delete (required)")
	jobDebugDeleteCmd.MarkFlagRequired("jobid")

	jobDebugTerminateCmdCmd.Flags().StringVar(&jobIdFlag, "jobid", "", "job id to terminate (required)")
	jobDebugTerminateCmdCmd.MarkFlagRequired("jobid")

	jobDebugExitCmd.Flags().StringVar(&exitJobIdFlag, "jobid", "", "job id to exit (required)")
	jobDebugExitCmd.MarkFlagRequired("jobid")

	jobDebugDisconnectCmd.Flags().StringVar(&disconnectJobIdFlag, "jobid", "", "job id to disconnect (required)")
	jobDebugDisconnectCmd.MarkFlagRequired("jobid")

	jobDebugReconnectCmd.Flags().StringVar(&reconnectJobIdFlag, "jobid", "", "job id to reconnect (required)")
	jobDebugReconnectCmd.MarkFlagRequired("jobid")

	jobDebugGetOutputCmd.Flags().StringVar(&jobIdFlag, "jobid", "", "job id to get output for (required)")
	jobDebugGetOutputCmd.MarkFlagRequired("jobid")

	jobDebugStartCmd.Flags().StringVar(&jobConnFlag, "conn", "", "connection name (required)")
	jobDebugStartCmd.MarkFlagRequired("conn")
}

func jobDebugListRun(cmd *cobra.Command, args []string) error {
	rtnData, err := wshclient.JobDebugListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
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

	fmt.Printf("%-36s %-20s %-9s %-7s %-30s %-10s %-10s %-8s %s\n", "OID", "Connection", "Connected", "Manager", "Cmd", "Status", "Stream", "ExitCode", "Error")
	for _, job := range rtnData {
		connectedStatus := "no"
		if connectedMap[job.OID] {
			connectedStatus = "yes"
		}

		managerStatus := "no"
		if job.JobManagerRunning {
			managerStatus = "yes"
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
		if job.Status != "running" && job.Status != "init" {
			exitCode = fmt.Sprintf("%d", job.ExitCode)
		}

		errorStr := ""
		if job.StartupError != "" {
			errorStr = fmt.Sprintf("%q", job.StartupError)
		} else if job.ExitError != "" {
			errorStr = fmt.Sprintf("%q", job.ExitError)
		}

		fmt.Printf("%-36s %-20s %-9s %-7s %-30s %-10s %-10s %-8s %s\n",
			job.OID, job.Connection, connectedStatus, managerStatus, job.Cmd, job.Status, streamStatus, exitCode, errorStr)
	}
	return nil
}

func jobDebugDeleteRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobDebugDeleteCommand(RpcClient, jobIdFlag, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("deleting job: %w", err)
	}

	fmt.Printf("Job %s deleted successfully\n", jobIdFlag)
	return nil
}

func jobDebugDeleteAllRun(cmd *cobra.Command, args []string) error {
	rtnData, err := wshclient.JobDebugListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("getting job debug list: %w", err)
	}

	if len(rtnData) == 0 {
		fmt.Printf("No jobs to delete\n")
		return nil
	}

	deletedCount := 0
	for _, job := range rtnData {
		err := wshclient.JobDebugDeleteCommand(RpcClient, job.OID, &wshrpc.RpcOpts{Timeout: 5000})
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
	rtnData, err := wshclient.JobDebugListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("getting job debug list: %w", err)
	}

	if len(rtnData) == 0 {
		fmt.Printf("No jobs to prune\n")
		return nil
	}

	deletedCount := 0
	for _, job := range rtnData {
		if !job.JobManagerRunning {
			err := wshclient.JobDebugDeleteCommand(RpcClient, job.OID, &wshrpc.RpcOpts{Timeout: 5000})
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

func jobDebugTerminateCmdRun(cmd *cobra.Command, args []string) error {
	err := wshclient.JobControllerTerminateJobCommand(RpcClient, jobIdFlag, nil)
	if err != nil {
		return fmt.Errorf("terminating command: %w", err)
	}

	fmt.Printf("Command for %s terminated successfully\n", jobIdFlag)
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
	if len(args) == 0 {
		return fmt.Errorf("no command specified after --")
	}

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
