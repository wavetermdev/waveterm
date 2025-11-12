// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package buildercontroller

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/tsunami/build"
	"github.com/wavetermdev/waveterm/tsunami/engine"
)

const (
	BuilderStatus_Init     = "init"
	BuilderStatus_Building = "building"
	BuilderStatus_Running  = "running"
	BuilderStatus_Error    = "error"
	BuilderStatus_Stopped  = "stopped"
)

type BuilderProcess struct {
	Cmd         *exec.Cmd
	StdinWriter io.WriteCloser
	Port        int
	WaitCh      chan struct{}
	WaitRtn     error
}

type BuildResult struct {
	Success      bool   `json:"success"`
	ErrorMessage string `json:"errormessage,omitempty"`
	BuildOutput  string `json:"buildoutput"`
}

type BuilderController struct {
	lock          sync.Mutex
	builderId     string
	appId         string
	process       *BuilderProcess
	outputBuffer  *utilds.MultiReaderLineBuffer
	statusLock    sync.Mutex
	status        string
	statusVersion int
	port          int
	exitCode      int
	errorMsg      string
}

var (
	controllerMap = make(map[string]*BuilderController) // key is builderid
	mapLock       sync.Mutex
)

func GetOrCreateController(builderId string) *BuilderController {
	mapLock.Lock()
	defer mapLock.Unlock()

	bc := controllerMap[builderId]
	if bc != nil {
		return bc
	}

	bc = &BuilderController{
		builderId:     builderId,
		status:        BuilderStatus_Init,
		statusVersion: 0,
	}
	controllerMap[builderId] = bc

	return bc
}

func DeleteController(builderId string) {
	mapLock.Lock()
	bc := controllerMap[builderId]
	delete(controllerMap, builderId)
	mapLock.Unlock()

	if bc != nil {
		bc.Stop()
	}
}

func GetBuilderAppExecutablePath(appPath string) (string, error) {
	binDir := filepath.Join(appPath, "bin")

	binaryName := "app"
	if runtime.GOOS == "windows" {
		binaryName = "app.exe"
	}
	binPath := filepath.Join(binDir, binaryName)

	err := wavebase.TryMkdirs(binDir, 0755, "app bin directory")
	if err != nil {
		return "", fmt.Errorf("failed to create app bin directory: %w", err)
	}

	return binPath, nil
}

func Shutdown() {
	mapLock.Lock()
	controllers := make([]*BuilderController, 0, len(controllerMap))
	for _, bc := range controllerMap {
		controllers = append(controllers, bc)
	}
	mapLock.Unlock()

	for _, bc := range controllers {
		bc.Stop()
	}
}

func (bc *BuilderController) waitForBuildDone(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		bc.statusLock.Lock()
		status := bc.status
		bc.statusLock.Unlock()

		if status != BuilderStatus_Building {
			return nil
		}

		time.Sleep(100 * time.Millisecond)
	}
}

func (bc *BuilderController) Start(ctx context.Context, appId string, builderEnv map[string]string) error {
	if err := bc.waitForBuildDone(ctx); err != nil {
		return err
	}

	bc.lock.Lock()
	defer bc.lock.Unlock()

	if bc.appId != appId && bc.process != nil {
		log.Printf("BuilderController: stopping previous app %s for builder %s", bc.appId, bc.builderId)
		bc.stopProcess_nolock()
	}

	bc.appId = appId
	bc.outputBuffer = utilds.MakeMultiReaderLineBuffer(1000)
	bc.setStatus_nolock(BuilderStatus_Building, 0, 0, "")

	bc.publishOutputLine("", true)

	bc.outputBuffer.SetLineCallback(func(line string) {
		bc.publishOutputLine(line, false)
	})

	buildCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	go func() {
		defer cancel()
		defer func() {
			panichandler.PanicHandler(fmt.Sprintf("buildercontroller[%s].buildAndRun", bc.builderId), recover())
		}()
		bc.buildAndRun(buildCtx, appId, builderEnv, nil)
	}()

	return nil
}

