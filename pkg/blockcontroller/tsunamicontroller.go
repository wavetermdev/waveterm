// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

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
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/tsunamiutil"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/waveapputil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
	"github.com/wavetermdev/waveterm/tsunami/build"
)

type TsunamiAppProc struct {
	Cmd         *exec.Cmd
	LineBuffer  *utilds.MultiReaderLineBuffer
	StdinWriter io.WriteCloser
	Port        int           // Port the tsunami app is listening on
	WaitCh      chan struct{} // Channel that gets closed when cmd.Wait() returns
	WaitRtn     error         // Error returned by cmd.Wait()
}

type TsunamiController struct {
	blockId       string
	tabId         string
	runLock       sync.Mutex
	tsunamiProc   *TsunamiAppProc
	statusLock    sync.Mutex
	status        string
	statusVersion int
	exitCode      int
	port          int
}

func (c *TsunamiController) setManifestMetadata(appId string) {
	manifest, err := waveappstore.ReadAppManifest(appId)
	if err != nil {
		return
	}

	blockRef := waveobj.MakeORef(waveobj.OType_Block, c.blockId)
	rtInfo := make(map[string]any)
	rtInfo["tsunami:appmeta"] = manifest.AppMeta
	if manifest.ConfigSchema != nil || manifest.DataSchema != nil {
		schemas := make(map[string]any)
		if manifest.ConfigSchema != nil {
			schemas["config"] = manifest.ConfigSchema
		}
		if manifest.DataSchema != nil {
			schemas["data"] = manifest.DataSchema
		}
		rtInfo["tsunami:schemas"] = schemas
	}
	wstore.SetRTInfo(blockRef, rtInfo)
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_TsunamiUpdateMeta,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, c.blockId).String()},
		Data:   manifest.AppMeta,
	})
}

func (c *TsunamiController) clearSchemas() {
	blockRef := waveobj.MakeORef(waveobj.OType_Block, c.blockId)
	wstore.SetRTInfo(blockRef, map[string]any{
		"tsunami:schemas": nil,
	})
	log.Printf("TsunamiController: cleared schemas for block %s", c.blockId)
}

func isBuildCacheUpToDate(appPath string) (bool, error) {
	appName := build.GetAppName(appPath)

	osArch := runtime.GOOS + "-" + runtime.GOARCH

	cachePath, err := tsunamiutil.GetTsunamiAppCachePath("local", appName, osArch)
	if err != nil {
		return false, err
	}

	cacheInfo, err := os.Stat(cachePath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}

	appModTime, err := build.GetAppModTime(appPath)
	if err != nil {
		return false, err
	}

	cacheModTime := cacheInfo.ModTime()
	return !cacheModTime.Before(appModTime), nil
}

