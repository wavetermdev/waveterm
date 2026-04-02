// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package process provides process management for ZeroAI agents
package process

import (
	"context"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/zeroai/protocol"
)

// ProcessState represents the current state of a process
type ProcessState string

const (
	ProcessStateInit   ProcessState = "init"   // Process initialized but not started
	ProcessStateRunning ProcessState = "running" // Process is running
	ProcessStateDone   ProcessState = "done"   // Process has exited
)

// ProcessSpec defines the specification for spawning a process
type ProcessSpec struct {
	// Command is the executable path
	Command string

	// Args are the command line arguments
	Args []string

	// Working directory for the process
	// Cwd is the field name used internally (Go convention)
	// WorkingDir is an alias for design document compatibility
	Cwd string

	// Environment variables to set (will be merged with process environment)
	Env map[string]string

	// Backend identifies which AI backend this process is for
	Backend protocol.AcpBackend

	// SessionID identifies the ACP session (optional, for resume/fork)
	SessionID string

	// ForkSession indicates if this is a forked session
	ForkSession bool

	// YoloMode enables bypass permissions mode
	YoloMode bool

	// Model specifies the AI model to use
	Model string
}

// WorkingDir returns the working directory (alias for design compatibility)
func (spec *ProcessSpec) WorkingDir() string {
	return spec.Cwd
}

// SetWorkingDir sets the working directory (alias for design compatibility)
func (spec *ProcessSpec) SetWorkingDir(dir string) {
	spec.Cwd = dir
}

// ProcessInfo contains information about a running process
type ProcessInfo struct {
	// PID is the process ID
	PID int

	// Cmdline is the full command line
	Cmdline string

	// State is the current process state
	State ProcessState

	// ExitCode is the exit code (0-255) if State is Done
	ExitCode int

	// ExitSignal is the signal that terminated the process (if applicable)
	ExitSignal string

	// StartedAt is when the process started
	StartedAt time.Time

	// EndedAt is when the process ended (if State is Done)
	EndedAt time.Time

	// PidFile is the path to the process tracking file (if WSH enabled)
	PidFile string
}

// AgentProcess represents a spawned agent process with stdio pipes
type AgentProcess struct {
	// Spec is the process specification used to spawn
	Spec ProcessSpec

	// Command is the underlying exec.Cmd
	Command *exec.Cmd

	// stdin pipe
	stdin io.WriteCloser

	// stdout pipe
	stdout io.Reader

	// stderr pipe
	stderr io.Reader

	// State tracking
	lock      sync.RWMutex
	state     ProcessState
	startedAt time.Time
	endedAt   time.Time
	exitCode  int
	exitSignal string

	// Wait tracking
	waitOnce sync.Once
	waitChan chan struct{}
	waitErr  error
}

// ProcessManager is the interface for managing agent processes
type ProcessManager interface {
	// SpawnProcess spawns a new process with stdio pipes for ACP communication
	SpawnProcess(ctx context.Context, spec ProcessSpec) (*AgentProcess, error)

	// KillProcess terminates a process
	KillProcess(process *AgentProcess) error

	// GetProcessInfo returns information about a process
	GetProcessInfo(process *AgentProcess) ProcessInfo

	// ListProcesses returns all active processes managed by this manager
	ListProcesses(ctx context.Context) ([]ProcessInfo, error)
}

// WSHProcessManager implements ProcessManager using WaveTerm's shell infrastructure
type WSHProcessManager struct {
	// Domain socket name for WSH (reserved for future use)
	_ string
}

// NewWSHProcessManager creates a new WSH-based process manager
func NewWSHProcessManager() *WSHProcessManager {
	return &WSHProcessManager{}
}

// SpawnProcess spawns a new process with stdio pipes
func (pm *WSHProcessManager) SpawnProcess(ctx context.Context, spec ProcessSpec) (*AgentProcess, error) {
	// Validate spec
	if spec.Command == "" {
		return nil, os.ErrInvalid
	}

	// Prepare working directory
	cwd := spec.Cwd
	if cwd == "" {
		cwd = wavebase.GetHomeDir()
	}
	cwd, err := wavebase.ExpandHomeDir(cwd)
	if err != nil {
		return nil, err
	}

	// Verify CWD exists
	if _, err := os.Stat(cwd); err != nil {
		return nil, err
	}

	// Prepare environment
	env := pm.buildEnvironment(spec)

	// Create command
	cmd := exec.CommandContext(ctx, spec.Command, spec.Args...)
	cmd.Dir = cwd
	cmd.Env = env

	// Create stdio pipes (not PTY - ACP uses stdio for JSON-RPC)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, err
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		stdin.Close()
		stdout.Close()
		return nil, err
	}

	// Create process
	proc := &AgentProcess{
		Spec:     spec,
		Command:  cmd,
		stdin:    stdin,
		stdout:   stdout,
		stderr:   stderr,
		state:    ProcessStateRunning,
		startedAt: time.Now(),
		waitChan: make(chan struct{}),
	}

	// Start the process
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	// Start wait goroutine
	go pm.waitForProcess(proc)

	return proc, nil
}

