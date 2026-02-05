// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func setupWaveEnvVars() error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	isDev := os.Getenv("WAVETERM_DEV") != ""
	devSuffix := ""
	if isDev {
		devSuffix = "-dev"
	}

	configHome := os.Getenv("WAVETERM_CONFIG_HOME")
	if configHome == "" {
		configHome = filepath.Join(homeDir, ".config", "waveterm"+devSuffix)
		os.Setenv("WAVETERM_CONFIG_HOME", configHome)
	}
	log.Printf("Using config directory: %s", configHome)

	dataHome := os.Getenv("WAVETERM_DATA_HOME")
	if dataHome == "" {
		if runtime.GOOS == "darwin" {
			dataHome = filepath.Join(homeDir, "Library", "Application Support", "waveterm"+devSuffix)
			os.Setenv("WAVETERM_DATA_HOME", dataHome)
		} else {
			return fmt.Errorf("WAVETERM_DATA_HOME must be set on non-macOS systems")
		}
	}
	log.Printf("Using data directory: %s", dataHome)

	return nil
}

func initTestHarness(autoAccept bool) error {
	log.Printf("Initializing test harness...")

	err := setupWaveEnvVars()
	if err != nil {
		return fmt.Errorf("failed to setup wave env vars: %w", err)
	}

	err = wavebase.CacheAndRemoveEnvVars()
	if err != nil {
		return fmt.Errorf("failed to cache env vars: %w", err)
	}

	wshutil.DefaultRouter = wshutil.NewWshRouter()
	wshutil.DefaultRouter.SetAsRootRouter()

	wstore.SetClientId("test-client-" + fmt.Sprintf("%d", time.Now().Unix()))

	userinput.SetUserInputProvider(&CLIProvider{AutoAccept: autoAccept})

	log.Printf("Test harness initialized")
	return nil
}

func testBasicConnect(connName string, timeout time.Duration) error {
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("failed to parse connection string: %w", err)
	}

	log.Printf("Connecting to %s...", opts.String())

	conn := conncontroller.GetConn(opts)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	err = conn.Connect(ctx, &wconfig.ConnKeywords{})
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}

	status := conn.DeriveConnStatus()
	log.Printf("✓ Connected!")
	log.Printf("  Status: %s", status.Status)
	log.Printf("  WshEnabled: %v", status.WshEnabled)
	log.Printf("  Connection: %s", status.Connection)
	if status.WshVersion != "" {
		log.Printf("  WshVersion: %s", status.WshVersion)
	}
	if status.WshError != "" {
		log.Printf("  WshError: %s", status.WshError)
	}
	if status.NoWshReason != "" {
		log.Printf("  NoWshReason: %s", status.NoWshReason)
	}

	return nil
}

func testShellWithCommand(connName string, cmd string, timeout time.Duration) error {
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("failed to parse connection string: %w", err)
	}

	log.Printf("Connecting to %s...", opts.String())

	conn := conncontroller.GetConn(opts)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	err = conn.Connect(ctx, &wconfig.ConnKeywords{})
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}

	log.Printf("✓ Connected! Starting shell...")

	termSize := waveobj.TermSize{Rows: 24, Cols: 80}
	shellProc, err := shellexec.StartRemoteShellProcNoWsh(ctx, termSize, "", shellexec.CommandOptsType{}, conn)
	if err != nil {
		return fmt.Errorf("failed to start shell: %w", err)
	}
	defer shellProc.Close()

	log.Printf("✓ Shell started! Executing: %s", cmd)

	_, err = shellProc.Cmd.Write([]byte(cmd + "\n"))
	if err != nil {
		return fmt.Errorf("failed to write command: %w", err)
	}

	time.Sleep(500 * time.Millisecond)

	buf := make([]byte, 8192)
	n, err := shellProc.Cmd.Read(buf)
	if err != nil {
		log.Printf("Warning: read error (may be expected): %v", err)
	}

	if n > 0 {
		log.Printf("\n--- Output ---\n%s\n--- End Output ---", string(buf[:n]))
	} else {
		log.Printf("No output received (timeout or no data)")
	}

	return nil
}

func testWshExec(connName string, cmd string, timeout time.Duration) error {
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("failed to parse connection string: %w", err)
	}

	log.Printf("Connecting to %s with wsh enabled...", opts.String())

	conn := conncontroller.GetConn(opts)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	wshEnabled := true
	err = conn.Connect(ctx, &wconfig.ConnKeywords{
		ConnWshEnabled: &wshEnabled,
	})
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}

	status := conn.DeriveConnStatus()
	log.Printf("✓ Connected! (wsh enabled: %v)", status.WshEnabled)
	if status.WshVersion != "" {
		log.Printf("  wsh version: %s", status.WshVersion)
	}
	if !status.WshEnabled {
		log.Printf("  WARNING: wsh not enabled - reason: %s", status.NoWshReason)
	}

	log.Printf("Starting wsh-enabled shell...")

	termSize := waveobj.TermSize{Rows: 24, Cols: 80}
	shellProc, err := shellexec.StartRemoteShellProc(ctx, ctx, termSize, "", shellexec.CommandOptsType{}, conn)
	if err != nil {
		return fmt.Errorf("failed to start shell: %w", err)
	}
	defer shellProc.Close()

	log.Printf("✓ Shell started! Executing: %s", cmd)

	_, err = shellProc.Cmd.Write([]byte(cmd + "\n"))
	if err != nil {
		return fmt.Errorf("failed to write command: %w", err)
	}

	time.Sleep(500 * time.Millisecond)

	buf := make([]byte, 8192)
	n, err := shellProc.Cmd.Read(buf)
	if err != nil {
		log.Printf("Warning: read error (may be expected): %v", err)
	}

	if n > 0 {
		log.Printf("\n--- Output ---\n%s\n--- End Output ---", string(buf[:n]))
	} else {
		log.Printf("No output received (timeout or no data)")
	}

	return nil
}

func testInteractiveShell(connName string, timeout time.Duration) error {
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("failed to parse connection string: %w", err)
	}

	log.Printf("Connecting to %s...", opts.String())

	conn := conncontroller.GetConn(opts)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	err = conn.Connect(ctx, &wconfig.ConnKeywords{})
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}

	log.Printf("✓ Connected! Starting interactive shell...")
	log.Printf("Note: This is a simple test - output may be mixed with prompts")
	log.Printf("Type commands and press Enter. Type 'exit' to quit.\n")

	termSize := waveobj.TermSize{Rows: 24, Cols: 80}
	shellProc, err := shellexec.StartRemoteShellProcNoWsh(ctx, termSize, "", shellexec.CommandOptsType{}, conn)
	if err != nil {
		return fmt.Errorf("failed to start shell: %w", err)
	}
	defer shellProc.Close()

	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := shellProc.Cmd.Read(buf)
			if err != nil {
				return
			}
			if n > 0 {
				fmt.Print(string(buf[:n]))
			}
		}
	}()

	go func() {
		buf := make([]byte, 1)
		for {
			n, err := os.Stdin.Read(buf)
			if err != nil {
				return
			}
			if n > 0 {
				shellProc.Cmd.Write(buf[:n])
			}
		}
	}()

	shellProc.Wait()
	log.Printf("\nShell exited")

	return nil
}