func (c *TsunamiController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	log.Printf("TsunamiController.Start called for block %s", c.blockId)
	c.runLock.Lock()
	defer c.runLock.Unlock()

	scaffoldPath := waveapputil.GetTsunamiScaffoldPath()
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	sdkReplacePath := settings.TsunamiSdkReplacePath
	sdkVersion := settings.TsunamiSdkVersion
	if sdkVersion == "" {
		sdkVersion = waveapputil.DefaultTsunamiSdkVersion
	}
	goPath := settings.TsunamiGoPath

	appPath := blockMeta.GetString(waveobj.MetaKey_TsunamiAppPath, "")
	appId := blockMeta.GetString(waveobj.MetaKey_TsunamiAppId, "")

	if appPath == "" {
		if appId == "" {
			return fmt.Errorf("tsunami:apppath or tsunami:appid is required")
		}
		var err error
		appPath, err = waveappstore.GetAppDir(appId)
		if err != nil {
			return fmt.Errorf("failed to get app directory from tsunami:appid: %w", err)
		}
	} else {
		var err error
		appPath, err = wavebase.ExpandHomeDir(appPath)
		if err != nil {
			return fmt.Errorf("tsunami:apppath invalid: %w", err)
		}
		if !filepath.IsAbs(appPath) {
			return fmt.Errorf("tsunami:apppath must be absolute: %s", appPath)
		}
	}

	if appId != "" {
		c.setManifestMetadata(appId)
	}

	appName := build.GetAppName(appPath)
	osArch := runtime.GOOS + "-" + runtime.GOARCH

	cachePath, err := tsunamiutil.GetTsunamiAppCachePath("local", appName, osArch)
	if err != nil {
		return fmt.Errorf("failed to get cache path: %w", err)
	}

	upToDate, err := isBuildCacheUpToDate(appPath)
	if err != nil {
		return fmt.Errorf("failed to check build cache: %w", err)
	}

	if !upToDate || force {
		nodePath := wavebase.GetWaveAppElectronExecPath()
		if nodePath == "" {
			return fmt.Errorf("electron executable path not set")
		}

		opts := build.BuildOpts{
			AppPath:        appPath,
			Verbose:        true,
			Open:           false,
			KeepTemp:       false,
			OutputFile:     cachePath,
			ScaffoldPath:   scaffoldPath,
			SdkReplacePath: sdkReplacePath,
			SdkVersion:     sdkVersion,
			NodePath:       nodePath,
			GoPath:         goPath,
		}

		err = build.TsunamiBuild(opts)
		if err != nil {
			log.Printf("TsunamiController build error for block %s: %v", c.blockId, err)
			return fmt.Errorf("failed to build tsunami app: %w", err)
		}
	}

	info, err := os.Stat(cachePath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("app cache does not exist: %s", cachePath)
		}
		return fmt.Errorf("failed to stat app cache: %w", err)
	}

	if runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
		return fmt.Errorf("app cache is not executable: %s", cachePath)
	}

	tsunamiProc, err := runTsunamiAppBinary(ctx, cachePath, appPath, blockMeta)
	if err != nil {
		return fmt.Errorf("failed to run tsunami app: %w", err)
	}

	c.tsunamiProc = tsunamiProc
	c.WithStatusLock(func() {
		c.status = Status_Running
		c.port = tsunamiProc.Port
	})
	go c.sendStatusUpdate()

	// Monitor process completion
	go func() {
		<-tsunamiProc.WaitCh
		c.runLock.Lock()
		if c.tsunamiProc == tsunamiProc {
			c.tsunamiProc = nil
			c.WithStatusLock(func() {
				c.status = Status_Done
				c.port = 0
				c.exitCode = exitCodeFromWaitErr(tsunamiProc.WaitRtn)
			})
			c.clearSchemas()
			go c.sendStatusUpdate()
		}
		c.runLock.Unlock()
	}()

	return nil
}

func (c *TsunamiController) Stop(graceful bool, newStatus string) error {
	log.Printf("TsunamiController.Stop called for block %s (graceful: %t, newStatus: %s)", c.blockId, graceful, newStatus)
	c.runLock.Lock()
	defer c.runLock.Unlock()

	if c.tsunamiProc == nil {
		return nil
	}

	if c.tsunamiProc.Cmd.Process != nil {
		c.tsunamiProc.Cmd.Process.Kill()
	}

	if c.tsunamiProc.StdinWriter != nil {
		c.tsunamiProc.StdinWriter.Close()
	}

	c.tsunamiProc = nil
	if newStatus == "" {
		newStatus = Status_Done
	}
	c.WithStatusLock(func() {
		c.status = newStatus
		c.port = 0
	})
	c.clearSchemas()
	go c.sendStatusUpdate()
	return nil
}

func (c *TsunamiController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	var rtn *BlockControllerRuntimeStatus
	c.WithStatusLock(func() {
		c.statusVersion++
		rtn = &BlockControllerRuntimeStatus{
			BlockId:           c.blockId,
			Version:           c.statusVersion,
			ShellProcStatus:   c.status,
			ShellProcExitCode: c.exitCode,
		}

		if c.status == Status_Running && c.port > 0 {
			rtn.TsunamiPort = c.port
		}
	})

	return rtn
}

func (c *TsunamiController) SendInput(input *BlockInputUnion) error {
	return fmt.Errorf("tsunami controller send input not implemented")
}

