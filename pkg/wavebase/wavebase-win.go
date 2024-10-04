// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wavebase

import (
	"fmt"
	"log"
	"path/filepath"

	"github.com/alexflint/go-filemutex"
)

func AcquireWaveLock() (FDLock, error) {
	homeDir := GetWaveHomeDir()
	lockFileName := filepath.Join(homeDir, WaveLockFile)
	log.Printf("[base] acquiring lock on %s\n", lockFileName)
	m, err := filemutex.New(lockFileName)
	if err != nil {
		return nil, fmt.Errorf("filemutex new error: %w", err)
	}
	err = m.TryLock()
	if err != nil {
		return nil, fmt.Errorf("filemutex trylock error: %w", err)
	}
	return m, nil
}
