// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// generic connection code (WSL + SSH)
package genconn

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/syncbuf"
)

type CommandSpec struct {
	Cmd string
	Env map[string]string
	Cwd string
}

type ShellClient interface {
	MakeProcessController(cmd CommandSpec) (ShellProcessController, error)
}

type ShellProcessController interface {
	Start() error
	Wait() error
	Kill()

	// these are not required to be called, if they are not called, the impl will set to discard output
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.Reader, error)
	StderrPipe() (io.Reader, error)
}

func RunSimpleCommand(ctx context.Context, client ShellClient, spec CommandSpec) (string, string, error) {
	proc, err := client.MakeProcessController(spec)
	if err != nil {
		return "", "", fmt.Errorf("failed to create process controller: %w", err)
	}

	stdout, err := proc.StdoutPipe()
	if err != nil {
		return "", "", fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	stderr, err := proc.StderrPipe()
	if err != nil {
		return "", "", fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	if err := proc.Start(); err != nil {
		return "", "", fmt.Errorf("failed to start process: %w", err)
	}

	stdoutBuf := syncbuf.MakeSyncBuffer()
	stderrBuf := syncbuf.MakeSyncBuffer()
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		io.Copy(stdoutBuf, stdout)
	}()

	go func() {
		defer wg.Done()
		io.Copy(stderrBuf, stderr)
	}()

	runErr := ProcessContextWait(ctx, proc)
	wg.Wait()

	return stdoutBuf.String(), stderrBuf.String(), runErr
}

func ProcessContextWait(ctx context.Context, proc ShellProcessController) error {
	done := make(chan error, 1)
	go func() {
		done <- proc.Wait()
	}()

	select {
	case <-ctx.Done():
		proc.Kill()
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func MakeStdoutSyncBuffer(proc ShellProcessController) (*syncbuf.SyncBuffer, error) {
	stdout, err := proc.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	return syncbuf.MakeSyncBufferFromReader(stdout), nil
}

func MakeStderrSyncBuffer(proc ShellProcessController) (*syncbuf.SyncBuffer, error) {
	stderr, err := proc.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	return syncbuf.MakeSyncBufferFromReader(stderr), nil
}

func BuildShellCommand(opts CommandSpec) (string, error) {
	// Build environment variables
	var envVars strings.Builder
	for key, value := range opts.Env {
		if !isValidEnvVarName(key) {
			return "", fmt.Errorf("invalid environment variable name: %q", key)
		}
		envVars.WriteString(fmt.Sprintf("%s=%s ", key, HardQuote(value)))
	}

	// Build the command
	shellCmd := opts.Cmd
	if opts.Cwd != "" {
		shellCmd = fmt.Sprintf("cd %s && %s", HardQuote(opts.Cwd), shellCmd)
	}

	// Quote the command for `sh -c`
	return fmt.Sprintf("sh -c %s", HardQuote(envVars.String()+shellCmd)), nil
}

func isValidEnvVarName(name string) bool {
	validEnvVarName := regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
	return validEnvVarName.MatchString(name)
}
