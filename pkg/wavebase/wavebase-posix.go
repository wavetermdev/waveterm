// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wavebase

import (
	"log"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func AcquireWaveLock() (FDLock, error) {
	homeDir := GetWaveHomeDir()
	lockFileName := filepath.Join(homeDir, WaveLockFile)
	log.Printf("[base] acquiring lock on %s\n", lockFileName)
	fd, err := os.OpenFile(lockFileName, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return nil, err
	}
	err = unix.Flock(int(fd.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if err != nil {
		fd.Close()
		return nil, err
	}
	return fd, nil
}
