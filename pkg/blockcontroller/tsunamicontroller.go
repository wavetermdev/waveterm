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
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/tsunami/build"
)

type TsunamiAppProc struct {
	Cmd          *exec.Cmd
	StdoutBuffer *utilds.ReaderLineBuffer
	StderrBuffer *utilds.ReaderLineBuffer // May be nil if stderr was consumed for port detection
	StdinWriter  io.WriteCloser
	Port         int           // Port the tsunami app is listening on
	WaitCh       chan struct{} // Channel that gets closed when cmd.Wait() returns
	WaitRtn      error         // Error returned by cmd.Wait()
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

func getCachesDir() string {
	var cacheDir string
	appBundle := "waveterm"
	if wavebase.IsDevMode() {
		appBundle = "waveterm-dev"
	}

	switch runtime.GOOS {
	case "darwin":
		// macOS: ~/Library/Caches/<appbundle>
		homeDir := wavebase.GetHomeDir()
		cacheDir = filepath.Join(homeDir, "Library", "Caches", appBundle)
	case "linux":
		// Linux: XDG_CACHE_HOME or ~/.cache/<appbundle>
		xdgCache := os.Getenv("XDG_CACHE_HOME")
		if xdgCache != "" {
			cacheDir = filepath.Join(xdgCache, appBundle)
		} else {
			homeDir := wavebase.GetHomeDir()
			cacheDir = filepath.Join(homeDir, ".cache", appBundle)
		}
	case "windows":
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData != "" {
			cacheDir = filepath.Join(localAppData, appBundle, "Cache")
		}
	}

	if cacheDir == "" {
		tmpDir := os.TempDir()
		cacheDir = filepath.Join(tmpDir, appBundle)
	}

	return cacheDir
}

func getTsunamiAppCachePath(scope string, appName string, osArch string) (string, error) {
	cachesDir := getCachesDir()
	tsunamiCacheDir := filepath.Join(cachesDir, "tsunami-build-cache")
	fullAppName := appName + "." + osArch
	if strings.HasPrefix(osArch, "windows") {
		fullAppName = fullAppName + ".exe"
	}
	fullPath := filepath.Join(tsunamiCacheDir, scope, fullAppName)

	// Create the directory if it doesn't exist
	dirPath := filepath.Dir(fullPath)
	err := wavebase.TryMkdirs(dirPath, 0755, "tsunami cache directory")
	if err != nil {
		return "", fmt.Errorf("failed to create tsunami cache directory: %w", err)
	}

	return fullPath, nil
}

func isBuildCacheUpToDate(appPath string) (bool, error) {
	appName := filepath.Base(appPath)

	osArch := runtime.GOOS + "-" + runtime.GOARCH

	cachePath, err := getTsunamiAppCachePath("local", appName, osArch)
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
	c.runLock.Lock()
	defer c.runLock.Unlock()

	scaffoldPath := blockMeta.GetString(waveobj.MetaKey_TsunamiScaffoldPath, "")
	if scaffoldPath == "" {
		return fmt.Errorf("tsunami:scaffoldpath is required")
	}
	scaffoldPath, err := wavebase.ExpandHomeDir(scaffoldPath)
	if err != nil {
		return fmt.Errorf("tsunami:scaffoldpath invalid: %w", err)
	}
	if !filepath.IsAbs(scaffoldPath) {
		return fmt.Errorf("tsunami:scaffoldpath must be absolute: %s", scaffoldPath)
	}

	sdkReplacePath := blockMeta.GetString(waveobj.MetaKey_TsunamiSdkReplacePath, "")
	if sdkReplacePath == "" {
		return fmt.Errorf("tsunami:sdkreplacepath is required")
	}
	sdkReplacePath, err = wavebase.ExpandHomeDir(sdkReplacePath)
	if err != nil {
		return fmt.Errorf("tsunami:sdkreplacepath invalid: %w", err)
	}
	if !filepath.IsAbs(sdkReplacePath) {
		return fmt.Errorf("tsunami:sdkreplacepath must be absolute: %s", sdkReplacePath)
	}

	appPath := blockMeta.GetString(waveobj.MetaKey_TsunamiAppPath, "")
	if appPath == "" {
		return fmt.Errorf("tsunami:apppath is required")
	}
	appPath, err = wavebase.ExpandHomeDir(appPath)
	if err != nil {
		return fmt.Errorf("tsunami:apppath invalid: %w", err)
	}
	if !filepath.IsAbs(appPath) {
		return fmt.Errorf("tsunami:apppath must be absolute: %s", appPath)
	}

	appName := filepath.Base(appPath)
	osArch := runtime.GOOS + "-" + runtime.GOARCH

	cachePath, err := getTsunamiAppCachePath("local", appName, osArch)
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
			NodePath:       nodePath,
		}

		err = build.TsunamiBuild(opts)
		if err != nil {
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

	tsunamiProc, err := runTsunamiAppBinary(ctx, cachePath)
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
			go c.sendStatusUpdate()
		}
		c.runLock.Unlock()
	}()

	return nil
}

func (c *TsunamiController) Stop(graceful bool, newStatus string) error {
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

func runTsunamiAppBinary(ctx context.Context, appBinPath string) (*TsunamiAppProc, error) {
	cmd := exec.CommandContext(ctx, appBinPath, "--close-on-stdin")

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

	stdoutBuffer := utilds.MakeReaderLineBuffer(stdoutPipe, 1000)
	stderrBuffer := utilds.MakeReaderLineBuffer(stderrPipe, 1000)

	err = cmd.Start()
	if err != nil {
		return nil, fmt.Errorf("failed to start tsunami app: %w", err)
	}

	// Create wait channel and tsunami proc first
	waitCh := make(chan struct{})
	tsunamiProc := &TsunamiAppProc{
		Cmd:          cmd,
		StdoutBuffer: stdoutBuffer,
		StderrBuffer: stderrBuffer,
		StdinWriter:  stdinPipe,
		WaitCh:       waitCh,
	}

	// Start goroutine to handle cmd.Wait()
	go func() {
		tsunamiProc.WaitRtn = cmd.Wait()
		close(waitCh)
	}()

	go stdoutBuffer.ReadAll()

	// Monitor stderr for port information
	portChan := make(chan int, 1)
	errChan := make(chan error, 1)

	go func() {
		for {
			line, err := stderrBuffer.ReadLine()
			if err != nil {
				errChan <- fmt.Errorf("stderr buffer error: %w", err)
				return
			}

			port := build.ParseTsunamiPort(line)
			if port > 0 {
				portChan <- port
				return
			}
		}
	}()

	// Wait for either port detection, process death, or context timeout
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
		// Start the stderr ReadAll goroutine now that we have the port
		go stderrBuffer.ReadAll()

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
