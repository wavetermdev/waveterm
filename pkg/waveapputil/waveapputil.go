// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveapputil

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/tsunami/build"
)

const DefaultTsunamiSdkVersion = "v0.12.2"

func GetTsunamiScaffoldPath() string {
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	scaffoldPath := settings.TsunamiScaffoldPath
	if scaffoldPath == "" {
		scaffoldPath = filepath.Join(wavebase.GetWaveAppPath(), "tsunamiscaffold")
	}
	return scaffoldPath
}

func ResolveGoFmtPath() (string, error) {
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	goPath := settings.TsunamiGoPath

	if goPath == "" {
		var err error
		goPath, err = build.FindGoExecutable()
		if err != nil {
			return "", err
		}
	}

	goDir := filepath.Dir(goPath)
	gofmtName := "gofmt"
	if runtime.GOOS == "windows" {
		gofmtName = "gofmt.exe"
	}
	gofmtPath := filepath.Join(goDir, gofmtName)

	info, err := os.Stat(gofmtPath)
	if err != nil {
		return "", fmt.Errorf("gofmt not found at %s: %w", gofmtPath, err)
	}

	if info.IsDir() {
		return "", fmt.Errorf("gofmt path is a directory: %s", gofmtPath)
	}

	if info.Mode()&0111 == 0 {
		return "", fmt.Errorf("gofmt is not executable: %s", gofmtPath)
	}

	return gofmtPath, nil
}

func FormatGoCode(contents []byte) []byte {
	gofmtPath, err := ResolveGoFmtPath()
	if err != nil {
		return contents
	}

	cmd := exec.Command(gofmtPath)
	cmd.Stdin = bytes.NewReader(contents)
	formattedOutput, err := cmd.Output()
	if err != nil {
		return contents
	}

	return formattedOutput
}