func (bc *BuilderController) buildAndRun(ctx context.Context, appId string, builderEnv map[string]string, resultCh chan<- *BuildResult) {
	appNS, _, err := waveappstore.ParseAppId(appId)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("failed to parse app id: %w", err), resultCh)
		return
	}

	appPath, err := waveappstore.GetAppDir(appId)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("failed to get app directory: %w", err), resultCh)
		return
	}

	cachePath, err := GetBuilderAppExecutablePath(appPath)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("failed to get builder executable path: %w", err), resultCh)
		return
	}

	nodePath := wavebase.GetWaveAppElectronExecPath()
	if nodePath == "" {
		bc.handleBuildError(fmt.Errorf("electron executable path not set"), resultCh)
		return
	}

	settings := wconfig.GetWatcher().GetFullConfig().Settings
	scaffoldPath := settings.TsunamiScaffoldPath
	if scaffoldPath == "" {
		scaffoldPath = filepath.Join(wavebase.GetWaveAppPath(), "tsunamiscaffold")
	}
	sdkReplacePath := settings.TsunamiSdkReplacePath
	sdkVersion := settings.TsunamiSdkVersion
	if sdkVersion == "" {
		sdkVersion = "v0.12.2"
	}
	goPath := settings.TsunamiGoPath

	outputCapture := build.MakeOutputCapture()
	_, err = build.TsunamiBuildInternal(build.BuildOpts{
		AppPath:        appPath,
		AppNS:          appNS,
		Verbose:        true,
		Open:           false,
		KeepTemp:       false,
		OutputFile:     cachePath,
		ScaffoldPath:   scaffoldPath,
		SdkReplacePath: sdkReplacePath,
		SdkVersion:     sdkVersion,
		NodePath:       nodePath,
		GoPath:         goPath,
		OutputCapture:  outputCapture,
		MoveFileBack:   true,
	})

	for _, line := range outputCapture.GetLines() {
		bc.outputBuffer.AddLine(line)
	}

	if err != nil {
		bc.handleBuildError(fmt.Errorf("build failed: %w", err), resultCh)
		return
	}

	info, err := os.Stat(cachePath)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("build output not found: %w", err), resultCh)
		return
	}

	if runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
		bc.handleBuildError(fmt.Errorf("build output is not executable"), resultCh)
		return
	}

	if resultCh != nil {
		buildOutput := ""
		if bc.outputBuffer != nil {
			lines := bc.outputBuffer.GetLines()
			buildOutput = strings.Join(lines, "\n")
		}
		select {
		case resultCh <- &BuildResult{
			Success:     true,
			BuildOutput: buildOutput,
		}:
		default:
		}
	}

	process, err := bc.runBuilderApp(ctx, appId, cachePath, builderEnv)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("failed to run app: %w", err), resultCh)
		return
	}

	bc.lock.Lock()
	bc.process = process
	bc.setStatus_nolock(BuilderStatus_Running, process.Port, 0, "")
	bc.lock.Unlock()

	go func() {
		<-process.WaitCh
		bc.lock.Lock()
		if bc.process == process {
			bc.process = nil
			exitCode := exitCodeFromWaitErr(process.WaitRtn)
			bc.setStatus_nolock(BuilderStatus_Stopped, 0, exitCode, "")
		}
		bc.lock.Unlock()
	}()
}

