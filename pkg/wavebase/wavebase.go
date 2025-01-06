// Copyright 2025, Command Line Inc.
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

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// set by main-server.go
var WaveVersion = "0.0.0"
var BuildTime = "0"

const (
	WaveConfigHomeEnvVar = "WAVETERM_CONFIG_HOME"
	WaveDataHomeEnvVar   = "WAVETERM_DATA_HOME"
	WaveAppPathVarName   = "WAVETERM_APP_PATH"
	WaveDevVarName       = "WAVETERM_DEV"
	WaveDevViteVarName   = "WAVETERM_DEV_VITE"
)

var ConfigHome_VarCache string // caches WAVETERM_CONFIG_HOME
var DataHome_VarCache string   // caches WAVETERM_DATA_HOME
var AppPath_VarCache string    // caches WAVETERM_APP_PATH
var Dev_VarCache string        // caches WAVETERM_DEV

const WaveLockFile = "wave.lock"
const DomainSocketBaseName = "wave.sock"
const RemoteDomainSocketBaseName = "wave-remote.sock"
const WaveDBDir = "db"
const JwtSecret = "waveterm" // TODO generate and store this
const ConfigDir = "config"
const RemoteWaveHomeDirName = ".waveterm"
const RemoteWshBinDirName = "bin"
const RemoteFullWshBinPath = "~/.waveterm/bin/wsh"
const RemoteFullDomainSocketPath = "~/.waveterm/wave-remote.sock"

const AppPathBinDir = "bin"

var baseLock = &sync.Mutex{}
var ensureDirCache = map[string]bool{}

var SupportedWshBinaries = map[string]bool{
	"darwin-x64":    true,
	"darwin-arm64":  true,
	"linux-x64":     true,
	"linux-arm64":   true,
	"windows-x64":   true,
	"windows-arm64": true,
}

type FDLock interface {
	Close() error
}

func CacheAndRemoveEnvVars() error {
	ConfigHome_VarCache = os.Getenv(WaveConfigHomeEnvVar)
	if ConfigHome_VarCache == "" {
		return fmt.Errorf(WaveConfigHomeEnvVar + " not set")
	}
	os.Unsetenv(WaveConfigHomeEnvVar)
	DataHome_VarCache = os.Getenv(WaveDataHomeEnvVar)
	if DataHome_VarCache == "" {
		return fmt.Errorf("%s not set", WaveDataHomeEnvVar)
	}
	os.Unsetenv(WaveDataHomeEnvVar)
	AppPath_VarCache = os.Getenv(WaveAppPathVarName)
	os.Unsetenv(WaveAppPathVarName)
	Dev_VarCache = os.Getenv(WaveDevVarName)
	os.Unsetenv(WaveDevVarName)
	os.Unsetenv(WaveDevViteVarName)
	return nil
}

func IsDevMode() bool {
	return Dev_VarCache != ""
}

func GetWaveAppPath() string {
	return AppPath_VarCache
}

func GetWaveDataDir() string {
	return DataHome_VarCache
}

func GetWaveConfigDir() string {
	return ConfigHome_VarCache
}

func GetWaveAppBinPath() string {
	return filepath.Join(GetWaveAppPath(), AppPathBinDir)
}

func GetHomeDir() string {
	homeVar, err := os.UserHomeDir()
	if err != nil {
		return "/"
	}
	return homeVar
}

func ExpandHomeDir(pathStr string) (string, error) {
	if pathStr != "~" && !strings.HasPrefix(pathStr, "~/") && (!strings.HasPrefix(pathStr, `~\`) || runtime.GOOS != "windows") {
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
	return filepath.Join(GetWaveDataDir(), DomainSocketBaseName)
}

func EnsureWaveDataDir() error {
	return CacheEnsureDir(GetWaveDataDir(), "wavehome", 0700, "wave home directory")
}

func EnsureWaveDBDir() error {
	return CacheEnsureDir(filepath.Join(GetWaveDataDir(), WaveDBDir), "wavedb", 0700, "wave db directory")
}

func EnsureWaveConfigDir() error {
	return CacheEnsureDir(GetWaveConfigDir(), "waveconfig", 0700, "wave config directory")
}

func EnsureWavePresetsDir() error {
	return CacheEnsureDir(filepath.Join(GetWaveConfigDir(), "presets"), "wavepresets", 0700, "wave presets directory")
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

func listValidLangs(ctx context.Context) []string {
	out, err := exec.CommandContext(ctx, "locale", "-a").CombinedOutput()
	if err != nil {
		log.Printf("error running 'locale -a': %s\n", err)
		return []string{}
	}
	// don't bother with CRLF line endings
	// this command doesn't work on windows
	return strings.Split(string(out), "\n")
}

var osLangOnce = &sync.Once{}
var osLang string

func determineLang() string {
	defaultLang := "en_US.UTF-8"
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	if runtime.GOOS == "darwin" {
		out, err := exec.CommandContext(ctx, "defaults", "read", "-g", "AppleLocale").CombinedOutput()
		if err != nil {
			log.Printf("error executing 'defaults read -g AppleLocale', will use default 'en_US.UTF-8': %v\n", err)
			return defaultLang
		}
		strOut := string(out)
		truncOut := strings.Split(strOut, "@")[0]
		preferredLang := strings.TrimSpace(truncOut) + ".UTF-8"
		validLangs := listValidLangs(ctx)

		if !utilfn.ContainsStr(validLangs, preferredLang) {
			log.Printf("unable to use desired lang %s, will use default 'en_US.UTF-8'\n", preferredLang)
			return defaultLang
		}

		return preferredLang
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

func ValidateWshSupportedArch(os string, arch string) error {
	if SupportedWshBinaries[fmt.Sprintf("%s-%s", os, arch)] {
		return nil
	}
	return fmt.Errorf("unsupported wsh platform: %s-%s", os, arch)
}
