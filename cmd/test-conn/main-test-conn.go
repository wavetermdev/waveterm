// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"time"
)

var (
	WaveVersion = "0.0.0"
	BuildTime   = "0"
)

func usage() {
	fmt.Fprintf(os.Stderr, `Test Harness for SSH Connection Flows

Usage:
  test-conn [flags] <command> <user@host> [args...]

Commands:
  connect <user@host>            - Test basic SSH connection with wsh
  ssh <user@host>                - Test basic SSH connection
  exec <user@host> <command>     - Execute command and show output (no wsh)
  wshexec <user@host> <command>  - Execute command with wsh enabled
  shell <user@host>              - Start interactive shell session

Flags:
  -t duration  Connection timeout (default: 60s)
  -i           Interactive mode (prompt for user input instead of auto-accept)
  -v           Show version and exit

Examples:
  test-conn ssh user@example.com
  test-conn exec user@example.com "ls -la"
  test-conn wshexec user@example.com "wsh version"
  test-conn -i connect user@example.com
  test-conn shell user@example.com

`)
	os.Exit(1)
}

func main() {
	timeoutFlag := flag.Duration("t", 60*time.Second, "connection timeout")
	interactiveFlag := flag.Bool("i", false, "interactive mode (prompt for user input)")
	versionFlag := flag.Bool("v", false, "show version")

	flag.Usage = usage
	flag.Parse()

	if *versionFlag {
		fmt.Printf("test-conn version %s (built %s)\n", WaveVersion, BuildTime)
		os.Exit(0)
	}

	args := flag.Args()
	if len(args) < 2 {
		usage()
	}

	command := args[0]
	connName := args[1]

	autoAccept := !*interactiveFlag

	err := initTestHarness(autoAccept)
	if err != nil {
		log.Fatalf("Failed to initialize: %v", err)
	}

	switch command {
	case "ssh", "connect":
		err = testBasicConnect(connName, *timeoutFlag)

	case "exec":
		if len(args) < 3 {
			log.Fatalf("exec command requires a command argument")
		}
		cmd := args[2]
		err = testShellWithCommand(connName, cmd, *timeoutFlag)

	case "wshexec":
		if len(args) < 3 {
			log.Fatalf("wshexec command requires a command argument")
		}
		cmd := args[2]
		err = testWshExec(connName, cmd, *timeoutFlag)

	case "shell":
		err = testInteractiveShell(connName, *timeoutFlag)

	default:
		log.Fatalf("Unknown command: %s", command)
	}

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
