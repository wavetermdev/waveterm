// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"runtime"
	"sync"
	"time"

	"github.com/joho/godotenv"
	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filebackup"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/service"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/sigutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcloud"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/web"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshremote"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshserver"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"

	"net/http"
	_ "net/http/pprof"
)

// these are set at build time
var WaveVersion = "0.0.0"
var BuildTime = "0"

const InitialTelemetryWait = 10 * time.Second
const TelemetryTick = 2 * time.Minute
const TelemetryInterval = 4 * time.Hour
const TelemetryInitialCountsWait = 5 * time.Second
const TelemetryCountsInterval = 1 * time.Hour
const BackupCleanupTick = 2 * time.Minute
const BackupCleanupInterval = 4 * time.Hour
const InitialDiagnosticWait = 5 * time.Minute
const DiagnosticTick = 10 * time.Minute

var shutdownOnce sync.Once

func init() {
	envFilePath := os.Getenv("WAVETERM_ENVFILE")
	if envFilePath != "" {
		log.Printf("applying env file: %s\n", envFilePath)
		_ = godotenv.Load(envFilePath)
	}
}

func doShutdown(reason string) {
	shutdownOnce.Do(func() {
		log.Printf("shutting down: %s\n", reason)
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		go blockcontroller.StopAllBlockControllersForShutdown()
		shutdownActivityUpdate()
		sendTelemetryWrapper()
		// TODO deal with flush in progress
		clearTempFiles()
		filestore.WFS.FlushCache(ctx)
		watcher := wconfig.GetWatcher()
		if watcher != nil {
			watcher.Close()
		}
		time.Sleep(500 * time.Millisecond)
		log.Printf("shutdown complete\n")
		os.Exit(0)
	})
}

// watch stdin, kill server if stdin is closed
func stdinReadWatch() {
	defer func() {
		panichandler.PanicHandler("stdinReadWatch", recover())
	}()
	buf := make([]byte, 1024)
	for {
		_, err := os.Stdin.Read(buf)
		if err != nil {
			doShutdown(fmt.Sprintf("stdin closed/error (%v)", err))
			break
		}
	}
}

func startConfigWatcher() {
	watcher := wconfig.GetWatcher()
	if watcher != nil {
		watcher.Start()
	}
}

