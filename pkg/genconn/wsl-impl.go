//go:build windows

// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package genconn

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/ubuntu/gowsl"
)

// WSLSimpleCmdClient implements SimpleShellCmd for Ubuntu/WSL connections
type WSLSimpleCmdClient struct {
	client *gowsl.Distro
}

// NewWSLSimpleCmdClient creates a new instance of WSLSimpleCmdClient
func NewWSLSimpleCmdClient(client *gowsl.Distro) *WSLSimpleCmdClient {
	return &WSLSimpleCmdClient{client: client}
}

// Run executes the given shell command with options in the WSL environment
func (w *WSLSimpleCmdClient) Run(ctx context.Context, cmdSpec CommandSpec) (string, string, error) {
	if ctx == nil {
		return "", "", fmt.Errorf("nil Context")
	}

	// Build the shell command using the shared helper
	finalCmd, err := BuildShellCommand(cmdSpec)
	if err != nil {
		return "", "", fmt.Errorf("failed to build shell command: %w", err)
	}

	// Create the command with context
	cmd := w.client.Command(ctx, finalCmd)
	if cmd == nil {
		return "", "", fmt.Errorf("failed to create WSL command")
	}

	// Create buffers for stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Run the command
	if err := cmd.Run(); err != nil {
		return stdout.String(), stderr.String(), fmt.Errorf("command failed: %w", err)
	}

	return stdout.String(), stderr.String(), nil
}

// WSLCmdClient implements the ShellCmd interface for WSL
type WSLCmdClient struct {
	client      *gowsl.Distro
	cmd         *gowsl.Cmd
	lock        *sync.Mutex
	once        *sync.Once
	waitErr     error
	initialized bool
	started     bool
	commandSpec CommandSpec
}

// NewWSLCmdClient creates a new instance of WSLCmdClient
func NewWSLCmdClient(client *gowsl.Distro) *WSLCmdClient {
	return &WSLCmdClient{
		client: client,
		lock:   &sync.Mutex{},
		once:   &sync.Once{},
	}
}

// Init prepares the command but doesn't start it
func (w *WSLCmdClient) Init(cmd CommandSpec) error {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.initialized {
		return fmt.Errorf("command already initialized")
	}

	finalCmd, err := BuildShellCommand(cmd)
	if err != nil {
		return fmt.Errorf("failed to build shell command: %w", err)
	}

	// Create command without context since we'll manage lifecycle manually
	w.cmd = w.client.Command(nil, finalCmd)
	if w.cmd == nil {
		return fmt.Errorf("failed to create WSL command")
	}

	w.commandSpec = cmd
	w.initialized = true
	return nil
}

// Start begins execution of the command
func (w *WSLCmdClient) Start() error {
	w.lock.Lock()
	defer w.lock.Unlock()

	if !w.initialized {
		return fmt.Errorf("command not initialized")
	}
	if w.started {
		return fmt.Errorf("command already started")
	}

	if err := w.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	w.started = true
	return nil
}

// Wait waits for the command to complete
func (w *WSLCmdClient) Wait() error {
	if !w.initialized {
		panic("command not initialized")
	}
	w.once.Do(func() {
		w.waitErr = w.cmd.Wait()
	})
	return w.waitErr
}

// Kill terminates the command
func (w *WSLCmdClient) Kill() {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.cmd != nil && w.cmd.Process != nil {
		w.cmd.Process.Kill()
	}
}

// ExitCode returns the exit code of the command
func (w *WSLCmdClient) ExitCode() int {
	w.lock.Lock()
	defer w.lock.Unlock()

	if w.cmd == nil || w.cmd.ProcessState == nil {
		return -1
	}
	return w.cmd.ProcessState.ExitCode()
}

// StdinPipe returns a pipe that will be connected to the command's standard input
func (w *WSLCmdClient) StdinPipe() (io.WriteCloser, error) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if !w.initialized {
		return nil, fmt.Errorf("command not initialized")
	}
	if w.started {
		return nil, fmt.Errorf("command already started")
	}

	return w.cmd.StdinPipe()
}

// StdoutPipe returns a pipe that will be connected to the command's standard output
func (w *WSLCmdClient) StdoutPipe() (io.ReadCloser, error) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if !w.initialized {
		return nil, fmt.Errorf("command not initialized")
	}
	if w.started {
		return nil, fmt.Errorf("command already started")
	}

	return w.cmd.StdoutPipe()
}

// StderrPipe returns a pipe that will be connected to the command's standard error
func (w *WSLCmdClient) StderrPipe() (io.ReadCloser, error) {
	w.lock.Lock()
	defer w.lock.Unlock()

	if !w.initialized {
		return nil, fmt.Errorf("command not initialized")
	}
	if w.started {
		return nil, fmt.Errorf("command already started")
	}

	return w.cmd.StderrPipe()
}
