// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package releasechecker

import (
	"context"
	"fmt"

	"github.com/google/go-github/v57/github"
	"golang.org/x/mod/semver"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/feupdate"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

type ReleaseCheckResult int

const (
	NotNeeded ReleaseCheckResult = 0
	Success   ReleaseCheckResult = 1
	Failure   ReleaseCheckResult = 2
	Disabled  ReleaseCheckResult = 3
)

// CheckNewRelease checks for a new release and updates the release info in the DB.
// If force is true, the release info is updated even if it is fresh or if the automatic release check is disabled.
func CheckNewRelease(ctx context.Context, force bool) (ReleaseCheckResult, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return Failure, fmt.Errorf("error getting client data: %w", err)
	}

	if !force && clientData.ClientOpts.NoReleaseCheck {
		return Disabled, nil
	}

	if !force && semver.Compare(scbase.WaveVersion, clientData.ReleaseInfo.LatestVersion) < 0 {
		// We have already notified the frontend about a new release and the record is fresh. There is no need to check again.
		return NotNeeded, nil
	}
	// Initialize an unauthenticated client
	client := github.NewClient(nil)
	// Get the latest release from the repository
	release, rsp, err := client.Repositories.GetLatestRelease(ctx, "wavetermdev", "waveterm")

	releaseInfoLatest := sstore.ReleaseInfoType{
		LatestVersion: scbase.WaveVersion,
	}

	if err != nil {
		return Failure, fmt.Errorf("error getting latest release: %w", err)
	}

	if rsp.StatusCode != 200 {
		return Failure, fmt.Errorf("response from Github is not success: %v", rsp)
	}

	releaseInfoLatest.LatestVersion = *release.TagName

	// Update the release info in the DB
	err = sstore.SetReleaseInfo(ctx, releaseInfoLatest)
	if err != nil {
		return Failure, fmt.Errorf("error updating release info: %w", err)
	}

	clientData, err = sstore.EnsureClientData(ctx)
	if err != nil {
		return Failure, fmt.Errorf("error getting updated client data: %w", err)
	}

	update := &feupdate.ModelUpdate{}
	update.AddUpdate(clientData)
	feupdate.MainBus.SendUpdate(update)

	return Success, nil
}