func telemetryLoop() {
	defer func() {
		panichandler.PanicHandler("telemetryLoop", recover())
	}()
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

func diagnosticLoop() {
	defer func() {
		panichandler.PanicHandler("diagnosticLoop", recover())
	}()
	if os.Getenv("WAVETERM_NOPING") != "" {
		log.Printf("WAVETERM_NOPING set, disabling diagnostic ping\n")
		return
	}
	var lastSentDate string
	time.Sleep(InitialDiagnosticWait)
	for {
		currentDate := time.Now().Format("2006-01-02")
		if lastSentDate == "" || lastSentDate != currentDate {
			if sendDiagnosticPing() {
				lastSentDate = currentDate
			}
		}
		time.Sleep(DiagnosticTick)
	}
}

func sendDiagnosticPing() bool {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	rpcClient := wshclient.GetBareRpcClient()
	isOnline, err := wshclient.NetworkOnlineCommand(rpcClient, &wshrpc.RpcOpts{Route: "electron", Timeout: 2000})
	if err != nil || !isOnline {
		return false
	}
	clientId := wstore.GetClientId()
	usageTelemetry := telemetry.IsTelemetryEnabled()
	wcloud.SendDiagnosticPing(ctx, clientId, usageTelemetry)
	return true
}

func setupTelemetryConfigHandler() {
	watcher := wconfig.GetWatcher()
	if watcher == nil {
		return
	}
	currentConfig := watcher.GetFullConfig()
	currentTelemetryEnabled := currentConfig.Settings.TelemetryEnabled

	watcher.RegisterUpdateHandler(func(newConfig wconfig.FullConfigType) {
		newTelemetryEnabled := newConfig.Settings.TelemetryEnabled
		if newTelemetryEnabled != currentTelemetryEnabled {
			currentTelemetryEnabled = newTelemetryEnabled
			wcore.GoSendNoTelemetryUpdate(newTelemetryEnabled)
		}
	})
}

func backupCleanupLoop() {
	defer func() {
		panichandler.PanicHandler("backupCleanupLoop", recover())
	}()
	var nextCleanup int64
	for {
		if time.Now().Unix() > nextCleanup {
			nextCleanup = time.Now().Add(BackupCleanupInterval).Unix()
			err := filebackup.CleanupOldBackups()
			if err != nil {
				log.Printf("error cleaning up old backups: %v\n", err)
			}
		}
		time.Sleep(BackupCleanupTick)
	}
}

func panicTelemetryHandler(panicName string) {
	activity := wshrpc.ActivityUpdate{NumPanics: 1}
	err := telemetry.UpdateActivity(context.Background(), activity)
	if err != nil {
		log.Printf("error updating activity (panicTelemetryHandler): %v\n", err)
	}
	telemetry.RecordTEvent(context.Background(), telemetrydata.MakeTEvent("debug:panic", telemetrydata.TEventProps{
		PanicType: panicName,
	}))
}

func sendTelemetryWrapper() {
	defer func() {
		panichandler.PanicHandler("sendTelemetryWrapper", recover())
	}()
	ctx, cancelFn := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelFn()
	beforeSendActivityUpdate(ctx)
	clientId := wstore.GetClientId()
	err := wcloud.SendAllTelemetry(clientId)
	if err != nil {
		log.Printf("[error] sending telemetry: %v\n", err)
	}
}

func updateTelemetryCounts(lastCounts telemetrydata.TEventProps) telemetrydata.TEventProps {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	var props telemetrydata.TEventProps
	props.CountBlocks, _ = wstore.DBGetCount[*waveobj.Block](ctx)
	props.CountTabs, _ = wstore.DBGetCount[*waveobj.Tab](ctx)
	props.CountWindows, _ = wstore.DBGetCount[*waveobj.Window](ctx)
	props.CountWorkspaces, _, _ = wstore.DBGetWSCounts(ctx)
	props.CountSSHConn = conncontroller.GetNumSSHHasConnected()
	props.CountWSLConn = wslconn.GetNumWSLHasConnected()
	props.CountViews, _ = wstore.DBGetBlockViewCounts(ctx)

	fullConfig := wconfig.GetWatcher().GetFullConfig()
	customWidgets := fullConfig.CountCustomWidgets()
	customAIPresets := fullConfig.CountCustomAIPresets()
	customSettings := wconfig.CountCustomSettings()
	customAIModes := fullConfig.CountCustomAIModes()

	props.UserSet = &telemetrydata.TEventUserProps{
		SettingsCustomWidgets:   customWidgets,
		SettingsCustomAIPresets: customAIPresets,
		SettingsCustomSettings:  customSettings,
		SettingsCustomAIModes:   customAIModes,
	}

	secretsCount, err := secretstore.CountSecrets()
	if err == nil {
		props.UserSet.SettingsSecretsCount = secretsCount
	}

	if utilfn.CompareAsMarshaledJson(props, lastCounts) {
		return lastCounts
	}
	tevent := telemetrydata.MakeTEvent("app:counts", props)
	err = telemetry.RecordTEvent(ctx, tevent)
	if err != nil {
		log.Printf("error recording counts tevent: %v\n", err)
	}
	return props
}

func updateTelemetryCountsLoop() {
	defer func() {
		panichandler.PanicHandler("updateTelemetryCountsLoop", recover())
	}()
	var nextSend int64
	var lastCounts telemetrydata.TEventProps
	time.Sleep(TelemetryInitialCountsWait)
	for {
		if time.Now().Unix() > nextSend {
			nextSend = time.Now().Add(TelemetryCountsInterval).Unix()
			lastCounts = updateTelemetryCounts(lastCounts)
		}
		time.Sleep(TelemetryTick)
	}
}

func beforeSendActivityUpdate(ctx context.Context) {
	activity := wshrpc.ActivityUpdate{}
	activity.NumTabs, _ = wstore.DBGetCount[*waveobj.Tab](ctx)
	activity.NumBlocks, _ = wstore.DBGetCount[*waveobj.Block](ctx)
	activity.Blocks, _ = wstore.DBGetBlockViewCounts(ctx)
	activity.NumWindows, _ = wstore.DBGetCount[*waveobj.Window](ctx)
	activity.NumSSHConn = conncontroller.GetNumSSHHasConnected()
	activity.NumWSLConn = wslconn.GetNumWSLHasConnected()
	activity.NumWSNamed, activity.NumWS, _ = wstore.DBGetWSCounts(ctx)
	err := telemetry.UpdateActivity(ctx, activity)
	if err != nil {
		log.Printf("error updating before activity: %v\n", err)
	}
}

func startupActivityUpdate(firstLaunch bool) {
	defer func() {
		panichandler.PanicHandler("startupActivityUpdate", recover())
	}()
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	activity := wshrpc.ActivityUpdate{Startup: 1}
	err := telemetry.UpdateActivity(ctx, activity) // set at least one record into activity (don't use go routine wrap here)
	if err != nil {
		log.Printf("error updating startup activity: %v\n", err)
	}
	autoUpdateChannel := telemetry.AutoUpdateChannel()
	autoUpdateEnabled := telemetry.IsAutoUpdateEnabled()
	shellType, shellVersion, shellErr := shellutil.DetectShellTypeAndVersion()
	if shellErr != nil {
		shellType = "error"
		shellVersion = ""
	}
	userSetOnce := &telemetrydata.TEventUserProps{
		ClientInitialVersion: "v" + WaveVersion,
	}
	tosTs := telemetry.GetTosAgreedTs()
	var cohortTime time.Time
	if tosTs > 0 {
		cohortTime = time.UnixMilli(tosTs)
	} else {
		cohortTime = time.Now()
	}
	cohortMonth := cohortTime.Format("2006-01")
	year, week := cohortTime.ISOWeek()
	cohortISOWeek := fmt.Sprintf("%04d-W%02d", year, week)
	userSetOnce.CohortMonth = cohortMonth
	userSetOnce.CohortISOWeek = cohortISOWeek
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	props := telemetrydata.TEventProps{
		UserSet: &telemetrydata.TEventUserProps{
			ClientVersion:       "v" + wavebase.WaveVersion,
			ClientBuildTime:     wavebase.BuildTime,
			ClientArch:          wavebase.ClientArch(),
			ClientOSRelease:     wavebase.UnameKernelRelease(),
			ClientIsDev:         wavebase.IsDevMode(),
			AutoUpdateChannel:   autoUpdateChannel,
			AutoUpdateEnabled:   autoUpdateEnabled,
			LocalShellType:      shellType,
			LocalShellVersion:   shellVersion,
			SettingsTransparent: fullConfig.Settings.WindowTransparent,
		},
		UserSetOnce: userSetOnce,
	}
	if firstLaunch {
		props.AppFirstLaunch = true
	}
	tevent := telemetrydata.MakeTEvent("app:startup", props)
	err = telemetry.RecordTEvent(ctx, tevent)
	if err != nil {
		log.Printf("error recording startup event: %v\n", err)
	}
}

func shutdownActivityUpdate() {
	ctx, cancelFn := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancelFn()
	activity := wshrpc.ActivityUpdate{Shutdown: 1}
	err := telemetry.UpdateActivity(ctx, activity) // do NOT use the go routine wrap here (this needs to be synchronous)
	if err != nil {
		log.Printf("error updating shutdown activity: %v\n", err)
	}
	err = telemetry.TruncateActivityTEventForShutdown(ctx)
	if err != nil {
		log.Printf("error truncating activity t-event for shutdown: %v\n", err)
	}
	tevent := telemetrydata.MakeTEvent("app:shutdown", telemetrydata.TEventProps{})
	err = telemetry.RecordTEvent(ctx, tevent)
	if err != nil {
		log.Printf("error recording shutdown event: %v\n", err)
	}
}

func createMainWshClient() {
	rpc := wshserver.GetMainRpcClient()
	wshfs.RpcClient = rpc
	wshutil.DefaultRouter.RegisterTrustedLeaf(rpc, wshutil.DefaultRoute)
	wps.Broker.SetClient(wshutil.DefaultRouter)
	localInitialEnv := envutil.PruneInitialEnv(envutil.SliceToMap(os.Environ()))
	sockName := wavebase.GetDomainSocketName()
	remoteImpl := wshremote.MakeRemoteRpcServerImpl(nil, wshutil.DefaultRouter, wshclient.GetBareRpcClient(), true, localInitialEnv, sockName)
	localConnWsh := wshutil.MakeWshRpc(wshrpc.RpcContext{Conn: wshrpc.LocalConnName}, remoteImpl, "conn:local")
	go wshremote.RunSysInfoLoop(localConnWsh, wshrpc.LocalConnName)
	wshutil.DefaultRouter.RegisterTrustedLeaf(localConnWsh, wshutil.MakeConnectionRouteId(wshrpc.LocalConnName))
}

func grabAndRemoveEnvVars() error {
	err := authkey.SetAuthKeyFromEnv()
	if err != nil {
		return fmt.Errorf("setting auth key: %v", err)
	}
	err = wavebase.CacheAndRemoveEnvVars()
	if err != nil {
		return err
	}
	err = wcloud.CacheAndRemoveEnvVars()
	if err != nil {
		return err
	}

	// Remove WAVETERM env vars that leak from prod => dev
	os.Unsetenv("WAVETERM_CLIENTID")
	os.Unsetenv("WAVETERM_WORKSPACEID")
	os.Unsetenv("WAVETERM_TABID")
	os.Unsetenv("WAVETERM_BLOCKID")
	os.Unsetenv("WAVETERM_CONN")
	os.Unsetenv("WAVETERM_JWT")
	os.Unsetenv("WAVETERM_VERSION")

	return nil
}

func clearTempFiles() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client: %v", err)
	}
	filestore.WFS.DeleteZone(ctx, client.TempOID)
	return nil
}

