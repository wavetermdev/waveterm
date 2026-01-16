// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"

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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	jobAuthToken, err := readJobAuthToken(ctx)
	if err != nil {
		return fmt.Errorf("failed to read job auth token: %v", err)
	}

	readyFile := os.NewFile(3, "ready-pipe")
	if readyFile == nil {
		return fmt.Errorf("ready pipe (fd 3) not available")
	}

	err = jobmanager.SetupJobManager(jobManagerClientId, jobManagerJobId, publicKeyBytes, jobAuthToken, readyFile)
	if err != nil {
		return fmt.Errorf("error setting up job manager: %v", err)
	}

	select {}
}

func readJobAuthToken(ctx context.Context) (string, error) {
	resultCh := make(chan string, 1)
	errorCh := make(chan error, 1)

	go func() {
		reader := bufio.NewReader(os.Stdin)
		line, err := reader.ReadString('\n')
		if err != nil {
			errorCh <- fmt.Errorf("error reading from stdin: %v", err)
			return
		}

		line = strings.TrimSpace(line)
		prefix := jobmanager.JobAccessTokenLabel + ":"
		if !strings.HasPrefix(line, prefix) {
			errorCh <- fmt.Errorf("invalid token format: expected '%s'", prefix)
			return
		}

		token := strings.TrimPrefix(line, prefix)
		token = strings.TrimSpace(token)
		if token == "" {
			errorCh <- fmt.Errorf("empty job auth token")
			return
		}

		resultCh <- token
	}()

	select {
	case token := <-resultCh:
		return token, nil
	case err := <-errorCh:
		return "", err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
