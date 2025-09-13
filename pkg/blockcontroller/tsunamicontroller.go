// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/tsunami/build"
)

type TsunamiController struct {
	blockId string
	tabId   string
}

func (tc *TsunamiController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	return fmt.Errorf("tsunami controller start not implemented")
}

func (tc *TsunamiController) Stop(graceful bool, newStatus string) error {
	return fmt.Errorf("tsunami controller stop not implemented")
}

func (tc *TsunamiController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	return nil
}

func (tc *TsunamiController) SendInput(input *BlockInputUnion) error {
	return fmt.Errorf("tsunami controller send input not implemented")
}

func MakeTsunamiController(tabId string, blockId string) Controller {
	return &TsunamiController{
		blockId: blockId,
		tabId:   tabId,
	}
}

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
		AppPath:        appPath,
		Verbose:        true,
		Open:           false,
		KeepTemp:       false,
		ScaffoldPath:   scaffoldPath,
		SdkReplacePath: sdkReplacePath,
		NodePath:       nodePath,
	}

	return build.TsunamiRun(opts)
}
