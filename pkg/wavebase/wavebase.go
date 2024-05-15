// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavebase

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"strings"
	"sync"
)

const WaveVersion = "v0.1.0"
const DefaultWaveHome = "~/.w2"
const WaveHomeVarName = "WAVETERM_HOME"
const WaveDevVarName = "WAVETERM_DEV"
const HomeVarName = "HOME"

var baseLock = &sync.Mutex{}
var ensureDirCache = map[string]bool{}

func IsDevMode() bool {
	pdev := os.Getenv(WaveDevVarName)
	return pdev != ""
}

func GetHomeDir() string {
	homeVar := os.Getenv(HomeVarName)
	if homeVar == "" {
		return "/"
	}
	return homeVar
}

func ExpandHomeDir(pathStr string) string {
	if pathStr != "~" && !strings.HasPrefix(pathStr, "~/") {
		return pathStr
	}
	homeDir := GetHomeDir()
	if pathStr == "~" {
		return homeDir
	}
	return path.Join(homeDir, pathStr[2:])
}

func GetWaveHomeDir() string {
	homeVar := os.Getenv(WaveHomeVarName)
	if homeVar != "" {
		return ExpandHomeDir(homeVar)
	}
	return ExpandHomeDir(DefaultWaveHome)
}

func EnsureWaveHomeDir() error {
	return CacheEnsureDir(GetWaveHomeDir(), "wavehome", 0700, "wave home directory")
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
