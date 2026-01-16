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

var jobDebugExitCmd = &cobra.Command{
	Use:   "exit",
	Short: "exit a job manager",
	RunE:  jobDebugExitRun,
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

func init() {
	rootCmd.AddCommand(jobDebugCmd)
	jobDebugCmd.AddCommand(jobDebugListCmd)
	jobDebugCmd.AddCommand(jobDebugDeleteCmd)
	jobDebugCmd.AddCommand(jobDebugDeleteAllCmd)
	jobDebugCmd.AddCommand(jobDebugTerminateCmdCmd)
	jobDebugCmd.AddCommand(jobDebugExitCmd)
	jobDebugCmd.AddCommand(jobDebugGetOutputCmd)
	jobDebugCmd.AddCommand(jobDebugStartCmd)

	jobDebugListCmd.Flags().BoolVar(&jobDebugJsonFlag, "json", false, "output as JSON")

	jobDebugDeleteCmd.Flags().StringVar(&jobIdFlag, "jobid", "", "job id to delete (required)")
	jobDebugDeleteCmd.MarkFlagRequired("jobid")

	jobDebugTerminateCmdCmd.Flags().StringVar(&jobIdFlag, "jobid", "", "job id to terminate (required)")
	jobDebugTerminateCmdCmd.MarkFlagRequired("jobid")

	jobDebugExitCmd.Flags().StringVar(&exitJobIdFlag, "jobid", "", "job id to exit (required)")
	jobDebugExitCmd.MarkFlagRequired("jobid")

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

	if jobDebugJsonFlag {
		jsonData, err := json.MarshalIndent(rtnData, "", "  ")
		if err != nil {
			return fmt.Errorf("marshaling json: %w", err)
		}
		fmt.Printf("%s\n", string(jsonData))
		return nil
	}

	fmt.Printf("%-36s %-20s %-30s %-10s %-10s %-8s %s\n", "OID", "Connection", "Cmd", "Status", "Stream", "ExitCode", "Error")
	for _, job := range rtnData {
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
		if job.Error != "" {
			errorStr = fmt.Sprintf("%q", job.Error)
		}

		fmt.Printf("%-36s %-20s %-30s %-10s %-10s %-8s %s\n",
			job.OID, job.Connection, job.Cmd, job.Status, streamStatus, exitCode, errorStr)
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