// buildEnvironment builds the environment variables for the process
func (pm *WSHProcessManager) buildEnvironment(spec ProcessSpec) []string {
	// Get current environment
	env := os.Environ()

	// Add WSH JWT token var name (caller should set the value)
	// Note: The actual JWT token should be set by the caller via spec.Env if needed

	// Add custom environment variables from spec
	for key, value := range spec.Env {
		env = append(env, key+"="+value)
	}

	return env
}

// waitForProcess waits for the process to finish and updates state
func (pm *WSHProcessManager) waitForProcess(proc *AgentProcess) {
	// Wait for process to finish (don't hold lock during Wait())
	err := proc.Command.Wait()

	// Get exit code and signal
	exitCode := -1
	exitSignal := ""

	if err != nil {
		if proc.Command.ProcessState != nil {
			exitCode = proc.Command.ProcessState.ExitCode()

			// Check for signal termination
			if ws, ok := proc.Command.ProcessState.Sys().(syscall.WaitStatus); ok {
				if ws.Signaled() {
					exitSignal = getSignalName(ws.Signal())
				}
			}
		}
	} else {
		exitCode = 0
	}

	// Update process state with lock
	proc.lock.Lock()
	proc.state = ProcessStateDone
	proc.endedAt = time.Now()
	proc.exitCode = exitCode
	proc.exitSignal = exitSignal

	// Store wait error
	proc.waitErr = err
	proc.waitUnlock()
	proc.lock.Unlock()
}

// waitUnlock unlocks the wait channel
func (proc *AgentProcess) waitUnlock() {
	proc.waitOnce.Do(func() {
		close(proc.waitChan)
	})
}

// getSignalName returns the name of a signal
func getSignalName(sig syscall.Signal) string {
	// Common signals
	switch sig {
	case syscall.SIGINT:
		return "SIGINT"
	case syscall.SIGTERM:
		return "SIGTERM"
	case syscall.SIGKILL:
		return "SIGKILL"
	case syscall.SIGHUP:
		return "SIGHUP"
	case syscall.SIGQUIT:
		return "SIGQUIT"
	case syscall.SIGPIPE:
		return "SIGPIPE"
	case syscall.SIGALRM:
		return "SIGALRM"
	case syscall.SIGUSR1:
		return "SIGUSR1"
	case syscall.SIGUSR2:
		return "SIGUSR2"
	default:
		return ""
	}
}

// KillProcess terminates a process
func (pm *WSHProcessManager) KillProcess(process *AgentProcess) error {
	if process == nil || process.Command == nil {
		return os.ErrInvalid
	}

	process.lock.Lock()
	defer process.lock.Unlock()

	// Check if process is already done
	if process.state == ProcessStateDone {
		return nil
	}

	// Kill the process
	return process.Command.Process.Kill()
}

// GetProcessInfo returns information about a process
func (pm *WSHProcessManager) GetProcessInfo(process *AgentProcess) ProcessInfo {
	if process == nil {
		return ProcessInfo{}
	}

	process.lock.RLock()
	defer process.lock.RUnlock()

	info := ProcessInfo{
		State:      process.state,
		StartedAt:  process.startedAt,
		EndedAt:    process.endedAt,
		ExitCode:   process.exitCode,
		ExitSignal: process.exitSignal,
	}

	// Get PID and Cmdline if command is running
	if process.Command != nil && process.Command.Process != nil {
		info.PID = process.Command.Process.Pid
		info.Cmdline = process.Command.String()
	}

	return info
}

// ListProcesses returns all active processes
func (pm *WSHProcessManager) ListProcesses(ctx context.Context) ([]ProcessInfo, error) {
	// Note: This is a simplified implementation.
	// For production, you would need to track processes with a registry.
	// For now, we return an empty slice to satisfy the interface.
	return []ProcessInfo{}, nil
}

// StdinPipe returns the stdin pipe for writing to the process
func (p *AgentProcess) StdinPipe() io.WriteCloser {
	return p.stdin
}

// StdoutPipe returns the stdout pipe for reading from the process
func (p *AgentProcess) StdoutPipe() io.Reader {
	return p.stdout
}

// StderrPipe returns the stderr pipe for reading from the process
func (p *AgentProcess) StderrPipe() io.Reader {
	return p.stderr
}

// Wait waits for the process to finish
func (p *AgentProcess) Wait() error {
	<-p.waitChan
	return p.waitErr
}

// WaitNB returns immediately with done status and wait error (non-blocking)
func (p *AgentProcess) WaitNB() (done bool, err error) {
	select {
	case <-p.waitChan:
		return true, p.waitErr
	default:
		return false, nil
	}
}
