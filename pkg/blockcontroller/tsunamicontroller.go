// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/tsunami/build"
)

func runTsunami(blockMeta waveobj.MetaMapType) error {
	scaffoldPath := blockMeta.GetString(waveobj.MetaKey_TsunamiScaffoldPath, "")
	if scaffoldPath == "" {
		return fmt.Errorf("tsunami:scaffoldpath is required")
	}

	sdkReplacePath := blockMeta.GetString(waveobj.MetaKey_TsunamiSdkReplacePath, "")
	if sdkReplacePath == "" {
		return fmt.Errorf("tsunami:sdkreplacepath is required")
	}

	appPath := blockMeta.GetString(waveobj.MetaKey_TsunamiAppPath, "")
	if appPath == "" {
		return fmt.Errorf("tsunami:apppath is required")
	}

	// Get Electron executable path
	nodePath := wavebase.GetWaveAppElectronExecPath()
	if nodePath == "" {
		return fmt.Errorf("electron executable path not set")
	}

	opts := build.BuildOpts{
		Dir:            appPath,
		Verbose:        true,
		Open:           false,
		KeepTemp:       false,
		ScaffoldPath:   scaffoldPath,
		SdkReplacePath: sdkReplacePath,
		NodePath:       nodePath,
	}

	return build.TsunamiRun(opts)
}
