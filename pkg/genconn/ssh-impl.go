// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package genconn

import (
	"fmt"
	"io"
	"log"
	"sync"

	"golang.org/x/crypto/ssh"
)

var _ ShellClient = (*SSHShellClient)(nil)

type SSHShellClient struct {
	client *ssh.Client
}

func MakeSSHShellClient(client *ssh.Client) *SSHShellClient {
	return &SSHShellClient{client: client}
}

func (c *SSHShellClient) MakeProcessController(cmdSpec CommandSpec) (ShellProcessController, error) {
	return MakeSSHCmdClient(c.client, cmdSpec)
}

// SSHProcessController implements ShellCmd for SSH connections
type SSHProcessController struct {
	client      *ssh.Client
	session     *ssh.Session
	lock        *sync.Mutex
	once        *sync.Once
	stdinPiped  bool
	stdoutPiped bool
	stderrPiped bool
	waitErr     error
	started     bool
	cmdSpec     CommandSpec
}

// MakeSSHCmdClient creates a new instance of SSHCmdClient
func MakeSSHCmdClient(client *ssh.Client, cmdSpec CommandSpec) (*SSHProcessController, error) {
	log.Printf("SSH-NEWSESSION (cmdclient)\n")
	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	return &SSHProcessController{
		client:  client,
		lock:    &sync.Mutex{},
		once:    &sync.Once{},
		cmdSpec: cmdSpec,
		session: session,
	}, nil
}

// Start begins execution of the command
func (s *SSHProcessController) Start() error {
	s.lock.Lock()
	defer s.lock.Unlock()

	if s.started {
		return fmt.Errorf("command already started")
	}

	fullCmd, err := BuildShellCommand(s.cmdSpec)
	if err != nil {
		return fmt.Errorf("failed to build shell command: %w", err)
	}
	// if stdout/stderr weren't piped, then session.stdout/stderr will be nil
	// and the library guarantees that the outputs will be attached to io.Discard
	// if stdin hasn't been piped, then session.stdin will be nil
	// and the libary guarantees that it will be attached to an empty bytes.Buffer, which will produce an immediate EOF
	// tl;dr we don't need to worry about hanging beause of long input or explicitly closing stdin
	if err := s.session.Start(fullCmd); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}
	s.started = true
	return nil
}

// Wait waits for the command to complete
func (s *SSHProcessController) Wait() error {
	s.once.Do(func() {
		s.waitErr = s.session.Wait()
	})
	return s.waitErr
}

// Kill terminates the command
func (s *SSHProcessController) Kill() {
	s.lock.Lock()
	defer s.lock.Unlock()

	if s.session != nil {
		s.session.Close()
	}
}

func (s *SSHProcessController) StdinPipe() (io.WriteCloser, error) {
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.started {
		return nil, fmt.Errorf("command already started")
	}
	if s.stdinPiped {
		return nil, fmt.Errorf("stdin already piped")
	}
	s.stdinPiped = true
	return s.session.StdinPipe()
}

func (s *SSHProcessController) StdoutPipe() (io.Reader, error) {
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.started {
		return nil, fmt.Errorf("command already started")
	}
	if s.stdoutPiped {
		return nil, fmt.Errorf("stdout already piped")
	}
	s.stdoutPiped = true
	stdout, err := s.session.StdoutPipe()
	if err != nil {
		return nil, err
	}
	return stdout, nil
}

func (s *SSHProcessController) StderrPipe() (io.Reader, error) {
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.started {
		return nil, fmt.Errorf("command already started")
	}
	if s.stderrPiped {
		return nil, fmt.Errorf("stderr already piped")
	}
	s.stderrPiped = true
	stderr, err := s.session.StderrPipe()
	if err != nil {
		return nil, err
	}
	return stderr, nil
}
