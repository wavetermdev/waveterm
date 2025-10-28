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
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/tsunami/build"
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

	cachesDir := wavebase.GetWaveCachesDir()
	builderDir := filepath.Join(cachesDir, "builder", builderId)
	if err := os.RemoveAll(builderDir); err != nil {
		log.Printf("failed to remove builder cache directory for %s: %v", builderId, err)
	}
}

func GetBuilderAppExecutablePath(builderId string, appName string) (string, error) {
	cachesDir := wavebase.GetWaveCachesDir()
	builderDir := filepath.Join(cachesDir, "builder", builderId)

	binaryName := appName
	if runtime.GOOS == "windows" {
		binaryName = binaryName + ".exe"
	}
	cachePath := filepath.Join(builderDir, binaryName)

	err := wavebase.TryMkdirs(builderDir, 0755, "builder cache directory")
	if err != nil {
		return "", fmt.Errorf("failed to create builder cache directory: %w", err)
	}

	return cachePath, nil
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

	cachesDir := wavebase.GetWaveCachesDir()
	builderCacheDir := filepath.Join(cachesDir, "builder")
	if err := os.RemoveAll(builderCacheDir); err != nil {
		log.Printf("failed to remove builder cache directory: %v", err)
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

func (bc *BuilderController) Start(ctx context.Context, appId string, appPath string, scaffoldPath string, sdkReplacePath string, builderEnv map[string]string) error {
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

	go bc.buildAndRun(ctx, appPath, scaffoldPath, sdkReplacePath, builderEnv)

	return nil
}

func (bc *BuilderController) buildAndRun(ctx context.Context, appPath string, scaffoldPath string, sdkReplacePath string, builderEnv map[string]string) {
	defer panicRecover(bc.builderId)

	appName := build.GetAppName(appPath)

	cachePath, err := GetBuilderAppExecutablePath(bc.builderId, appName)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("failed to get builder executable path: %w", err))
		return
	}

	nodePath := wavebase.GetWaveAppElectronExecPath()
	if nodePath == "" {
		bc.handleBuildError(fmt.Errorf("electron executable path not set"))
		return
	}

	_, err = build.TsunamiBuildInternal(build.BuildOpts{
		AppPath:        appPath,
		Verbose:        true,
		Open:           false,
		KeepTemp:       false,
		OutputFile:     cachePath,
		ScaffoldPath:   scaffoldPath,
		SdkReplacePath: sdkReplacePath,
		NodePath:       nodePath,
	})
	if err != nil {
		bc.handleBuildError(fmt.Errorf("build failed: %w", err))
		return
	}

	info, err := os.Stat(cachePath)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("build output not found: %w", err))
		return
	}

	if runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
		bc.handleBuildError(fmt.Errorf("build output is not executable"))
		return
	}

	process, err := bc.runBuilderApp(ctx, cachePath, builderEnv)
	if err != nil {
		bc.handleBuildError(fmt.Errorf("failed to run app: %w", err))
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

func (bc *BuilderController) runBuilderApp(ctx context.Context, appBinPath string, builderEnv map[string]string) (*BuilderProcess, error) {
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

	timeout := time.NewTimer(30 * time.Second)
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
		return nil, ctx.Err()
	}
}

func (bc *BuilderController) handleBuildError(err error) {
	bc.lock.Lock()
	defer bc.lock.Unlock()
	bc.setStatus_nolock(BuilderStatus_Error, 0, 1, err.Error())
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
	return BuilderStatusData{
		Status:   bc.status,
		Port:     bc.port,
		ExitCode: bc.exitCode,
		ErrorMsg: bc.errorMsg,
		Version:  bc.statusVersion,
	}
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
	Status   string `json:"status"`
	Port     int    `json:"port,omitempty"`
	ExitCode int    `json:"exitcode,omitempty"`
	ErrorMsg string `json:"errormsg,omitempty"`
	Version  int    `json:"version"`
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

func panicRecover(builderId string) {
	if r := recover(); r != nil {
		log.Printf("BuilderController panic for builder %s: %v", builderId, r)
	}
}