func maybeStartPprofServer() {
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if settings.DebugPprofMemProfileRate != nil {
		runtime.MemProfileRate = *settings.DebugPprofMemProfileRate
		log.Printf("set runtime.MemProfileRate to %d\n", runtime.MemProfileRate)
	}
	if settings.DebugPprofPort == nil {
		return
	}
	pprofPort := *settings.DebugPprofPort
	if pprofPort < 1 || pprofPort > 65535 {
		log.Printf("[error] debug:pprofport must be between 1 and 65535, got %d\n", pprofPort)
		return
	}
	go func() {
		addr := fmt.Sprintf("localhost:%d", pprofPort)
		log.Printf("starting pprof server on %s\n", addr)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Printf("[error] pprof server failed: %v\n", err)
		}
	}()
}

func main() {
	log.SetFlags(0) // disable timestamp since electron's winston logger already wraps with timestamp
	log.SetPrefix("[wavesrv] ")
	wavebase.WaveVersion = WaveVersion
	wavebase.BuildTime = BuildTime
	wshutil.DefaultRouter = wshutil.NewWshRouter()
	wshutil.DefaultRouter.SetAsRootRouter()

	err := grabAndRemoveEnvVars()
	if err != nil {
		log.Printf("[error] %v\n", err)
		return
	}
	err = service.ValidateServiceMap()
	if err != nil {
		log.Printf("error validating service map: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveDataDir()
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

	// TODO: rather than ensure this dir exists, we should let the editor recursively create parent dirs on save
	err = wavebase.EnsureWavePresetsDir()
	if err != nil {
		log.Printf("error ensuring wave presets dir: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveCachesDir()
	if err != nil {
		log.Printf("error ensuring wave caches dir: %v\n", err)
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
	log.Printf("wave data dir: %s\n", wavebase.GetWaveDataDir())
	log.Printf("wave config dir: %s\n", wavebase.GetWaveConfigDir())
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
	panichandler.PanicTelemetryHandler = panicTelemetryHandler
	go func() {
		defer func() {
			panichandler.PanicHandler("InitCustomShellStartupFiles", recover())
		}()
		err := shellutil.InitCustomShellStartupFiles()
		if err != nil {
			log.Printf("error initializing wsh and shell-integration files: %v\n", err)
		}
	}()
	firstLaunch, err := wcore.EnsureInitialData()
	if err != nil {
		log.Printf("error ensuring initial data: %v\n", err)
		return
	}
	if firstLaunch {
		log.Printf("first launch detected")
	}
	err = clearTempFiles()
	if err != nil {
		log.Printf("error clearing temp files: %v\n", err)
		return
	}
	err = wcore.InitMainServer()
	if err != nil {
		log.Printf("error initializing mainserver: %v\n", err)
		return
	}

	err = shellutil.FixupWaveZshHistory()
	if err != nil {
		log.Printf("error fixing up wave zsh history: %v\n", err)
	}
	createMainWshClient()
	sigutil.InstallShutdownSignalHandlers(doShutdown)
	sigutil.InstallSIGUSR1Handler()
	startConfigWatcher()
	aiusechat.InitAIModeConfigWatcher()
	maybeStartPprofServer()
	go stdinReadWatch()
	go telemetryLoop()
	go diagnosticLoop()
	setupTelemetryConfigHandler()
	go updateTelemetryCountsLoop()
	go backupCleanupLoop()
	go startupActivityUpdate(firstLaunch) // must be after startConfigWatcher()
	blocklogger.InitBlockLogger()
	jobcontroller.InitJobController()
	blockcontroller.InitBlockController()
	wcore.InitTabIndicatorStore()
	go func() {
		defer func() {
			panichandler.PanicHandler("GetSystemSummary", recover())
		}()
		wavebase.GetSystemSummary()
	}()

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
		if BuildTime == "" {
			BuildTime = "0"
		}
		// use fmt instead of log here to make sure it goes directly to stderr
		fmt.Fprintf(os.Stderr, "WAVESRV-ESTART ws:%s web:%s version:%s buildtime:%s\n", wsListener.Addr(), webListener.Addr(), WaveVersion, BuildTime)
	}()
	go wshutil.RunWshRpcOverListener(unixListener, nil)
	web.RunWebServer(webListener) // blocking
	runtime.KeepAlive(waveLock)
}
