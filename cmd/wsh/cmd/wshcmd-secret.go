// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// secretNameRegex must match the validation in pkg/wconfig/secretstore.go
var secretNameRegex = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*$`)

var secretCmd = &cobra.Command{
	Use:   "secret",
	Short: "manage secrets",
	Long:  "Manage secrets for Wave Terminal",
}

var secretGetCmd = &cobra.Command{
	Use:     "get [name]",
	Short:   "get a secret value",
	Args:    cobra.ExactArgs(1),
	RunE:    secretGetRun,
	PreRunE: preRunSetupRpcClient,
}

var secretSetCmd = &cobra.Command{
	Use:     "set [name]=[value]",
	Short:   "set a secret value",
	Args:    cobra.ExactArgs(1),
	RunE:    secretSetRun,
	PreRunE: preRunSetupRpcClient,
}

var secretListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list all secret names",
	Args:    cobra.NoArgs,
	RunE:    secretListRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(secretCmd)
	secretCmd.AddCommand(secretGetCmd)
	secretCmd.AddCommand(secretSetCmd)
	secretCmd.AddCommand(secretListCmd)
}

func secretGetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("secret", rtnErr == nil)
	}()

	name := args[0]
	if !secretNameRegex.MatchString(name) {
		return fmt.Errorf("invalid secret name: must start with a letter and contain only letters, numbers, and underscores")
	}

	resp, err := wshclient.GetSecretsCommand(RpcClient, []string{name}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting secret: %w", err)
	}

	value, ok := resp[name]
	if !ok {
		return fmt.Errorf("secret not found: %s", name)
	}

	WriteStdout("%s\n", value)
	return nil
}

func secretSetRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("secret", rtnErr == nil)
	}()

	parts := strings.SplitN(args[0], "=", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid format: expected [name]=[value]")
	}

	name := parts[0]
	value := parts[1]

	if name == "" {
		return fmt.Errorf("secret name cannot be empty")
	}

	backend, err := wshclient.GetSecretsLinuxStorageBackendCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("checking secret storage backend: %w", err)
	}

	if backend == "basic_text" || backend == "unknown" {
		return fmt.Errorf("No appropriate secret manager found, cannot set secrets")
	}

	secrets := map[string]string{name: value}
	err = wshclient.SetSecretsCommand(RpcClient, secrets, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("setting secret: %w", err)
	}

	WriteStdout("secret set: %s\n", name)
	return nil
}

func secretListRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("secret", rtnErr == nil)
	}()

	names, err := wshclient.GetSecretsNamesCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("listing secrets: %w", err)
	}

	for _, name := range names {
		WriteStdout("%s\n", name)
	}
	return nil
}