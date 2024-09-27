// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavebase

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/alexflint/go-filemutex"
)

// set by main-server.go
var WaveVersion = "0.0.0"
var BuildTime = "0"

const DefaultWaveHome = "~/.waveterm"
const DevWaveHome = "~/.waveterm-dev"
const WaveHomeVarName = "WAVETERM_HOME"
const WaveDevVarName = "WAVETERM_DEV"
const WaveLockFile = "wave.lock"
const DomainSocketBaseName = "wave.sock"
const WaveDBDir = "db"
const JwtSecret = "waveterm" // TODO generate and store this
const ConfigDir = "config"

var baseLock = &sync.Mutex{}
var ensureDirCache = map[string]bool{}

func IsDevMode() bool {
	pdev := os.Getenv(WaveDevVarName)
	return pdev != ""
}

func GetHomeDir() string {
	homeVar, err := os.UserHomeDir()
	if err != nil {
		return "/"
	}
	return homeVar
}

func ExpandHomeDir(pathStr string) (string, error) {
	if pathStr != "~" && !strings.HasPrefix(pathStr, "~/") {
		return filepath.Clean(pathStr), nil
	}
	homeDir := GetHomeDir()
	if pathStr == "~" {
		return homeDir, nil
	}
	expandedPath := filepath.Clean(filepath.Join(homeDir, pathStr[2:]))
	absPath, err := filepath.Abs(filepath.Join(homeDir, expandedPath))
	if err != nil || !strings.HasPrefix(absPath, homeDir) {
		return "", fmt.Errorf("potential path traversal detected for path %s", pathStr)
	}
	return expandedPath, nil
}

func ExpandHomeDirSafe(pathStr string) string {
	path, _ := ExpandHomeDir(pathStr)
	return path
}

func ReplaceHomeDir(pathStr string) string {
	homeDir := GetHomeDir()
	if pathStr == homeDir {
		return "~"
	}
	if strings.HasPrefix(pathStr, homeDir+"/") {
		return "~" + pathStr[len(homeDir):]
	}
	return pathStr
}

func GetDomainSocketName() string {
	return filepath.Join(GetWaveHomeDir(), DomainSocketBaseName)
}

func GetWaveHomeDir() string {
	homeVar := os.Getenv(WaveHomeVarName)
	if homeVar != "" {
		return ExpandHomeDirSafe(homeVar)
	}
	if IsDevMode() {
		return ExpandHomeDirSafe(DevWaveHome)
	}
	return ExpandHomeDirSafe(DefaultWaveHome)
}

func EnsureWaveHomeDir() error {
	return CacheEnsureDir(GetWaveHomeDir(), "wavehome", 0700, "wave home directory")
}

func EnsureWaveDBDir() error {
	return CacheEnsureDir(filepath.Join(GetWaveHomeDir(), WaveDBDir), "wavedb", 0700, "wave db directory")
}

func EnsureWaveConfigDir() error {
	return CacheEnsureDir(filepath.Join(GetWaveHomeDir(), ConfigDir), "waveconfig", 0700, "wave config directory")
}

func CacheEnsureDir(dirName string, cacheKey string, perm os.FileMode, dirDesc string) error {
	baseLock.Lock()
	ok := ensureDirCache[cacheKey]
	baseLock.Unlock()
	if ok {
		return nil
	}
	err := TryMkdirs(dirName, perm, dirDesc)
	if err != nil {
		return err
	}
	baseLock.Lock()
	ensureDirCache[cacheKey] = true
	baseLock.Unlock()
	return nil
}

func TryMkdirs(dirName string, perm os.FileMode, dirDesc string) error {
	info, err := os.Stat(dirName)
	if errors.Is(err, fs.ErrNotExist) {
		err = os.MkdirAll(dirName, perm)
		if err != nil {
			return fmt.Errorf("cannot make %s %q: %w", dirDesc, dirName, err)
		}
		info, err = os.Stat(dirName)
	}
	if err != nil {
		return fmt.Errorf("error trying to stat %s: %w", dirDesc, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s %q must be a directory", dirDesc, dirName)
	}
	return nil
}

var osLangOnce = &sync.Once{}
var osLang string

func determineLang() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	if runtime.GOOS == "darwin" {
		out, err := exec.CommandContext(ctx, "defaults", "read", "-g", "AppleLocale").CombinedOutput()
		if err != nil {
			log.Printf("error executing 'defaults read -g AppleLocale': %v\n", err)
			return ""
		}
		strOut := string(out)
		truncOut := strings.Split(strOut, "@")[0]
		return strings.TrimSpace(truncOut) + ".UTF-8"
	} else if runtime.GOOS == "win32" {
		out, err := exec.CommandContext(ctx, "Get-Culture", "|", "select", "-exp", "Name").CombinedOutput()
		if err != nil {
			log.Printf("error executing 'Get-Culture | select -exp Name': %v\n", err)
			return ""
		}
		return strings.TrimSpace(string(out)) + ".UTF-8"
	} else {
		// this is specifically to get the wavesrv LANG so waveshell
		// on a remote uses the same LANG
		return os.Getenv("LANG")
	}
}

func DetermineLang() string {
	osLangOnce.Do(func() {
		osLang = determineLang()
	})
	return osLang
}

func DetermineLocale() string {
	truncated := strings.Split(DetermineLang(), ".")[0]
	if truncated == "" {
		return "C"
	}
	return strings.Replace(truncated, "_", "-", -1)
}

func AcquireWaveLock() (*filemutex.FileMutex, error) {
	homeDir := GetWaveHomeDir()
	lockFileName := filepath.Join(homeDir, WaveLockFile)
	log.Printf("[base] acquiring lock on %s\n", lockFileName)
	m, err := filemutex.New(lockFileName)
	if err != nil {
		return nil, err
	}

	err = m.TryLock()
	return m, err
}

func ClientArch() string {
	return fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
}

var releaseRegex = regexp.MustCompile(`^(\d+\.\d+\.\d+)`)
var osReleaseOnce = &sync.Once{}
var osRelease string

func unameKernelRelease() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	out, err := exec.CommandContext(ctx, "uname", "-r").CombinedOutput()
	if err != nil {
		log.Printf("error executing uname -r: %v\n", err)
		return "-"
	}
	releaseStr := strings.TrimSpace(string(out))
	m := releaseRegex.FindStringSubmatch(releaseStr)
	if m == nil || len(m) < 2 {
		log.Printf("invalid uname -r output: [%s]\n", releaseStr)
		return "-"
	}
	return m[1]
}

func UnameKernelRelease() string {
	osReleaseOnce.Do(func() {
		osRelease = unameKernelRelease()
	})
	return osRelease
}
