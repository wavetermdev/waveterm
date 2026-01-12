// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/jobmanager"
)

var jobManagerCmd = &cobra.Command{
	Use:    "jobmanager",
	Hidden: true,
	Short:  "job manager for wave terminal",
	Args:   cobra.NoArgs,
	RunE:   jobManagerRun,
}

var jobManagerJobId string
var jobManagerClientId string

func init() {
	jobManagerCmd.Flags().StringVar(&jobManagerJobId, "jobid", "", "job ID (UUID, required)")
	jobManagerCmd.Flags().StringVar(&jobManagerClientId, "clientid", "", "client ID (UUID, required)")
	jobManagerCmd.MarkFlagRequired("jobid")
	jobManagerCmd.MarkFlagRequired("clientid")
	rootCmd.AddCommand(jobManagerCmd)
}

func jobManagerRun(cmd *cobra.Command, args []string) error {
	_, err := uuid.Parse(jobManagerJobId)
	if err != nil {
		return fmt.Errorf("invalid jobid: must be a valid UUID")
	}

	_, err = uuid.Parse(jobManagerClientId)
	if err != nil {
		return fmt.Errorf("invalid clientid: must be a valid UUID")
	}

	publicKeyB64 := os.Getenv("WAVETERM_PUBLICKEY")
	if publicKeyB64 == "" {
		return fmt.Errorf("WAVETERM_PUBLICKEY environment variable is not set")
	}

	publicKeyBytes, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		return fmt.Errorf("failed to decode WAVETERM_PUBLICKEY: %v", err)
	}

	err = jobmanager.SetupJobManager(jobManagerClientId, jobManagerJobId, publicKeyBytes)
	if err != nil {
		return fmt.Errorf("error setting up job manager: %v", err)
	}

	select {}
}
