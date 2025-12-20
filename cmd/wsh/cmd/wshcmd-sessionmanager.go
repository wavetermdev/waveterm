// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/sessionmanager"
)

var sessionManagerCmd = &cobra.Command{
	Use:    "sessionmanager",
	Hidden: true,
	Short:  "run a session manager server on a domain socket",
	Args:   cobra.NoArgs,
	RunE:   sessionManagerRun,
}

var sessionId string

func init() {
	sessionManagerCmd.Flags().StringVar(&sessionId, "id", "", "session id (uuid)")
	sessionManagerCmd.MarkFlagRequired("id")
	rootCmd.AddCommand(sessionManagerCmd)
}

func sessionManagerRun(cmd *cobra.Command, args []string) error {
	_, err := uuid.Parse(sessionId)
	if err != nil {
		return fmt.Errorf("invalid session id (must be uuid): %v", err)
	}

	clientId := os.Getenv("WAVETERM_CLIENTID")
	if clientId == "" {
		return fmt.Errorf("WAVETERM_CLIENTID environment variable not set")
	}

	_, err = uuid.Parse(clientId)
	if err != nil {
		return fmt.Errorf("invalid WAVETERM_CLIENTID (must be uuid): %v", err)
	}

	authToken, err := readAuthToken(2 * time.Second)
	if err != nil {
		return fmt.Errorf("failed to read auth token: %v", err)
	}

	return sessionmanager.RunSessionManager(clientId, sessionId, authToken)
}

func readAuthToken(timeout time.Duration) (string, error) {
	type result struct {
		token string
		err   error
	}

	resultChan := make(chan result, 1)

	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		if scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "AUTHKEY: ") {
				token := strings.TrimPrefix(line, "AUTHKEY: ")
				resultChan <- result{token: token, err: nil}
				return
			}
			resultChan <- result{err: fmt.Errorf("invalid authkey format, expected 'AUTHKEY: <token>'")}
			return
		}
		if err := scanner.Err(); err != nil {
			resultChan <- result{err: fmt.Errorf("error reading from stdin: %v", err)}
			return
		}
		resultChan <- result{err: fmt.Errorf("no input received from stdin")}
	}()

	select {
	case res := <-resultChan:
		return res.token, res.err
	case <-time.After(timeout):
		return "", fmt.Errorf("timeout reading authkey from stdin after %v", timeout)
	}
}
