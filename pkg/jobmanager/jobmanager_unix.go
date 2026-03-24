// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package jobmanager

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"golang.org/x/sys/unix"
)

func daemonize(clientId string, jobId string) error {
	_, err := unix.Setsid()
	if err != nil {
		return fmt.Errorf("failed to setsid: %w", err)
	}

	devNull, err := os.OpenFile("/dev/null", os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("failed to open /dev/null: %w", err)
	}
	err = unix.Dup2(int(devNull.Fd()), int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("failed to dup2 stdin: %w", err)
	}
	devNull.Close()

	logPath := wavebase.GetRemoteJobFilePath(jobId, "log")
	logDir := filepath.Dir(logPath)
	err = os.MkdirAll(logDir, 0700)
	if err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	err = unix.Dup2(int(logFile.Fd()), int(os.Stdout.Fd()))
	if err != nil {
		return fmt.Errorf("failed to dup2 stdout: %w", err)
	}
	err = unix.Dup2(int(logFile.Fd()), int(os.Stderr.Fd()))
	if err != nil {
		return fmt.Errorf("failed to dup2 stderr: %w", err)
	}

	log.SetOutput(logFile)
	log.Printf("job manager daemonized, logging to %s\n", logPath)
	log.Printf("job owner clientid: %s\n", clientId)

	signal.Ignore(syscall.SIGHUP)

	return nil
}
