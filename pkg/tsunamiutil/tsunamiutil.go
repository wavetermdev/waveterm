// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsunamiutil

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func GetTsunamiAppCachePath(scope string, appName string, osArch string) (string, error) {
	cachesDir := wavebase.GetWaveCachesDir()
	tsunamiCacheDir := filepath.Join(cachesDir, "tsunami-build-cache")
	fullAppName := appName + "." + osArch
	if strings.HasPrefix(osArch, "windows") {
		fullAppName = fullAppName + ".exe"
	}
	fullPath := filepath.Join(tsunamiCacheDir, scope, fullAppName)

	dirPath := filepath.Dir(fullPath)
	err := wavebase.TryMkdirs(dirPath, 0755, "tsunami cache directory")
	if err != nil {
		return "", fmt.Errorf("failed to create tsunami cache directory: %w", err)
	}

	return fullPath, nil
}