func runTsunamiAppBinary(ctx context.Context, appBinPath string, appPath string, blockMeta waveobj.MetaMapType) (*TsunamiAppProc, error) {
	cmd := exec.Command(appBinPath)
	cmd.Env = append(os.Environ(), "TSUNAMI_CLOSEONSTDIN=1")

	// Add TsunamiEnv variables if configured
	tsunamiEnv := blockMeta.GetMap(waveobj.MetaKey_TsunamiEnv)
	for key, value := range tsunamiEnv {
		if strValue, ok := value.(string); ok {
			cmd.Env = append(cmd.Env, key+"="+strValue)
		}
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

	appName := build.GetAppName(appPath)

	lineBuffer := utilds.MakeMultiReaderLineBuffer(1000)
	portChan := make(chan int, 1)
	portFound := false

	lineBuffer.SetLineCallback(func(line string) {
		log.Printf("[tsunami:%s] %s\n", appName, line)

		if !portFound {
			if port := build.ParseTsunamiPort(line); port > 0 {
				portFound = true
				portChan <- port
			}
		}
	})

	err = cmd.Start()
	if err != nil {
		return nil, fmt.Errorf("failed to start tsunami app: %w", err)
	}

	// Create wait channel and tsunami proc first
	waitCh := make(chan struct{})
	tsunamiProc := &TsunamiAppProc{
		Cmd:         cmd,
		LineBuffer:  lineBuffer,
		StdinWriter: stdinPipe,
		WaitCh:      waitCh,
	}

	// Start goroutine to handle cmd.Wait()
	go func() {
		tsunamiProc.WaitRtn = cmd.Wait()
		log.Printf("WAIT RETURN: %v\n", tsunamiProc.WaitRtn)
		if err := tsunamiProc.WaitRtn; err != nil {
			if ee, ok := err.(*exec.ExitError); ok {
				if ws, ok := ee.ProcessState.Sys().(syscall.WaitStatus); ok {
					if ws.Signaled() {
						sig := ws.Signal()
						log.Printf("tsunami proc killed by signal: %s (%d)", sig, int(sig))
					} else {
						log.Printf("tsunami proc exited with code %d", ee.ExitCode())
					}
				}
			} else {
				log.Printf("tsunami proc error: %v", err)
			}
		}

		close(waitCh)
	}()

	// Start reading both stdout and stderr
	go lineBuffer.ReadAll(stdoutPipe)
	go lineBuffer.ReadAll(stderrPipe)

	// Wait for either port detection, process death, or context timeout
	errChan := make(chan error, 1)
	go func() {
		<-tsunamiProc.WaitCh
		select {
		case <-portChan:
			// Port already found, nothing to do
		default:
			errChan <- fmt.Errorf("tsunami process died before emitting listening message")
		}
	}()

	select {
	case port := <-portChan:
		tsunamiProc.Port = port
		return tsunamiProc, nil
	case err := <-errChan:
		cmd.Process.Kill()
		return nil, err
	case <-ctx.Done():
		cmd.Process.Kill()
		return nil, fmt.Errorf("timeout waiting for tsunami port: %w", ctx.Err())
	}
}

func MakeTsunamiController(tabId string, blockId string) Controller {
	log.Printf("make tsunami controller: %s %s\n", tabId, blockId)
	return &TsunamiController{
		blockId: blockId,
		tabId:   tabId,
		status:  Status_Init,
	}
}

// requires the lock (so do not call while holding statusLock)
func (c *TsunamiController) sendStatusUpdate() {
	rtStatus := c.GetRuntimeStatus()
	log.Printf("sending blockcontroller update %#v\n", rtStatus)
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_ControllerStatus,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Tab, c.tabId).String(),
			waveobj.MakeORef(waveobj.OType_Block, c.blockId).String(),
		},
		Data: rtStatus,
	})
}

func (c *TsunamiController) WithStatusLock(fn func()) {
	c.statusLock.Lock()
	defer c.statusLock.Unlock()
	fn()
}

func exitCodeFromWaitErr(waitErr error) int {
	if waitErr != nil {
		if exitError, ok := waitErr.(*exec.ExitError); ok {
			return exitError.ExitCode()
		} else {
			return 1
		}
	} else {
		return 0
	}
}
