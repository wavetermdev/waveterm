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
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

func getProcessGroupId(pid int) (int, error) {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return 0, err
	}
	return pgid, nil
}

func normalizeSignal(sigName string) os.Signal {
	sigName = strings.ToUpper(sigName)
	sigName = strings.TrimPrefix(sigName, "SIG")

	switch sigName {
	case "HUP":
		return syscall.SIGHUP
	case "INT":
		return syscall.SIGINT
	case "QUIT":
		return syscall.SIGQUIT
	case "KILL":
		return syscall.SIGKILL
	case "TERM":
		return syscall.SIGTERM
	case "USR1":
		return syscall.SIGUSR1
	case "USR2":
		return syscall.SIGUSR2
	case "STOP":
		return syscall.SIGSTOP
	case "CONT":
		return syscall.SIGCONT
	default:
		return nil
	}
}

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

	logPath := GetJobFilePath(clientId, jobId, "log")
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

	signal.Ignore(syscall.SIGHUP)

	return nil
}

func setCloseOnExec(fd int) {
	unix.CloseOnExec(fd)
}