func (bc *BuilderController) runBuilderApp(ctx context.Context, appId string, appBinPath string, builderEnv map[string]string) (*BuilderProcess, error) {
	manifest, err := waveappstore.ReadAppManifest(appId)
	if err != nil {
		return nil, fmt.Errorf("failed to read app manifest: %w", err)
	}

	secretBindings, err := waveappstore.ReadAppSecretBindings(appId)
	if err != nil {
		return nil, fmt.Errorf("failed to read secret bindings: %w", err)
	}

	secretEnv, err := waveappstore.BuildAppSecretEnv(appId, manifest, secretBindings)
	if err != nil {
		return nil, fmt.Errorf("failed to build secret environment: %w", err)
	}

	if builderEnv == nil {
		builderEnv = make(map[string]string)
	}
	for k, v := range secretEnv {
		builderEnv[k] = v
	}

	cmd := exec.Command(appBinPath)
	cmd.Env = append(os.Environ(), "TSUNAMI_CLOSEONSTDIN=1")

	for key, value := range builderEnv {
		cmd.Env = append(cmd.Env, key+"="+value)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	portChan := make(chan int, 1)
	portFound := false

	bc.outputBuffer.SetLineCallback(func(line string) {
		if !portFound {
			if port := build.ParseTsunamiPort(line); port > 0 {
				portFound = true
				portChan <- port
			}
		}
		bc.publishOutputLine(line, false)
	})

	err = cmd.Start()
	if err != nil {
		return nil, fmt.Errorf("failed to start process: %w", err)
	}

	waitCh := make(chan struct{})
	process := &BuilderProcess{
		Cmd:         cmd,
		StdinWriter: stdinPipe,
		WaitCh:      waitCh,
	}

	go func() {
		process.WaitRtn = cmd.Wait()
		close(waitCh)
	}()

	go bc.outputBuffer.ReadAll(stdoutPipe)
	go bc.outputBuffer.ReadAll(stderrPipe)

	errChan := make(chan error, 1)
	go func() {
		<-process.WaitCh
		select {
		case <-portChan:
		default:
			errChan <- fmt.Errorf("process died before emitting port")
		}
	}()

	timeout := time.NewTimer(5 * time.Second)
	defer timeout.Stop()

	select {
	case port := <-portChan:
		process.Port = port
		return process, nil
	case err := <-errChan:
		cmd.Process.Kill()
		return nil, err
	case <-timeout.C:
		cmd.Process.Kill()
		return nil, fmt.Errorf("timeout waiting for port")
	case <-ctx.Done():
		cmd.Process.Kill()
		return nil, fmt.Errorf("cancelled while waiting for app port: %w", ctx.Err())
	}
}

func (bc *BuilderController) handleBuildError(err error, resultCh chan<- *BuildResult) {
	bc.lock.Lock()
	defer bc.lock.Unlock()
	bc.setStatus_nolock(BuilderStatus_Error, 0, 1, err.Error())

	if resultCh != nil {
		buildOutput := ""
		if bc.outputBuffer != nil {
			lines := bc.outputBuffer.GetLines()
			buildOutput = strings.Join(lines, "\n")
		}
		select {
		case resultCh <- &BuildResult{
			Success:      false,
			ErrorMessage: err.Error(),
			BuildOutput:  buildOutput,
		}:
		default:
		}
	}
}

func (bc *BuilderController) RestartAndWaitForBuild(ctx context.Context, appId string, builderEnv map[string]string) (*BuildResult, error) {
	if err := bc.waitForBuildDone(ctx); err != nil {
		return nil, err
	}

	resultCh := make(chan *BuildResult, 1)

	bc.lock.Lock()
	if bc.appId != appId && bc.process != nil {
		log.Printf("BuilderController: stopping previous app %s for builder %s", bc.appId, bc.builderId)
		bc.stopProcess_nolock()
	}

	bc.appId = appId
	bc.outputBuffer = utilds.MakeMultiReaderLineBuffer(1000)
	bc.setStatus_nolock(BuilderStatus_Building, 0, 0, "")

	bc.publishOutputLine("", true)

	bc.outputBuffer.SetLineCallback(func(line string) {
		bc.publishOutputLine(line, false)
	})
	bc.lock.Unlock()

	time.Sleep(500 * time.Millisecond)

	buildCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	go func() {
		defer cancel()
		defer func() {
			panichandler.PanicHandler(fmt.Sprintf("buildercontroller[%s].buildAndRun", bc.builderId), recover())
		}()
		bc.buildAndRun(buildCtx, appId, builderEnv, resultCh)
	}()

	select {
	case result := <-resultCh:
		return result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (bc *BuilderController) Stop() error {
	if err := bc.waitForBuildDone(context.Background()); err != nil {
		return err
	}

	bc.lock.Lock()
	defer bc.lock.Unlock()
	bc.stopProcess_nolock()
	bc.setStatus_nolock(BuilderStatus_Stopped, 0, 0, "")
	return nil
}

func (bc *BuilderController) stopProcess_nolock() {
	if bc.process == nil {
		return
	}

	if bc.process.Cmd.Process != nil {
		bc.process.Cmd.Process.Kill()
	}

	if bc.process.StdinWriter != nil {
		bc.process.StdinWriter.Close()
	}

	bc.process = nil
}

func (bc *BuilderController) GetStatus() BuilderStatusData {
	bc.statusLock.Lock()
	defer bc.statusLock.Unlock()

	bc.statusVersion++
	statusData := BuilderStatusData{
		Status:   bc.status,
		Port:     bc.port,
		ExitCode: bc.exitCode,
		ErrorMsg: bc.errorMsg,
		Version:  bc.statusVersion,
	}

	if bc.appId != "" {
		manifest, err := waveappstore.ReadAppManifest(bc.appId)
		if err == nil {
			statusData.Manifest = manifest
		}

		secretBindings, err := waveappstore.ReadAppSecretBindings(bc.appId)
		if err == nil {
			statusData.SecretBindings = secretBindings
		}

		if manifest != nil && secretBindings != nil {
			_, err := waveappstore.BuildAppSecretEnv(bc.appId, manifest, secretBindings)
			statusData.SecretBindingsComplete = (err == nil)
		}
	}

	return statusData
}

func (bc *BuilderController) GetOutput() []string {
	if bc.outputBuffer == nil {
		return []string{}
	}
	return bc.outputBuffer.GetLines()
}

func (bc *BuilderController) setStatus_nolock(status string, port int, exitCode int, errorMsg string) {
	bc.statusLock.Lock()
	bc.status = status
	bc.port = port
	bc.exitCode = exitCode
	bc.errorMsg = errorMsg
	bc.statusLock.Unlock()

	go bc.publishStatus()
}

func (bc *BuilderController) publishStatus() {
	status := bc.GetStatus()
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BuilderStatus,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Builder, bc.builderId).String()},
		Data:   status,
	})
}

func (bc *BuilderController) publishOutputLine(line string, reset bool) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BuilderOutput,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Builder, bc.builderId).String()},
		Data: map[string]any{
			"lines": []string{line},
			"reset": reset,
		},
	})
}

type BuilderStatusData struct {
	Status                 string                `json:"status"`
	Port                   int                   `json:"port,omitempty"`
	ExitCode               int                   `json:"exitcode,omitempty"`
	ErrorMsg               string                `json:"errormsg,omitempty"`
	Version                int                   `json:"version"`
	Manifest               *engine.AppManifest   `json:"manifest,omitempty"`
	SecretBindings         map[string]string     `json:"secretbindings,omitempty"`
	SecretBindingsComplete bool                  `json:"secretbindingscomplete"`
}

func exitCodeFromWaitErr(waitErr error) int {
	if waitErr == nil {
		return 0
	}
	if exitError, ok := waitErr.(*exec.ExitError); ok {
		return exitError.ExitCode()
	}
	return 1
}
