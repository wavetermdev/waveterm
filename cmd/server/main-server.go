// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/service"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/web"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const ReadySignalPidVarName = "WAVETERM_READY_SIGNAL_PID"

var shutdownOnce sync.Once

func doShutdown(reason string) {
	shutdownOnce.Do(func() {
		log.Printf("shutting down: %s\n", reason)
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		// TODO deal with flush in progress
		filestore.WFS.FlushCache(ctx)
		time.Sleep(200 * time.Millisecond)
		os.Exit(0)
	})
}

func installShutdownSignalHandlers() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		for sig := range sigCh {
			doShutdown(fmt.Sprintf("got signal %v", sig))
			break
		}
	}()
}

// watch stdin, kill server if stdin is closed
func stdinReadWatch() {
	buf := make([]byte, 1024)
	for {
		_, err := os.Stdin.Read(buf)
		if err != nil {
			doShutdown(fmt.Sprintf("stdin closed/error (%v)", err))
			break
		}
	}
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetPrefix("[wavesrv] ")

	err := service.ValidateServiceMap()
	if err != nil {
		log.Printf("error validating service map: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveHomeDir()
	if err != nil {
		log.Printf("error ensuring wave home dir: %v\n", err)
		return
	}
	waveLock, err := wavebase.AcquireWaveLock()
	if err != nil {
		log.Printf("error acquiring wave lock (another instance of Wave is likely running): %v\n", err)
		return
	}

	log.Printf("wave home dir: %s\n", wavebase.GetWaveHomeDir())
	err = filestore.InitFilestore()
	if err != nil {
		log.Printf("error initializing filestore: %v\n", err)
		return
	}
	err = wstore.InitWStore()
	if err != nil {
		log.Printf("error initializing wstore: %v\n", err)
		return
	}
	err = wstore.EnsureInitialData()
	if err != nil {
		log.Printf("error ensuring initial data: %v\n", err)
		return
	}
	installShutdownSignalHandlers()
	go stdinReadWatch()

	go web.RunWebSocketServer()
	go func() {
		time.Sleep(30 * time.Millisecond)
		pidStr := os.Getenv(ReadySignalPidVarName)
		if pidStr != "" {
			pid, err := strconv.Atoi(pidStr)
			if err == nil {
				syscall.Kill(pid, syscall.SIGUSR1)
			}
		}
	}()
	web.RunWebServer() // blocking
	runtime.KeepAlive(waveLock)
}
