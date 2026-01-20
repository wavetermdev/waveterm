// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package jobmanager

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

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

	devNull, err := os.OpenFile("/dev/null", os.O_RDONLY, 0)
	if err != nil {
		return fmt.Errorf("failed to open /dev/null: %w", err)
	}
	err = unix.Dup2(int(devNull.Fd()), int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("failed to dup2 stdin: %w", err)
	}
	devNull.Close()

	logPath := GetJobFilePath(clientId, jobId, "log")
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

	setupJobManagerSignalHandlers()
	return nil
}

func handleSIGHUP() {
	cmd := WshCmdJobManager.GetCmd()
	if cmd != nil {
		log.Printf("handling SIGHUP, closing pty master\n")
		cmd.TerminateByClosingPtyMaster()
	}
	go func() {
		log.Printf("received SIGHUP, will exit")
		time.Sleep(500 * time.Millisecond)
		log.Printf("terminating job manager\n")
		os.Exit(0)
	}()
}

func setupJobManagerSignalHandlers() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		for sig := range sigChan {
			log.Printf("job manager received signal: %v\n", sig)

			if sig == syscall.SIGHUP {
				handleSIGHUP()
				continue
			}

			cmd := WshCmdJobManager.GetCmd()
			if cmd != nil {
				pgid, err := cmd.GetPGID()
				if err == nil {
					if s, ok := sig.(syscall.Signal); ok {
						log.Printf("forwarding signal %v to process group %d\n", sig, pgid)
						_ = syscall.Kill(-pgid, s)
					} else {
						log.Printf("signal is not a syscall.Signal: %T\n", sig)
					}
				} else {
					log.Printf("failed to get pgid: %v\n", err)
				}
			}

			if sig == syscall.SIGTERM {
				if cmd != nil {
					log.Printf("received SIGTERM, will exit\n")
					time.Sleep(500 * time.Millisecond)
				}
				log.Printf("terminating job manager\n")
				os.Exit(0)
			}
		}
	}()
}
