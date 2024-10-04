// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime/debug"
	"strconv"

	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/service"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcloud"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/web"
	"github.com/wavetermdev/waveterm/pkg/wlayout"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshremote"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshserver"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// these are set at build time
var WaveVersion = "0.0.0"
var BuildTime = "0"

const InitialTelemetryWait = 10 * time.Second
const TelemetryTick = 2 * time.Minute
const TelemetryInterval = 4 * time.Hour

const ReadySignalPidVarName = "WAVETERM_READY_SIGNAL_PID"

var shutdownOnce sync.Once

func doShutdown(reason string) {
	shutdownOnce.Do(func() {
		log.Printf("shutting down: %s\n", reason)
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		go blockcontroller.StopAllBlockControllers()
		shutdownActivityUpdate()
		sendTelemetryWrapper()
		// TODO deal with flush in progress
		filestore.WFS.FlushCache(ctx)
		watcher := wconfig.GetWatcher()
		if watcher != nil {
			watcher.Close()
		}
		time.Sleep(500 * time.Millisecond)
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

func configWatcher() {
	watcher := wconfig.GetWatcher()
	if watcher != nil {
		watcher.Start()
	}
}

func telemetryLoop() {
	var nextSend int64
	time.Sleep(InitialTelemetryWait)
	for {
		if time.Now().Unix() > nextSend {
			nextSend = time.Now().Add(TelemetryInterval).Unix()
			sendTelemetryWrapper()
		}
		time.Sleep(TelemetryTick)
	}
}

func sendTelemetryWrapper() {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in sendTelemetryWrapper: %v\n", r)
		debug.PrintStack()
	}()
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		log.Printf("[error] getting client data for telemetry: %v\n", err)
		return
	}
	err = wcloud.SendTelemetry(ctx, client.OID)
	if err != nil {
		log.Printf("[error] sending telemetry: %v\n", err)
	}
}

func startupActivityUpdate() {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	activity := telemetry.ActivityUpdate{
		Startup: 1,
	}
	activity.NumTabs, _ = wstore.DBGetCount[*waveobj.Tab](ctx)
	err := telemetry.UpdateActivity(ctx, activity) // set at least one record into activity (don't use go routine wrap here)
	if err != nil {
		log.Printf("error updating startup activity: %v\n", err)
	}
}

func shutdownActivityUpdate() {
	activity := telemetry.ActivityUpdate{Shutdown: 1}
	ctx, cancelFn := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancelFn()
	err := telemetry.UpdateActivity(ctx, activity) // do NOT use the go routine wrap here (this needs to be synchronous)
	if err != nil {
		log.Printf("error updating shutdown activity: %v\n", err)
	}
}

func createMainWshClient() {
	rpc := wshserver.GetMainRpcClient()
	wshutil.DefaultRouter.RegisterRoute(wshutil.DefaultRoute, rpc)
	wps.Broker.SetClient(wshutil.DefaultRouter)
	localConnWsh := wshutil.MakeWshRpc(nil, nil, wshrpc.RpcContext{Conn: wshrpc.LocalConnName}, &wshremote.ServerImpl{})
	go wshremote.RunSysInfoLoop(localConnWsh, wshrpc.LocalConnName)
	wshutil.DefaultRouter.RegisterRoute(wshutil.MakeConnectionRouteId(wshrpc.LocalConnName), localConnWsh)
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetPrefix("[wavesrv] ")
	wavebase.WaveVersion = WaveVersion
	wavebase.BuildTime = BuildTime

	err := authkey.SetAuthKeyFromEnv()
	if err != nil {
		log.Printf("error setting auth key: %v\n", err)
		return
	}
	err = service.ValidateServiceMap()
	if err != nil {
		log.Printf("error validating service map: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveHomeDir()
	if err != nil {
		log.Printf("error ensuring wave home dir: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveDBDir()
	if err != nil {
		log.Printf("error ensuring wave db dir: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveConfigDir()
	if err != nil {
		log.Printf("error ensuring wave config dir: %v\n", err)
		return
	}
	waveLock, err := wavebase.AcquireWaveLock()
	if err != nil {
		log.Printf("error acquiring wave lock (another instance of Wave is likely running): %v\n", err)
		return
	}
	defer func() {
		err = waveLock.Close()
		if err != nil {
			log.Printf("error releasing wave lock: %v\n", err)
		}
	}()
	log.Printf("wave version: %s (%s)\n", WaveVersion, BuildTime)
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
	go func() {
		err := shellutil.InitCustomShellStartupFiles()
		if err != nil {
			log.Printf("error initializing wsh and shell-integration files: %v\n", err)
		}
	}()
	window, firstRun, err := wcore.EnsureInitialData()
	if err != nil {
		log.Printf("error ensuring initial data: %v\n", err)
		return
	}
	if firstRun {
		migrateErr := wstore.TryMigrateOldHistory()
		if migrateErr != nil {
			log.Printf("error migrating old history: %v\n", migrateErr)
		}
	}
	if window != nil {
		ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelFn()
		if !firstRun {
			err = wlayout.BootstrapNewWindowLayout(ctx, window)
			if err != nil {
				log.Panicf("error applying new window layout: %v\n", err)
				return
			}
		}
	}
	createMainWshClient()
	installShutdownSignalHandlers()
	startupActivityUpdate()
	go stdinReadWatch()
	go telemetryLoop()
	configWatcher()
	webListener, err := web.MakeTCPListener("web")
	if err != nil {
		log.Printf("error creating web listener: %v\n", err)
		return
	}
	wsListener, err := web.MakeTCPListener("websocket")
	if err != nil {
		log.Printf("error creating websocket listener: %v\n", err)
		return
	}
	go web.RunWebSocketServer(wsListener)
	unixListener, err := web.MakeUnixListener()
	if err != nil {
		log.Printf("error creating unix listener: %v\n", err)
		return
	}
	go func() {
		pidStr := os.Getenv(ReadySignalPidVarName)
		if pidStr != "" {
			_, err := strconv.Atoi(pidStr)
			if err == nil {
				if BuildTime == "" {
					BuildTime = "0"
				}
				// use fmt instead of log here to make sure it goes directly to stderr
				fmt.Fprintf(os.Stderr, "WAVESRV-ESTART ws:%s web:%s version:%s buildtime:%s\n", wsListener.Addr(), webListener.Addr(), WaveVersion, BuildTime)
			}
		}
	}()
	go wshutil.RunWshRpcOverListener(unixListener)
	web.RunWebServer(webListener) // blocking
	runtime.KeepAlive(waveLock)
}
