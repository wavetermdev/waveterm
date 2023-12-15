package releasechecker

import (
	"context"

	"github.com/google/go-github/v57/github"
	"golang.org/x/mod/semver"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

func CheckNewRelease() {
	// Check for the latest release in the DB
	// latestRelease, err := dbutil.g
	ctx := context.Background()
	clientData, err := sstore.EnsureClientData(ctx)
	if clientData.ClientOpts.NoUpdateCheck {
		return
	}
	if err == nil && clientData.ReleaseInfo.ReleaseAvailable && semver.Compare(scbase.WaveVersion, clientData.ReleaseInfo.InstalledVersion) != 0 {
		// We have already notified the frontend about a new release and the record is fresh. There is no need to check again.
		return
	}
	// Initialize an unauthenticated client
	client := github.NewClient(nil)
	// Get the latest release from the repository
	release, rsp, err := client.Repositories.GetLatestRelease(ctx, "wavetermdev", "waveterm")

	releaseInfoLatest := sstore.ReleaseInfoType{
		ReleaseAvailable: false,
		InstalledVersion: scbase.WaveVersion,
		LatestVersion:    scbase.WaveVersion,
	}

	if err == nil && rsp.StatusCode == 200 {
		releaseInfoLatest.LatestVersion = *release.TagName
		if semver.Compare(releaseInfoLatest.InstalledVersion, releaseInfoLatest.LatestVersion) < 0 {
			releaseInfoLatest.ReleaseAvailable = true
		}
	}

	// Update the release info in the DB
	sstore.SetReleaseInfo(ctx, releaseInfoLatest)
}
